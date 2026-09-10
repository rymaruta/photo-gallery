import { describe, it, expect, vi, beforeEach } from "vitest";

const mockListPhotos = vi.hoisted(() => vi.fn());
const mockListPhotosByUser = vi.hoisted(() => vi.fn());

const mockGetPhotoById = vi.hoisted(() => vi.fn());
vi.mock("../ddb-photos", () => ({
    listPhotos: mockListPhotos,
    listPhotosByUser: mockListPhotosByUser,
    getPhotoById: mockGetPhotoById,
    listAllPhotosForAdmin: vi.fn(),
}));

vi.stubEnv("PHOTOS_TABLE", "photos-test");
const { getPhotos, getPhoto, resetPhotosCache, stripPrivate, PRIVATE_FIELDS } = await import("../photos");

type Result = { statusCode: number; body: string; headers?: Record<string, string> };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (event: unknown): Promise<Result> => (getPhotos as any)(event);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invokeOne = (event: unknown): Promise<Result> => (getPhoto as any)(event);

beforeEach(() => {
    resetPhotosCache();
    mockListPhotos.mockReset().mockResolvedValue([{ id: "p1", src: "https://cdn/p1.jpg" }]);
    mockListPhotosByUser.mockReset().mockResolvedValue([{ id: "p2", src: "https://cdn/p2.jpg" }]);
});

// この口は未ログインでも叩けて、1回ごとにテーブル全体を読む。
// しかもテーブルには写真だけでなく、いいね・フォローのマーカーや
// コメント・通知の文書も同居していて、絞り込みは読んだ**あと**に効く
// ——つまり全部の読み取り費用を払っている。マーカーは退会しても
// 消えないので、増えるほど1回が重くなる。
// s-maxage=60 を付けているが、API の手前に共有キャッシュは無いので効かない
// （クライアントは execute-api を直接叩く）。見つからないクエリ文字列を
// 足すだけで何度でも叩ける。
describe("getPhotos: 読み取りの使い回し", () => {
    it("短時間に何度叩いてもテーブルは1回しか読まない", async () => {
        for (let i = 0; i < 5; i++) await invoke({});
        expect(mockListPhotos).toHaveBeenCalledTimes(1);
    });

    it("クエリ文字列を変えても読み直さない（キャッシュ回避を許さない）", async () => {
        await invoke({ queryStringParameters: { cb: "1" } });
        await invoke({ queryStringParameters: { cb: "2" } });
        await invoke({ queryStringParameters: { cb: "3" } });
        expect(mockListPhotos).toHaveBeenCalledTimes(1);
    });

    it("返す中身は変わらない", async () => {
        const first = await invoke({});
        const second = await invoke({});
        expect(first.statusCode).toBe(200);
        expect(second.body).toBe(first.body);
        expect(JSON.parse(second.body)).toEqual([{ id: "p1", src: "https://cdn/p1.jpg" }]);
    });

    it("特定の人の分は使い回さない（GSI の Query でその人の枚数に収まる）", async () => {
        await invoke({ queryStringParameters: { userId: "u1" } });
        await invoke({ queryStringParameters: { userId: "u2" } });
        expect(mockListPhotosByUser).toHaveBeenCalledTimes(2);
        expect(mockListPhotos).not.toHaveBeenCalled();
    });

    // 使い回しの窓は10秒。60秒にしていた頃は、公開アップロードの導線
    // 「保存 → 1.5秒後にトップへ」で上げた本人に最大60秒「無い」ように見えた。
    // 書き込みは api-user・読み取りは api と別サービスなので、書いた側から
    // キャッシュを落とせない。無いと思ってもう一度上げると同じ写真が2枚になり、
    // 100枚の上限も1枚減る。
    it("10秒を過ぎたら読み直す（上げた直後の写真を隠さない）", async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date("2026-08-20T00:00:00Z"));
            await invoke({});
            expect(mockListPhotos).toHaveBeenCalledTimes(1);

            vi.setSystemTime(new Date("2026-08-20T00:00:09Z"));  // まだ窓の中
            await invoke({});
            expect(mockListPhotos).toHaveBeenCalledTimes(1);

            vi.setSystemTime(new Date("2026-08-20T00:00:11Z"));  // 窓を過ぎた
            await invoke({});
            expect(mockListPhotos).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it("読み取りが失敗したら 500（失敗をキャッシュしない）", async () => {
        mockListPhotos.mockRejectedValue(new Error("ddb down"));
        expect((await invoke({})).statusCode).toBe(500);
        // 次の呼び出しでちゃんと読み直す
        mockListPhotos.mockResolvedValue([{ id: "p1" }]);
        expect((await invoke({})).statusCode).toBe(200);
    });
});

// 公開の読み取りは認可なしで誰でも叩ける（serverless.yml の
// GET /photos と GET /photos/{id} に authorizer は無い）。
// 静的側は2か所で落としているのに、この経路だけ DynamoDB の項目を
// そのまま返していたので、静的HTMLから消したはずのURLが API からは
// 取れたままだった。srcOriginal は EXIF を落とす前の原本（GPS入り）。
describe("公開の読み取り: 非公開項目を返さない", () => {
    const full = {
        id: "p1", src: "https://cdn/p1.jpg", title: { ja: "海" },
        srcOriginal: "https://cdn/uploads/originals/p1.jpeg",
        key: "uploads/67d49a68-owner-sub/p1.jpg",
    };

    it("一覧は srcOriginal と key を落とす", async () => {
        mockListPhotos.mockResolvedValue([full]);
        const body = JSON.parse((await invoke({})).body) as Record<string, unknown>[];
        expect(body[0]).not.toHaveProperty("srcOriginal");
        expect(body[0]).not.toHaveProperty("key");
        expect(body[0].src).toBe("https://cdn/p1.jpg");   // 表示に要る分は残す
        expect(body[0].title).toEqual({ ja: "海" });
    });

    it("特定の人の一覧でも落とす", async () => {
        mockListPhotosByUser.mockResolvedValue([full]);
        const body = JSON.parse((await invoke({ queryStringParameters: { userId: "u1" } })).body) as Record<string, unknown>[];
        expect(body[0]).not.toHaveProperty("srcOriginal");
        expect(body[0]).not.toHaveProperty("key");
    });

    it("詳細でも落とす", async () => {
        mockGetPhotoById.mockResolvedValue(full);
        const body = JSON.parse((await invokeOne({ pathParameters: { id: "p1" } })).body) as Record<string, unknown>;
        expect(body).not.toHaveProperty("srcOriginal");
        expect(body).not.toHaveProperty("key");
        expect(body.src).toBe("https://cdn/p1.jpg");
    });

    // 削除は同じ getPhotoById から srcOriginal を読んで原本を消す。
    // ここで測れるのは「ハンドラが応答用のコピーだけを落とし、取得した
    // 項目そのものを書き換えない」ことまで（データ層はモックなので、
    // 「データ層が落とさない」ことは ddbPhotos.test.ts 側で固定している）。
    // 以前のテスト名は「データ層は落とさない」で、測っていない範囲まで
    // 主張していた。
    it("応答用のコピーだけを落とし、取得した項目は書き換えない", async () => {
        mockGetPhotoById.mockResolvedValue(full);
        const res = await invokeOne({ pathParameters: { id: "p1" } });
        // 200 を確かめて strip 経路が実際に走ったことを固定する。
        // これが無いと、getPhoto を常時404にしてもこのテストは通る
        // （575667b のレビューで変異により実証された空振り）。
        expect(res.statusCode).toBe(200);
        // ハンドラに渡された元の項目はそのまま
        expect(full).toHaveProperty("srcOriginal");
    });
});

describe("getPhoto: ストーリーを詳細でも弾く", () => {
    it("published:true になっているストーリーでも 404", async () => {
        // 一覧3か所は attribute_not_exists(story) で弾いているのに、
        // 詳細だけ間接的な判定しかなく、viewers（閲覧者全員の userId と
        // 表示名）ごと返っていた。
        mockGetPhotoById.mockResolvedValue({
            id: "story-1", src: "https://cdn/s.mp4", story: true, published: true,
            viewers: { "viewer-sub": { displayName: "見た人", at: "2026-08-20T00:00:00Z" } },
        });
        const res = await invokeOne({ pathParameters: { id: "story-1" } });
        expect(res.statusCode).toBe(404);
        expect(res.body).not.toContain("viewer-sub");
    });

    it("普通の写真は今までどおり返る", async () => {
        mockGetPhotoById.mockResolvedValue({ id: "p1", src: "https://cdn/p1.jpg", published: true });
        expect((await invokeOne({ pathParameters: { id: "p1" } })).statusCode).toBe(200);
    });
});


// **公開する応答から内部の項目を落とす。**
//
// `GET /photos` / `GET /photos/{id}` は**認可なし**で DynamoDB の項目を
// ほぼそのまま返す。ふるい（`PRIVATE_FIELDS`）が唯一の砦なのに、
// **1本もテストが無かった**——`srcOriginal`（GPS 入り原本の URL）を
// 名簿から外しても全件緑だった。
//
// `staticStale`（静的ページの掃除が届いていないという内部の印）も落とす。
// 付くのは非公開の写真だけだが、非公開化が届かず印が立ち、そのあとの
// 再公開が畳まれると `published: true` のまま印が残り、この口から読める。
describe("公開応答から落とす項目", () => {
    // `keptFrom`（ストーリーから残した出どころ）も落とす。載せると
    // **まだ生きているストーリーのID**が公開JSONと公開APIに出る
    it.each(["srcOriginal", "key", "staticStale", "publicFeed", "keptFrom"])("%s は返さない", (field) => {
        const out = stripPrivate({
            id: "p1", src: "https://cdn/x.jpg", title: "あ",
            srcOriginal: "https://cdn/x_orig.jpg", key: "uploads/u/x.jpg", staticStale: true, publicFeed: "1",
            keptFrom: "story-abc",
        }) as Record<string, unknown>;
        expect(out[field], `${field} が公開応答に載っている`).toBeUndefined();
        expect(PRIVATE_FIELDS as readonly string[]).toContain(field);
    });

    it("表に出す項目は落とさない", () => {
        const out = stripPrivate({ id: "p1", src: "https://cdn/x.jpg", title: "あ" });
        expect(out).toEqual({ id: "p1", src: "https://cdn/x.jpg", title: "あ" });
    });

    it("元の項目を書き換えない（コピーを返す）", () => {
        const item = { id: "p1", srcOriginal: "https://cdn/x_orig.jpg" };
        stripPrivate(item);
        expect(item.srcOriginal, "呼び出し元の項目を壊している").toBe("https://cdn/x_orig.jpg");
    });
});
