import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetPhotoById = vi.hoisted(() => vi.fn());
const mockUpdatePhotoFields = vi.hoisted(() => vi.fn());
const mockRebuild = vi.hoisted(() => vi.fn());

const mockDeletePhotoById = vi.hoisted(() => vi.fn());
vi.mock("../ddb-photos", () => ({
    getPhotoById: mockGetPhotoById,
    updatePhotoFields: mockUpdatePhotoFields,
    deletePhotoById: mockDeletePhotoById,
}));
vi.mock("../rebuild", () => ({ requestSiteRebuild: mockRebuild }));
const mockS3Send = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = mockS3Send; },
    DeleteObjectCommand: class { input: unknown; constructor(i: unknown) { this.input = i; } },
}));

vi.stubEnv("PHOTOS_TABLE", "photos-test");
vi.stubEnv("UPLOAD_BUCKET", "bucket-test");
const { updatePhoto, deletePhoto } = await import("../photosMutate");

type Result = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (event: unknown): Promise<Result> => (updatePhoto as any)(event);

const ev = (id: string, body: unknown, sub = "owner", groups = "") => ({
    pathParameters: { id },
    body: JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims: { sub, "cognito:groups": groups } } } },
});

beforeEach(() => {
    mockGetPhotoById.mockReset();
    mockUpdatePhotoFields.mockReset().mockResolvedValue({ id: "p1" });
    mockRebuild.mockReset().mockResolvedValue(true);
});

// この口は api-user 側の PUT /photos/{id} と同じ道の別実装。
// どちらのホストもクライアントのバンドルに入っているので、利用者は
// どちらでも叩ける。しかも権限判定は「管理者 **または** 所有者」なので
// 管理者専用ではない——普通の利用者が自分の写真に対して使える。
describe("updatePhoto", () => {
    it("ストーリーは編集できない（404）", async () => {
        // ストーリーを published:true にできると、24時間で消えるはずのものが
        // 永久の公開ページになる。しかも掃除は実体しか消さないので、
        // 壊れたページとサイトマップの項目が残る。
        // ストーリーは動画も許しているので、写真ギャラリーに動画を
        // 差し込む経路にもなっていた。
        mockGetPhotoById.mockResolvedValue({
            id: "story-1", story: true, userId: "owner", src: "https://cdn/s.jpg", published: false,
        });
        const res = await invoke(ev("story-1", { published: true }));
        expect(res.statusCode).toBe(404);
        expect(mockUpdatePhotoFields).not.toHaveBeenCalled();
        expect(mockRebuild).not.toHaveBeenCalled();
    });

    it("自分の写真は編集できる", async () => {
        mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "owner", src: "https://cdn/p1.jpg" });
        expect((await invoke(ev("p1", { location: "北海道" }))).statusCode).toBe(200);
        expect(mockUpdatePhotoFields.mock.calls[0][1]).toMatchObject({ location: "北海道" });
    });

    it("他人の写真は編集できない（403）", async () => {
        mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "someone-else", src: "https://cdn/p1.jpg" });
        expect((await invoke(ev("p1", { location: "北海道" }))).statusCode).toBe(403);
        expect(mockUpdatePhotoFields).not.toHaveBeenCalled();
    });

    // 空配列は「そのタグを外す」指定。SET tags = [] にしていた頃は、
    // 同じ写真でも叩いたAPIによって「属性が空配列」と「属性が無い」に
    // 分かれ、再ビルドの判定が食い違っていた。
    it("タグを空で送ったら、属性ごと外す指定にする", async () => {
        mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "owner", src: "https://cdn/p1.jpg", tags: ["海"] });
        await invoke(ev("p1", { tags: [] }));
        const fields = mockUpdatePhotoFields.mock.calls[0][1] as Record<string, unknown>;
        expect("tags" in fields).toBe(true);
        expect(fields.tags).toBeUndefined();
    });

    it("GPS 入りの exif は保存されない", async () => {
        mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "owner", src: "https://cdn/p1.jpg" });
        await invoke(ev("p1", { exif: { camera: "X100V", gpsLatitude: "35.6812" } }));
        expect(mockUpdatePhotoFields.mock.calls[0][1].exif).toEqual({ camera: "X100V" });
    });

    describe("静的ページの作り直し", () => {
        it("公開状態が変わったときだけ頼む", async () => {
            mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true });
            await invoke(ev("p1", { published: false }));
            expect(mockRebuild).toHaveBeenCalledTimes(1);
        });

        it("公開状態が同じで他も変えなければ頼まない", async () => {
            mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true });
            await invoke(ev("p1", { published: true }));
            await invoke(ev("p1", { published: true }));
            expect(mockRebuild).not.toHaveBeenCalled();
        });

        it("本文や撮影地を消したときも頼む", async () => {
            // 静的HTMLには本文・撮影地・EXIF・表示名入りの JSON-LD が焼き込まれている。
            // 「公開状態が変わったときだけ」に絞ると、説明に書いてしまった
            // 個人情報を消して保存しても、静的HTMLには残り続ける。
            mockGetPhotoById.mockResolvedValue({
                id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true,
                location: "北海道", description: { ja: ["最寄りは○○駅"] },
            });
            await invoke(ev("p1", { location: "", description: "" }));
            expect(mockRebuild).toHaveBeenCalledTimes(1);
        });

        // 「キーが来ているか」で見ていた時期があるが、それは実質「毎回」
        // だった——/admin/edit は保存のたびに全項目（exif 込み）を送る。
        // 何も書き換えずに保存を押すだけでビルドが走る（1本8分・月2,000分）。
        // 空の body で確かめても意味が無い（そんな保存は画面から起きない）。
        it("同じ内容を送り直す保存では頼まない（画面は毎回全項目を送る）", async () => {
            const stored = {
                id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true,
                title: { ja: "海", en: "Sea" },
                description: { ja: ["静かだった"] },
                location: "北海道",
                category: "風景",
                date: "2026-07-01T09:00:00.000Z",
                tags: ["海", "夏"],
                exif: { camera: "X100V" },
            };
            mockGetPhotoById.mockResolvedValue(stored);
            await invoke(ev("p1", {
                title: { ja: "海", en: "Sea" },
                description: { ja: ["静かだった"] },
                location: "北海道",
                category: "風景",
                date: "2026-07-01T09:00:00.000Z",
                tags: ["海", "夏"],
                exif: { camera: "X100V" },
                published: true,
            }));
            expect(mockUpdatePhotoFields).toHaveBeenCalledTimes(1);   // 保存自体はする
            expect(mockRebuild).not.toHaveBeenCalled();               // ビルドは頼まない
        });

        it("1項目でも中身が変われば頼む", async () => {
            mockGetPhotoById.mockResolvedValue({
                id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true,
                location: "北海道", tags: ["海", "夏"],
            });
            await invoke(ev("p1", { location: "北海道", tags: ["海", "冬"], published: true }));
            expect(mockRebuild).toHaveBeenCalledTimes(1);
        });

        it("タグの並び替えも「変わった」扱いにする（表示順が変わる）", async () => {
            mockGetPhotoById.mockResolvedValue({
                id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true, tags: ["海", "夏"],
            });
            await invoke(ev("p1", { tags: ["夏", "海"], published: true }));
            expect(mockRebuild).toHaveBeenCalledTimes(1);
        });

        it("項目を指定しない保存では頼まない", async () => {
            mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true });
            await invoke(ev("p1", {}));
            expect(mockRebuild).not.toHaveBeenCalled();
        });

        it("連打で枠を使い切らせないよう畳む指定を付ける", async () => {
            mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true });
            await invoke(ev("p1", { published: false }));
            expect(mockRebuild.mock.calls[0][1]).toEqual({ coalesce: true });
        });

        it("published が未設定の写真（＝公開扱い）を非公開にしたら頼む", async () => {
            mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "owner", src: "https://cdn/p1.jpg" });
            await invoke(ev("p1", { published: false }));
            expect(mockRebuild).toHaveBeenCalledTimes(1);
        });
    });
});


// **この口には今までテストが無かった。**
// `api/src/__tests__/deletePhoto.test.ts` は ddb-photos の deletePhotoById
// という**別関数**を見ている（名前が紛らわしく、あるものと思われていた）。
//
// ここが守っているのは2つ。
//   1. 他人の写真を消せないこと
//   2. S3 で消すのはアップロード領域だけ。src は過去に無検証で保存された
//      ものがあり、そのままキーにすると profiles/<他人> まで消せる
describe("deletePhoto（ハンドラ）", () => {
    const s3Keys = () => mockS3Send.mock.calls.map((c) => (c[0] as { input: { Key: string } }).input.Key);
    const del = (id: string, sub = "owner", groups = "") => ({
        pathParameters: { id },
        requestContext: { authorizer: { jwt: { claims: { sub, "cognito:groups": groups } } } },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invokeDelete = (e: unknown): Promise<Result> => (deletePhoto as any)(e);

    beforeEach(() => {
        mockS3Send.mockReset().mockResolvedValue({});
        mockDeletePhotoById.mockReset().mockResolvedValue(undefined);
    });

    it("他人の写真は消せない（403）", async () => {
        mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "someone-else", src: "https://cdn/uploads/p1.jpg" });
        expect((await invokeDelete(del("p1"))).statusCode).toBe(403);
        expect(mockDeletePhotoById).not.toHaveBeenCalled();
        expect(mockS3Send).not.toHaveBeenCalled();
    });

    it("管理者は他人の写真も消せる", async () => {
        mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "someone-else", src: "https://cdn/uploads/p1.jpg" });
        expect((await invokeDelete(del("p1", "admin-sub", "admin"))).statusCode).toBe(200);
        expect(mockDeletePhotoById).toHaveBeenCalledWith("p1");
    });

    it("存在しない写真は 404", async () => {
        mockGetPhotoById.mockResolvedValue(null);
        expect((await invokeDelete(del("nope"))).statusCode).toBe(404);
    });

    it("GPS 入りの原本を含む派生も全部消す", async () => {
        // srcOriginal は EXIF を落とす前の原本。消し残すと削除後も
        // 公開URLで取得できてしまう。
        mockGetPhotoById.mockResolvedValue({
            id: "p1", userId: "owner",
            src: "https://cdn/uploads/p1.jpg",
            srcOriginal: "https://cdn/uploads/originals/p1.jpeg",
            srcAvif: "https://cdn/uploads/p1.avif",
            thumbSrc: "https://cdn/uploads/p1_thumb.webp",
        });
        await invokeDelete(del("p1"));
        expect(s3Keys()).toEqual(expect.arrayContaining([
            "uploads/p1.jpg", "uploads/originals/p1.jpeg", "uploads/p1.avif", "uploads/p1_thumb.webp",
        ]));
    });

    it("key フィールドと生キー（uploads/...）も消す対象に含める", async () => {
        // api-user/src/mediaKeys.ts の MEDIA_FIELDS と対。以前は URL 形式
        // しか受けず、key フィールドは列挙にも無かった（PAIR-5）。
        mockGetPhotoById.mockResolvedValue({
            id: "p1", userId: "owner",
            key: "uploads/p1-raw.jpg",
            src: "https://cdn/uploads/p1.jpg",
        });
        await invokeDelete(del("p1"));
        expect(s3Keys()).toEqual(expect.arrayContaining(["uploads/p1-raw.jpg", "uploads/p1.jpg"]));
    });

    it("生キーの .. はデコード後に見る（%2E%2E も弾く）", async () => {
        mockGetPhotoById.mockResolvedValue({
            id: "p1", userId: "owner",
            key: "uploads/%2E%2E/profiles/victim",
            src: "https://cdn/uploads/p1.jpg",
        });
        await invokeDelete(del("p1"));
        expect(s3Keys()).toEqual(["uploads/p1.jpg"]);
    });

    it("生キーでも .. を含むものは消しに行かない", async () => {
        mockGetPhotoById.mockResolvedValue({
            id: "p1", userId: "owner",
            key: "uploads/u1/../profiles/victim",
            src: "https://cdn/uploads/p1.jpg",
        });
        await invokeDelete(del("p1"));
        expect(s3Keys()).toEqual(["uploads/p1.jpg"]);
    });

    it("アップロード領域の外は消しに行かない（他人のアイコンを守る）", async () => {
        mockGetPhotoById.mockResolvedValue({
            id: "p1", userId: "owner",
            src: "https://cdn/profiles/someone-else",
            thumbSrc: "https://cdn/uploads/p1_thumb.webp",
        });
        await invokeDelete(del("p1"));
        expect(s3Keys()).toEqual(["uploads/p1_thumb.webp"]);
    });

    it("パーセント符号化されたパスもデコードしてから見る", async () => {
        // CloudFront は %6C をデコードして解決するので、生のまま見ると
        // 「保存はできるが削除では対象外」になり、実体だけが公開URLに残る。
        mockGetPhotoById.mockResolvedValue({
            id: "p1", userId: "owner", src: "https://cdn/up%6Coads/p1.jpg",
        });
        await invokeDelete(del("p1"));
        expect(s3Keys()).toEqual(["uploads/p1.jpg"]);
    });

    it("S3 の削除に失敗しても DynamoDB の行は消す", async () => {
        mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "owner", src: "https://cdn/uploads/p1.jpg" });
        mockS3Send.mockRejectedValueOnce(new Error("s3 down"));
        expect((await invokeDelete(del("p1"))).statusCode).toBe(200);
        expect(mockDeletePhotoById).toHaveBeenCalledWith("p1");
    });

    it("静的ページの掃除を頼む（畳まない）", async () => {
        mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "owner", src: "https://cdn/uploads/p1.jpg" });
        await invokeDelete(del("p1"));
        expect(mockRebuild).toHaveBeenCalledTimes(1);
        // 削除は「何度でも無料で起こせる操作」ではないので畳んではいけない
        expect(mockRebuild.mock.calls[0][1]).toBeUndefined();
    });
});

// このテーブルには写真以外（notifs#... / comments#... / following#...）も
// 同じキー空間に入っている。読み側（getPhoto）は理由コメント付きで
// `#` を弾いているのに、書き側は素通りだった。所有権の判定は
// `!isAdmin && ownerId !== callerId` なので**管理者だけ**が
// `PUT /photos/notifs%23<sub>` で他人の通知文書に title を生やしたり、
// `DELETE` で丸ごと消したりできた（元に戻せない）。
describe("写真以外の文書を書き換えさせない", () => {
    const DOCS = ["notifs#someone", "comments#p1", "following#someone", "followstats#someone"];

    // ファイル共通の beforeEach は deletePhotoById をリセットしない
    // （他の describe の呼び出しが残ったまま数えると誤判定する）
    beforeEach(() => {
        mockDeletePhotoById.mockReset();
        mockGetPhotoById.mockReset();
    });

    it("管理者でも # 入りの id は更新できない（404）", async () => {
        for (const id of DOCS) {
            // 文書が実在しても届かないことを見る（Get の手前で止まる）
            mockGetPhotoById.mockResolvedValue({ id, uid: "victim", items: [] });
            const res = await invoke(ev(id, { title: "乗っ取り" }, "admin-sub", "admin"));
            expect(res.statusCode).toBe(404);
        }
        expect(mockUpdatePhotoFields).not.toHaveBeenCalled();
        // データ層にすら触らない
        expect(mockGetPhotoById).not.toHaveBeenCalled();
    });

    it("管理者でも # 入りの id は削除できない（404）", async () => {
        for (const id of DOCS) {
            mockGetPhotoById.mockResolvedValue({ id, uid: "victim", items: [] });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const res = await (deletePhoto as any)(ev(id, {}, "admin-sub", "admin")) as Result;
            expect(res.statusCode).toBe(404);
        }
        expect(mockDeletePhotoById).not.toHaveBeenCalled();
    });

    it("普通の写真IDは今までどおり更新できる（壊していない）", async () => {
        mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "owner", published: true });
        const res = await invoke(ev("p1", { title: "新しい題" }, "owner"));
        expect(res.statusCode).toBe(200);
        expect(mockUpdatePhotoFields).toHaveBeenCalled();
    });
});

// Get と Update の間に写真が消えた（条件外れ）は、対の
// api-user/src/photoUpdate.ts と同じく 404。500 のままだと利用者は
// 「失敗したので再試行」と読んで押し直す（調査ラウンド2の指摘）。
describe("updatePhoto: 更新中に写真が消えた", () => {
    it("持ち主が空の写真 × sub の無いトークンでも通さない（403）", async () => {
        // callerId の "" 化で薄くなった一枚。!ownerId まで見る
        // （対の api-user/src/photoUpdate.ts:109 と同じ）
        mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "" });
        const noSubEv = {
            pathParameters: { id: "p1" },
            body: JSON.stringify({ location: "北海道" }),
            requestContext: { authorizer: { jwt: { claims: { "cognito:groups": "" } } } },
        };
        expect((await invoke(noSubEv)).statusCode).toBe(403);
        expect(mockUpdatePhotoFields).not.toHaveBeenCalled();
    });

    it("ConditionalCheckFailed は 404（500 で再試行を誘わない）", async () => {
        mockGetPhotoById.mockResolvedValue({ id: "p1", userId: "owner" });
        mockUpdatePhotoFields.mockRejectedValueOnce(
            Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" }));
        const res = await invoke(ev("p1", { location: "北海道" }));
        expect(res.statusCode).toBe(404);
    });
});
