import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockDdbSend = vi.hoisted(() => vi.fn());
const mockRebuild = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));
vi.mock("../rebuild", () => ({ requestSiteRebuild: mockRebuild }));
// S3 の削除とエッジの無効化は境界としてモックする（実体は `s3Delete` 側）
// 引数の型を書く。`vi.fn(async () => …)` だと引数ゼロのタプルに推論され、
// `mock.calls[0][0]` が型エラーになる（基準より型エラーを増やさない）
const mockS3DeleteMany = vi.hoisted(() => vi.fn(async (keys: string[]) => { void keys; }));
vi.mock("../s3Delete", () => ({ s3DeleteMany: (keys: string[]) => mockS3DeleteMany(keys) }));
// アルバムへの出し入れは境界としてモックする（実体は `albums.test.ts`）
// 案A: 実体を `private/` へ動かす経路
const mockCopyAll = vi.hoisted(() => vi.fn(async () => true));
const mockDropOld = vi.hoisted(() => vi.fn(async () => 0));
vi.mock("../s3Move", () => ({
    copyAll: (...a: unknown[]) => mockCopyAll(...(a as [])),
    // 本物の `dropOld` は `s3DeleteMany` を呼ぶだけ。差し替えの古い実体も
    // `dropUnused.ts` → `dropOld` を通るようになったので、同じ記録に残す
    dropOld: async (...a: unknown[]) => {
        const r = await mockDropOld(...(a as []));
        await mockS3DeleteMany((a[0] as { from: string }[]).map((m) => m.from));
        return r;
    },
}));

const mockAddToAlbum = vi.hoisted(() => vi.fn(async () => undefined));
const mockRemoveFromAlbum = vi.hoisted(() => vi.fn(async () => undefined));
const mockIsAlbumMember = vi.hoisted(() => vi.fn(async () => true));
// 移した元を消す前の「使用中か」の読み直し（`dropUnused.ts`）。
// **本物は GSI を掴む**ので作り物にする。既定は「ほかに使っている行は無い」
const mockListMyMedia = vi.hoisted(() => vi.fn(async (): Promise<unknown[]> => []));
vi.mock("../ddb-photos", async (importActual) => ({
    ...(await importActual<typeof import("../ddb-photos")>()),
    listMyMediaItems: (...a: unknown[]) => mockListMyMedia(...(a as [])),
}));
vi.mock("../albums", () => ({
    addPhotoToAlbum: (...a: unknown[]) => mockAddToAlbum(...(a as [])),
    removePhotoFromAlbum: (...a: unknown[]) => mockRemoveFromAlbum(...(a as [])),
    isAlbumMember: (...a: unknown[]) => mockIsAlbumMember(...(a as [])),
}));

import { updatePhotoVisibility, isValidYouTubeUrl } from "../photoUpdate";

const CDN = "https://d15fn3rcaiymu9.cloudfront.net";
const UID = "11111111-2222-4333-8444-555555555555";
const mine = (p: string) => `${CDN}/uploads/${UID}/${p}`;

type LambdaResult = { statusCode: number; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (event: unknown): Promise<LambdaResult> => (updatePhotoVisibility as any)(event);

function event(sub: string, id: string | undefined, body: unknown) {
    return {
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        pathParameters: id ? { id } : undefined,
        body: typeof body === "string" ? body : JSON.stringify(body),
    };
}

beforeEach(() => {
    mockDdbSend.mockReset();
    mockRebuild.mockReset().mockResolvedValue(true);
    mockAddToAlbum.mockReset().mockResolvedValue(undefined);
    mockRemoveFromAlbum.mockReset().mockResolvedValue(undefined);
    mockIsAlbumMember.mockReset().mockResolvedValue(true);
    mockS3DeleteMany.mockReset().mockResolvedValue(undefined);
    vi.stubEnv("CLOUDFRONT_URL", CDN);
});

afterEach(() => { vi.unstubAllEnvs(); });

describe("updatePhotoVisibility", () => {
    it("id なしは 400", async () => {
        const res = await invoke(event("u1", undefined, { published: true }));
        expect(res.statusCode).toBe(400);
    });

    it("不正な JSON は 400", async () => {
        const res = await invoke(event("u1", "p1", "{broken"));
        expect(res.statusCode).toBe(400);
    });

    it("published が boolean でなければ 400", async () => {
        const res = await invoke(event("u1", "p1", { published: "yes" }));
        expect(res.statusCode).toBe(400);
    });

    it("写真が存在しなければ 404", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: undefined });
        const res = await invoke(event("u1", "p1", { published: false }));
        expect(res.statusCode).toBe(404);
    });

    it("所有者以外は 403（他人の写真は非公開化できない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "p1", userId: "owner" } });
        const res = await invoke(event("attacker", "p1", { published: false }));
        expect(res.statusCode).toBe(403);
        expect(mockDdbSend).toHaveBeenCalledTimes(1); // Update は実行されない
    });

    it("自分のストーリーでも 404（写真として公開させない）", async () => {
        // ストーリーに published:true を書き込むと永久の写真ページになり、
        // 24時間後の期限切れ掃除が実体だけ消して壊れたページが残った。
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "story-1", userId: "u1", story: true } });
        const res = await invoke(event("u1", "story-1", { published: true }));
        expect(res.statusCode).toBe(404);
        expect(mockDdbSend).toHaveBeenCalledTimes(1); // Update は実行されない
    });

    it("userId が無い写真は uploadedBy で所有権を判定する", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", uploadedBy: "u1" } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { published: true }));
        expect(res.statusCode).toBe(200);
    });

    it("所有者は published を更新できる", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1" } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { published: false }));
        expect(res.statusCode).toBe(200);
        const update = (mockDdbSend.mock.calls[1][0] as { input: { UpdateExpression: string; ExpressionAttributeValues: Record<string, unknown> } }).input;
        expect(update.UpdateExpression).toContain("published");
        expect(update.ExpressionAttributeValues[":p"]).toBe(false);
    });

    // **撮影スポットの紐付け**（本人がスポットの画面から選ぶ・2026-09-29）
    describe("spotId", () => {
        const SPOT = "sp_0123456789ab";
        const upd = () => (mockDdbSend.mock.calls[1][0] as { input: { UpdateExpression: string; ExpressionAttributeNames?: Record<string, string>; ExpressionAttributeValues?: Record<string, unknown> } }).input;

        it("形の合う spotId を付けられる", async () => {
            mockDdbSend.mockResolvedValueOnce({ Item: { id: "p1", userId: "u1" } }).mockResolvedValueOnce({});
            const res = await invoke(event("u1", "p1", { spotId: SPOT }));
            expect(res.statusCode).toBe(200);
            expect(upd().UpdateExpression).toMatch(/SET .*#spotId = :spotId/);
            expect(upd().ExpressionAttributeValues?.[":spotId"]).toBe(SPOT);
        });

        it("null で外せる", async () => {
            mockDdbSend.mockResolvedValueOnce({ Item: { id: "p1", userId: "u1", spotId: SPOT } }).mockResolvedValueOnce({});
            const res = await invoke(event("u1", "p1", { spotId: null }));
            expect(res.statusCode).toBe(200);
            expect(upd().UpdateExpression).toMatch(/REMOVE .*#spotId/);
        });

        it("形の違う spotId は 400（付けてあった紐付けを黙って消さない）", async () => {
            const res = await invoke(event("u1", "p1", { spotId: "高屋神社" }));
            expect(res.statusCode).toBe(400);
            expect(mockDdbSend).not.toHaveBeenCalled();
        });

        it("他人の写真には付けられない", async () => {
            mockDdbSend.mockResolvedValueOnce({ Item: { id: "p1", userId: "someone" } });
            const res = await invoke(event("u1", "p1", { spotId: SPOT }));
            expect(res.statusCode).toBe(403);
            expect(mockDdbSend).toHaveBeenCalledTimes(1);
        });
    });

    // **公開一覧用 GSI の印を一緒に動かす。** 忘れると、非公開にした写真が
    // 一覧に出続ける／公開に戻した写真が二度と一覧に出ない
    it("非公開にしたら、公開一覧の印を外す", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1" } })
            .mockResolvedValueOnce({});
        await invoke(event("u1", "p1", { published: false }));
        const update = (mockDdbSend.mock.calls[1][0] as { input: { UpdateExpression: string; ExpressionAttributeNames?: Record<string, string> } }).input;
        expect(update.UpdateExpression, "印が残ると非公開の写真が一覧に出る").toMatch(/REMOVE[^]*#publicFeed/);
        expect(update.ExpressionAttributeNames?.["#publicFeed"]).toBe("publicFeed");
    });

    it("公開に戻したら、公開一覧の印を付け直す", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1", published: false } })
            .mockResolvedValueOnce({});
        await invoke(event("u1", "p1", { published: true }));
        const update = (mockDdbSend.mock.calls[1][0] as { input: { UpdateExpression: string; ExpressionAttributeValues: Record<string, unknown> } }).input;
        expect(update.UpdateExpression, "印が無いと二度と一覧に出ない").toContain("publicFeed = :pf");
        expect(update.ExpressionAttributeValues[":pf"]).toBe("1");
    });

    // 🔴 **編集画面は保存のたびに `published: true` を同梱する。**
    // 印を無条件に `"1"` へ戻していた頃は、「フォロワーのみ」の写真を
    // 題を直して保存し直すだけで**全体に公開**になった。索引にしか
    // 現れないので、行を見ても画面を見ても気づけない
    it("絞ってある写真を保存し直しても、全体に公開へ戻らない", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1", audience: "followers" } })
            .mockResolvedValueOnce({});
        await invoke(event("u1", "p1", { published: true, title: "あたらしい題" }));
        const update = (mockDdbSend.mock.calls[1][0] as { input: { ExpressionAttributeValues: Record<string, unknown> } }).input;
        expect(update.ExpressionAttributeValues[":pf"], "絞りの仕切りのまま").toBe("restricted");
    });

    it("公開範囲を外したら、公開一覧の仕切りへ戻す", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1", audience: "followers" } })
            .mockResolvedValueOnce({});
        await invoke(event("u1", "p1", { published: true, audience: null }));
        const update = (mockDdbSend.mock.calls[1][0] as { input: { UpdateExpression: string; ExpressionAttributeValues: Record<string, unknown> } }).input;
        expect(update.ExpressionAttributeValues[":pf"]).toBe("1");
        expect(update.UpdateExpression, "属性も消さないと索引と食い違う").toMatch(/REMOVE[^]*#audience/);
    });

    it("公開範囲を付けたら、絞りの仕切りへ移す", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1" } })
            .mockResolvedValueOnce({});
        await invoke(event("u1", "p1", { published: true, audience: "closeFriends" }));
        const update = (mockDdbSend.mock.calls[1][0] as { input: { ExpressionAttributeValues: Record<string, unknown> } }).input;
        expect(update.ExpressionAttributeValues[":pf"]).toBe("restricted");
        expect(update.ExpressionAttributeValues[":aud"]).toBe("closeFriends");
    });

    // 🔴 **知らない公開範囲は 400 で断る。** 以前はここで黙って落として
    // いたので、綴りを間違えた保存（`"follower"`・`"close_friends"`・
    // 将来足した値を古いサーバーが受けた場合）が**そのまま全体に公開**に
    // なっていた。他の項目なら「無視する」で済むが、これは公開範囲なので
    // **分からないときに開く方へ倒れてはいけない**
    it("知らない公開範囲は断る（全体に公開へ倒さない）", async () => {
        for (const bad of ["mutuals", "follower", "close_friends", "public", 1, {}]) {
            mockDdbSend.mockReset()
                .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1", audience: "followers" } })
                .mockResolvedValueOnce({});
            const res = await invoke(event("u1", "p1", { published: true, audience: bad }));
            expect(res.statusCode, String(bad)).toBe(400);
            // **1行も書かない**（いまの「フォロワーのみ」がそのまま残る）
            expect(mockDdbSend.mock.calls.some(
                (c) => "UpdateExpression" in ((c[0] as { input: Record<string, unknown> }).input)),
                String(bad)).toBe(false);
        }
    });

    // **空にするのは通す**（はっきりした「全体に公開へ戻す」の意思表示）
    it("null と空文字は、今までどおり解除として通る", async () => {
        for (const blank of [null, "", "   "]) {
            mockDdbSend.mockReset()
                .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1", audience: "followers" } })
                .mockResolvedValueOnce({});
            const res = await invoke(event("u1", "p1", { published: true, audience: blank }));
            expect(res.statusCode, String(blank)).toBe(200);
            const update = (mockDdbSend.mock.calls[1][0] as { input: { UpdateExpression: string } }).input;
            expect(update.UpdateExpression, String(blank)).toMatch(/REMOVE[^]*#audience/);
        }
    });

    // 公開状態を触っていない保存（曲だけ変えた等）で印に触ると、
    // 索引の中身が編集のたびに書き換わる
    it("published を送っていなければ、印には触らない", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1" } })
            .mockResolvedValueOnce({});
        await invoke(event("u1", "p1", { songYoutubeUrl: "https://www.youtube.com/watch?v=abcdefghijk" }));
        const update = (mockDdbSend.mock.calls[1][0] as { input: { UpdateExpression: string } }).input;
        expect(update.UpdateExpression).not.toContain("publicFeed");
    });

    it("DynamoDB エラーは 500", async () => {
        mockDdbSend.mockRejectedValueOnce(new Error("boom"));
        const res = await invoke(event("u1", "p1", { published: true }));
        expect(res.statusCode).toBe(500);
    });

    it("有効な YouTube URL は songYoutubeUrl に保存される", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1" } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { songYoutubeUrl: "https://youtu.be/dQw4w9WgXcQ" }));
        expect(res.statusCode).toBe(200);
        const update = (mockDdbSend.mock.calls[1][0] as { input: { UpdateExpression: string; ExpressionAttributeValues: Record<string, unknown> } }).input;
        expect(update.UpdateExpression).toContain("songYoutubeUrl");
        expect(update.ExpressionAttributeValues[":yt"]).toBe("https://youtu.be/dQw4w9WgXcQ");
    });

    it("不正な YouTube URL は 400", async () => {
        const res = await invoke(event("u1", "p1", { songYoutubeUrl: "https://evil.example.com/x" }));
        expect(res.statusCode).toBe(400);
    });

    it("空文字の songYoutubeUrl は REMOVE になる", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1" } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { songYoutubeUrl: "" }));
        expect(res.statusCode).toBe(200);
        const update = (mockDdbSend.mock.calls[1][0] as { input: { UpdateExpression: string } }).input;
        expect(update.UpdateExpression).toContain("REMOVE songYoutubeUrl");
    });
});

type UpdateInput = {
    UpdateExpression: string;
    ExpressionAttributeValues: Record<string, unknown>;
    ExpressionAttributeNames?: Record<string, string>;
};
const lastUpdate = (): UpdateInput => (mockDdbSend.mock.calls[1][0] as { input: UpdateInput }).input;

describe("updatePhotoVisibility: 下書きのメタデータ編集", () => {
    it("メタ項目が何も無ければ 400（更新項目なし）", async () => {
        const res = await invoke(event("u1", "p1", { foo: "bar" }));
        expect(res.statusCode).toBe(400);
    });

    it("所有者は title/location/category/tags を更新でき、#名前で SET される", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1" } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", {
            title: "夕焼けの湖", location: "山中湖", category: "風景", tags: ["夕焼け", "湖"], date: "2026-01-20",
        }));
        expect(res.statusCode).toBe(200);
        const u = lastUpdate();
        expect(u.ExpressionAttributeNames?.["#title"]).toBe("title");
        expect(u.ExpressionAttributeNames?.["#location"]).toBe("location");
        expect(u.ExpressionAttributeValues[":title"]).toBe("夕焼けの湖");
        expect(u.ExpressionAttributeValues[":location"]).toBe("山中湖");
        expect(u.ExpressionAttributeValues[":category"]).toBe("風景");
        expect(u.ExpressionAttributeValues[":tags"]).toEqual(["夕焼け", "湖"]);
        // 撮影日は upload.ts と同じ検証（sanitizeDate）を通す。
        // 日付だけの値は日付のまま（0時を捏造しない）
        expect(u.ExpressionAttributeValues[":date"]).toBe("2026-01-20");
    });

    // 画面は「変えた項目だけ」を送るようになった（7232340 / 9df0ec2）。
    // 公開ボタンだけ押した回は body が `{ published }` になり、メタ項目は
    // どれも指定されない＝**何も消してはいけない**。
    // ここを固定しないと、applyMeta を「常に addressed」に直した瞬間に
    // タイトル・説明・撮影地・タグが REMOVE で吹き飛ぶ（それでも
    // 「公開できる」テストは全部通ってしまう）。
    it("公開状態だけの保存では、何も REMOVE しない", async () => {
        mockDdbSend
            .mockResolvedValueOnce({
                Item: {
                    id: "p1", userId: "u1", published: false,
                    title: "夕焼けの湖", description: "湖畔から", location: "山中湖",
                    category: "風景", tags: ["夕焼け"], date: "2026-01-20",
                },
            })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { published: true }));
        expect(res.statusCode).toBe(200);

        const u = lastUpdate();
        expect(u.UpdateExpression).not.toContain("REMOVE");
        // 触るのは published と updatedAt だけ
        expect(u.UpdateExpression).toContain("published");
        // 属性は #名前 で参照される（updatedAt に "date" が含まれるので、
        // 素の文字列で探すと "date" が誤ってヒットする）
        for (const col of ["title", "description", "location", "category", "tags", "date"]) {
            expect(u.UpdateExpression).not.toContain(`#${col}`);
            expect(u.ExpressionAttributeNames ?? {}).not.toHaveProperty(`#${col}`);
        }
    });

    // 逆向きの正常系: 指定された項目を空で送れば今までどおり消せる
    // （「何も REMOVE しない」を REMOVE 自体の削除で通してしまわないため）
    it("空で指定された項目は今までどおり REMOVE する", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1", location: "山中湖" } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { location: "" }));
        expect(res.statusCode).toBe(200);
        expect(lastUpdate().UpdateExpression).toContain("REMOVE #location");
    });

    it("メタ編集と公開を同時に行える（下書き→公開）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1", published: false } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { title: "タイトル", published: true }));
        expect(res.statusCode).toBe(200);
        const u = lastUpdate();
        expect(u.ExpressionAttributeValues[":p"]).toBe(true);
        expect(u.ExpressionAttributeValues[":title"]).toBe("タイトル");
    });

    it("空文字/空配列のメタは REMOVE でクリアされる", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1" } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { title: "  ", tags: [] }));
        expect(res.statusCode).toBe(200);
        const u = lastUpdate();
        expect(u.UpdateExpression).toContain("REMOVE");
        expect(u.UpdateExpression).toContain("#title");
        expect(u.UpdateExpression).toContain("#tags");
    });

    it("メタ編集も所有権チェックされる（他人の写真は 403）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "p1", userId: "owner" } });
        const res = await invoke(event("attacker", "p1", { title: "乗っ取り" }));
        expect(res.statusCode).toBe(403);
        expect(mockDdbSend).toHaveBeenCalledTimes(1);
    });

    it("tags は文字列以外を除去し30件・各50文字に制限", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1" } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { tags: ["ok", 123, "  ", "x".repeat(80)] }));
        expect(res.statusCode).toBe(200);
        const tags = lastUpdate().ExpressionAttributeValues[":tags"] as string[];
        expect(tags).toContain("ok");
        expect(tags).not.toContain(123);
        expect(tags.every((t) => t.length <= 50)).toBe(true);
    });
});

describe("isValidYouTubeUrl", () => {
    it("youtube.com / youtu.be を許可", () => {
        expect(isValidYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
        expect(isValidYouTubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("https://youtu.be/dQw4w9WgXcQ");
    });

    it("他ホスト・http・非文字列は undefined", () => {
        expect(isValidYouTubeUrl("https://vimeo.com/12345")).toBeUndefined();
        expect(isValidYouTubeUrl("http://youtu.be/dQw4w9WgXcQ")).toBeUndefined();
        expect(isValidYouTubeUrl(123)).toBeUndefined();
        expect(isValidYouTubeUrl("not a url")).toBeUndefined();
    });
});

// 撮影日は年表の並び順の元になる。保存経路によって検証が違うと、
// 編集経由だけ任意の文字列が入って並びが壊れる。
describe("updatePhotoVisibility: 撮影日の検証", () => {
    // **「保存しない」から「断る」へ変えた。** 黙って落とすと、
    // `applyMeta` が undefined を「消す」と読んで**保存済みの日付を消す**
    // ——入れ直しただけで消えるのに画面は「保存しました」と出ていた
    it("日付でない文字列は 400 で断る（黙って落として日付を消さない）", async () => {
        const res = await invoke(event("u1", "p1", { date: "きのう撮った写真です" }));
        expect(res.statusCode).toBe(400);
        expect(mockDdbSend, "断るのに写真を読みに行っている").not.toHaveBeenCalled();
    });

    // **「消したい」と「読めない」を同じ undefined にしていたので、
    // 1985年と入れ直しただけで保存済みの撮影日が消えていた**（画面は
    // 「保存しました」）。フィルムの取り込みなど 1990年より前は実在する
    it("読めない撮影日は 400 で断る（黙って消さない）", async () => {
        for (const bad of ["1985-06-01", "1989-12-31", "2099-01-01"]) {
            mockDdbSend.mockReset();
            const res = await invoke(event("owner", "p1", { published: true, date: bad }));
            expect(res.statusCode, bad).toBe(400);
            expect(JSON.parse(res.body).error).toContain("撮影日");
            // **写真を1回も読みに行かない**＝書き込みまで届いていない
            expect(mockDdbSend, bad).not.toHaveBeenCalled();
        }
    });

    // **消す意図は null・undefined・空文字だけ。** 数値や配列を「消す」と読むと、
    // 同じ「黙って消える」が別の入口から戻ってくる（画面からは踏めないが、
    // JSDoc は「値は来ているが使えないときだけ true」と書いてある）
    it("日付でない型（数値・真偽・配列・オブジェクト）も断る", async () => {
        for (const bad of [12345, 0, true, ["2024-01-01"], { y: 2024 }]) {
            mockDdbSend.mockReset();
            const res = await invoke(event("owner", "p1", { published: true, date: bad }));
            expect(res.statusCode, JSON.stringify(bad)).toBe(400);
            expect(mockDdbSend, JSON.stringify(bad)).not.toHaveBeenCalled();
        }
    });

    it("null は「消す」（断らない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true, date: "2024-10-12" } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("owner", "p1", { published: true, date: null }));
        expect(res.statusCode).toBe(200);
    });

    it("空の撮影日は今までどおり「消す」（断らない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true, date: "2024-10-12" } }).mockResolvedValueOnce({});
        const res = await invoke(event("owner", "p1", { published: true, date: "" }));
        expect(res.statusCode).toBe(200);
        const updates = mockDdbSend.mock.calls.map((c) => c[0])
            .filter((cmd) => (cmd as { constructor: { name: string } })?.constructor?.name === "UpdateCommand");
        // **何の REMOVE かまで見る。** "REMOVE" を含むだけだと別の属性でも緑
        expect(updates.some((u) => /REMOVE[^A-Z]*#date\b/.test(
            String((u as { input: { UpdateExpression: string } }).input.UpdateExpression))),
            "撮影日が消えていない").toBe(true);
    });

    it("範囲内の撮影日は通る（境界の 1990-01-01 を含む）", async () => {
        for (const ok of ["1990-01-01", "2024-10-12"]) {
            mockDdbSend.mockReset().mockResolvedValueOnce({ Item: { id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true } }).mockResolvedValueOnce({});
            const res = await invoke(event("owner", "p1", { published: true, date: ok }));
            expect(res.statusCode, ok).toBe(200);
        }
    });


    // 以前は「保存経路で表記を揃える」として ISO に正規化していたが、
    // "2024-05-01" → "…T00:00:00.000Z" は表示側（photoDate.ts の
    // 「時刻は書かれていれば出す」）に **0時ちょうどという存在しない時刻**を
    // 描かせていた。/user/edit の撮影日入力は日付だけを送る。日付は保つ。
    it("YYYY-MM-DD は日付のまま保存する（0時を捏造しない）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1" } })
            .mockResolvedValueOnce({});
        await invoke(event("u1", "p1", { date: "2024-05-01" }));
        expect(lastUpdate().ExpressionAttributeValues[":date"]).toBe("2024-05-01");
    });
});


// 静的ページの作り直しを頼むかどうか。
//
// 「キーが body にあるか」で見ていた時期があるが、それは実質「毎回」
// だった——/user/edit は保存のたびに title/description/location/category/
// date/tags/published を必ず全部送る。何も書き換えずに保存を2回押すだけで
// ビルドが2本走る（1本8分・Actions の枠は月2,000分）。
describe("updatePhotoVisibility: 静的ページの作り直し", () => {
    const stored = {
        id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true,
        title: { ja: "海" }, description: { ja: ["静かだった"] },
        location: "北海道", category: "風景", tags: ["海", "夏"],
    };
    const fullSave = (over: Record<string, unknown> = {}) => ({
        title: { ja: "海" }, description: { ja: ["静かだった"] },
        location: "北海道", category: "風景", tags: ["海", "夏"],
        published: true, ...over,
    });

    it("同じ内容を送り直す保存では頼まない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: stored }).mockResolvedValueOnce({});
        expect((await invoke(event("owner", "p1", fullSave()))).statusCode).toBe(200);
        expect(mockRebuild).not.toHaveBeenCalled();
    });

    // タグ未入力の下書きは `tags` 属性そのものを持たない。/user/edit は
    // タグ欄が空でも必ず `tags: []` を送るので、空配列をそのまま比べていた
    // 頃は毎回「変わった」になった。しかも書き込みは REMOVE（＝何も変えない）
    // なので次の保存でも同じ判定になり、**永久に**ビルドが走り続けた。
    it("タグを持たない写真に空のタグを送っても頼まない", async () => {
        const noTags = { id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true, title: { ja: "海" } };
        mockDdbSend.mockResolvedValueOnce({ Item: noTags }).mockResolvedValueOnce({});
        await invoke(event("owner", "p1", { title: { ja: "海" }, tags: [], published: true }));
        expect(mockRebuild).not.toHaveBeenCalled();
        // 書き込み自体は今までどおり REMOVE を組み立てる
        const update = (mockDdbSend.mock.calls[1][0] as { input: { UpdateExpression: string } }).input;
        expect(update.UpdateExpression).toContain("REMOVE #tags");
    });

    it("タグが付いていた写真から全部外したら頼む", async () => {
        const withTags = { id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true, tags: ["海"] };
        mockDdbSend.mockResolvedValueOnce({ Item: withTags }).mockResolvedValueOnce({});
        await invoke(event("owner", "p1", { tags: [], published: true }));
        expect(mockRebuild).toHaveBeenCalledTimes(1);
    });

    it("説明を消したら頼む（静的HTMLと JSON-LD に残るため）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: stored }).mockResolvedValueOnce({});
        await invoke(event("owner", "p1", fullSave({ description: "" })));
        expect(mockRebuild).toHaveBeenCalledTimes(1);
        expect(mockRebuild.mock.calls[0][1]).toEqual({ coalesce: true });
    });

    it("公開状態を変えたら頼む", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: stored }).mockResolvedValueOnce({});
        await invoke(event("owner", "p1", fullSave({ published: false })));
        expect(mockRebuild).toHaveBeenCalledTimes(1);
    });

    it("写真BGMだけ変えても頼まない（静的ページに出ない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: stored }).mockResolvedValueOnce({});
        await invoke(event("owner", "p1", {
            song: { title: "曲", previewUrl: "https://audio-ssl.itunes.apple.com/x.m4a" },
        }));
        expect(mockRebuild).not.toHaveBeenCalled();
    });
});

// DynamoDB の UpdateItem は、キーが無ければ**行を作る**。
// ここは「Get で所有権を確かめる → Update」の2段なので、その間に写真が
// 消えると（別タブで削除・退会の掃除と競合）、`src` も `userId` も持たない
// 行ができる。一覧（attribute_exists(src)）・GSI（userId 無し）・詳細
// （!photo.src で404）のどれからも辿れず、本人には消す手段がない。
//
// 対の api/src/ddb-photos.ts:115 は同じ理由で同じ条件を付けていて、
// テスト（api/src/__tests__/ddbPhotos.test.ts）もある。こちらだけ
// **条件も、それを見るテストも無かった**（付けても外しても25本通った）。
describe("消えた写真を作り直さない", () => {
    it("更新には attribute_exists(id) を付ける", async () => {
        mockDdbSend.mockReset();
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1", src: "https://cdn/p1.jpg", published: true } })
            .mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { published: false }));
        expect(res.statusCode).toBe(200);

        const update = mockDdbSend.mock.calls
            .map((c) => c[0])
            .find((cmd) => cmd?.constructor?.name === "UpdateCommand");
        expect(update.input.ConditionExpression).toBe("attribute_exists(id)");
    });

    it("条件が外れたら 404（500 で「再試行」と読ませない）", async () => {
        // Get は成功、Update だけ条件で落ちる
        mockDdbSend.mockReset();
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1", src: "https://cdn/p1.jpg", published: true } })
            .mockImplementationOnce(() => Promise.reject(
                Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" })));
        const res = await invoke(event("u1", "p1", { published: false }));
        expect(res.statusCode).toBe(404);
        expect(JSON.parse(res.body).error).toContain("見つかりません");
    });
});


// 通知・コメント・フォロー・いいねの文書も同じキー空間にいる。
// 読み側（getPhoto）・削除側（deleteMyPhoto）・管理API は全部 `#` を弾くのに、
// **更新側だけ無かった**。
//
// 今は別の一枚で塞がっている——内部文書は所有者を `uid` という別名で持ち
// `userId` を持たないので `!ownerId` で 403 になる。つまり「`uid` と
// `userId` を使い分ける」という**暗黙の約束1本**で持っていた。
// 次に誰かが内部文書に `userId` を書いた瞬間に開く。
describe("updatePhotoVisibility: 写真以外は触らせない", () => {
    it.each([
        "notifs#me",
        "comments#p1",
        "following#me",
        "followstats#me",
    ])("%s は 404（DDB を触らない）", async (id) => {
        const res = await invoke(event("u1", id, { published: true }));
        expect(res.statusCode).toBe(404);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    // `userId` を持つ内部文書が現れても、入口で止まること
    it("内部文書が userId を持っていても届かない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "notifs#u1", userId: "u1" } });
        const res = await invoke(event("u1", "notifs#u1", { published: true }));
        expect(res.statusCode).toBe(404);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });
});

// **隠す操作は、畳んではいけない。**
//
// 畳まれた依頼は後から実行されない（定期ビルドも止めてある）ので、
// 非公開にしたのに `/photo/<id>` の静的HTML が本文・撮影地・EXIF・
// 表示名入りの JSON-LD ごと出たままになる。本文の編集なら「古い文が残る」で
// 済むが、隠す操作でそれは**隠せていない**ということ。
describe("非公開にするときの再ビルド依頼", () => {
    const stored2 = { id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true };

    // **一度ここを素通しにして、逆向きに倒した。**
    // クールダウンは `coalesce` を指定したときしか効かないのに、月次予算は
    // 指定の有無に関わらず1加算される。つまりクールダウンは
    // 「予算を減らす速度の唯一の歯止め」でもあった——素通しにすると
    // トグル200回で月の予算を使い切れ、その月いっぱい**削除・退会の掃除が
    // 全部落ちる**。「隠すのが遅れる」を直して「消したのに残る」を月単位で
    // 作る取り引きだった。畳んだうえで、届かなかったことを下の印で残す。
    it("隠すときも畳む（予算を減らす速度の歯止めを外さない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: stored2 }).mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(true);
        await invoke(event("owner", "p1", { published: false }));
        expect(mockRebuild).toHaveBeenCalledTimes(1);
        expect(mockRebuild.mock.calls[0][1]).toEqual({ coalesce: true });
    });

    it("公開する側は今までどおり畳む（遅れて出るのは privacy の失敗ではない）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { ...stored2, published: false } })
            .mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(true);
        await invoke(event("owner", "p1", { published: true }));
        expect(mockRebuild.mock.calls[0][1]).toEqual({ coalesce: true });
    });

    // **頼めなかったことを行に残す。** 削除側は「非公開だった写真には
    // 静的ページが無い」と決め打ちして掃除を省くので、その前提が崩れたことを
    // 伝えないと、非公開 →（依頼が届かない）→ 削除 で誰にも消されない
    it("頼めなかったら staticStale を立てる", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: stored2 }).mockResolvedValueOnce({}).mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(false);   // 予算切れ・設定漏れ・dispatch 失敗
        const res = await invoke(event("owner", "p1", { published: false }));
        expect(res.statusCode).toBe(200);   // 非公開そのものは成立している

        const updates = mockDdbSend.mock.calls.map((c) => c[0])
            .filter((cmd) => (cmd as { constructor: { name: string } })?.constructor?.name === "UpdateCommand");
        expect(updates.some((u) => String((u as { input: { UpdateExpression: string } }).input.UpdateExpression)
            .includes("staticStale")), "頼めなかったのに印を残していない").toBe(true);
    });

    // 残したままだと、再公開 → もう一度隠す（成功）のあとも
    // 「掃除が届いていない」ことになり、削除のたびに要らないビルドが1本
    it("頼めたら、立っていた印を下ろす", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { ...stored2, staticStale: true } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(true);
        await invoke(event("owner", "p1", { published: false }));

        const updates = mockDdbSend.mock.calls.map((c) => c[0])
            .filter((cmd) => (cmd as { constructor: { name: string } })?.constructor?.name === "UpdateCommand");
        expect(updates.some((u) => String((u as { input: { UpdateExpression: string } }).input.UpdateExpression)
            .includes("REMOVE staticStale")), "印が立ったまま残る").toBe(true);
    });

    // **画面に伝える。** 印を行に書くだけでは、押した本人には何も分からない
    // ——「非公開にしました」と出るのに、検索から開けるページは残っている
    it("頼めなかったことを応答でも伝える（画面が「隠せた」と言い切らないように）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: stored2 }).mockResolvedValueOnce({}).mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(false);
        const res = await invoke(event("owner", "p1", { published: false }));
        expect(JSON.parse(res.body)).toEqual({ success: true, staticStale: true });
    });

    it("印を行に書けなくても、応答では伝える（残ることは変わらない）", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: stored2 })
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(new Error("throttled"));   // 印の書き込みだけ失敗
        mockRebuild.mockResolvedValue(false);
        const res = await invoke(event("owner", "p1", { published: false }));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).staticStale).toBe(true);
    });

    it("頼めたら応答に印を載せない（要らない不安を出さない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: stored2 }).mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(true);
        const res = await invoke(event("owner", "p1", { published: false }));
        expect(JSON.parse(res.body)).toEqual({ success: true });
    });

    it("公開する側では印を載せない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { ...stored2, published: false } }).mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(false);
        const res = await invoke(event("owner", "p1", { published: true }));
        expect(JSON.parse(res.body)).toEqual({ success: true });
    });

    // **消す意図の操作が公開ページに反映されない**のは、非公開・削除と同じ約束違反。
    // 説明に書いた最寄り駅を消しても、静的HTMLと JSON-LD には残る
    it("公開のまま項目を消して頼めなかったら、そう伝える", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { ...stored2, description: "最寄りは○○駅" } }).mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(false);
        const res = await invoke(event("owner", "p1", { published: true, description: "" }));
        expect(JSON.parse(res.body)).toEqual({ success: true, staticOutdated: true });
    });

    // 書き換えは「更新が遅れている」だけ。毎回の保存で断りが出ると、
    // 肝心のとき（消したとき）に読まれなくなる
    // **頼めたなら言わない。** `!dispatched` を落としても全部緑だった
    // ——本番はトークン未設定で常に false なので今は無害だが、owner が
    // トークンを入れた日に「もう消えているのに残ると言う」へ静かに変わる
    it("掃除を頼めたなら、消していても言わない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { ...stored2, description: "あ" } }).mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(true);
        const res = await invoke(event("owner", "p1", { published: true, description: "" }));
        expect(JSON.parse(res.body)).toEqual({ success: true });
    });

    // **過去の事故と同じ形。** `/user/edit` はタグを毎回 `[]` で送るので、
    // 「変わったか」を見ずに `willRemove` だけで数えると、タグを持たない写真を
    // 保存するたびに8秒の断りが出る
    it("もともと空の項目に空を送っても、消したことにしない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: stored2 }).mockResolvedValueOnce({});   // tags を持たない
        mockRebuild.mockResolvedValue(false);
        const res = await invoke(event("owner", "p1", { published: true, tags: [] }));
        expect(JSON.parse(res.body)).toEqual({ success: true });
    });

    // 静的ページがまだ無い（下書きを公開しながら項目を消した）ときに
    // 「ページに残る」と言わない
    it("下書きを公開しながら項目を消しても言わない（ページがまだ無い）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { ...stored2, published: false, description: "あ" } })
            .mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(false);
        const res = await invoke(event("owner", "p1", { published: true, description: "" }));
        expect(JSON.parse(res.body)).toEqual({ success: true });
    });

    // ただし「非公開にしたが掃除が届かなかった」写真にはページが在る
    it("掃除の届いていない非公開写真を公開し直しながら消したら、言う", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { ...stored2, published: false, staticStale: true, description: "あ" } })
            .mockResolvedValueOnce({}).mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(false);
        const res = await invoke(event("owner", "p1", { published: true, description: "" }));
        expect(JSON.parse(res.body)).toEqual({ success: true, staticOutdated: true });
    });

    // `published` を送らない呼び出し（この画面は毎回送るが、他の口・古いタブ）
    it("published を送らない保存でも、ページが無ければ黙る", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { ...stored2, published: false, description: "あ" } })
            .mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(false);
        const res = await invoke(event("owner", "p1", { description: "" }));
        expect(JSON.parse(res.body), "下書きなのにページが在ると言っている").toEqual({ success: true });
    });

    // **非公開なら黙る、にしてはいけない。** 本番は掃除の依頼が毎回落ちるので、
    // 「非公開にした写真」のページは公開されたまま。そこを下書きとして編集して
    // 項目を消せば、消した内容が公開ページに出たままになる
    it("掃除の届いていない非公開写真を下書きのまま編集して消したら、言う", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { ...stored2, published: false, staticStale: true, description: "あ" } })
            .mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(false);
        const res = await invoke(event("owner", "p1", { published: false, description: "" }));
        expect(JSON.parse(res.body)).toEqual({ success: true, staticOutdated: true });
    });

    it("書き換えただけなら言わない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { ...stored2, title: "前の題" } }).mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(false);
        const res = await invoke(event("owner", "p1", { published: true, title: "新しい題" }));
        expect(JSON.parse(res.body)).toEqual({ success: true });
    });

    it("下書きのまま項目を消しても言わない（静的ページが無い）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { ...stored2, published: false, description: "あ" } }).mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(false);
        const res = await invoke(event("owner", "p1", { published: false, description: "" }));
        expect(JSON.parse(res.body)).toEqual({ success: true });
    });

    // **両方立つ場合は強い方を出す。**「隠したはずのページがまだ取れる」の中に
    // 「消した内容も出ている」は含まれる
    it("非公開にしながら項目を消したときは、ページが残る方を出す", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { ...stored2, description: "あ" } })
            .mockResolvedValueOnce({}).mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(false);
        const res = await invoke(event("owner", "p1", { published: false, description: "" }));
        expect(JSON.parse(res.body)).toEqual({ success: true, staticStale: true });
    });

    it("頼めたときは印を立てない（余計な書き込みをしない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: stored2 }).mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(true);
        await invoke(event("owner", "p1", { published: false }));

        const updates = mockDdbSend.mock.calls.map((c) => c[0])
            .filter((cmd) => (cmd as { constructor: { name: string } })?.constructor?.name === "UpdateCommand");
        expect(updates.some((u) => String((u as { input: { UpdateExpression: string } }).input.UpdateExpression)
            .includes("staticStale"))).toBe(false);
    });
});

// **印を下ろすのは、実際に依頼を出して届いたときだけ。**
//
// `dispatched` の初期値を `true` にして「依頼したかどうか」を見ていなかった
// ので、**何も変えずに『保存』を押しただけ**で（依頼は1本も出ていないのに）
// 印が下りていた。画面は `published` を毎回同梱するので、値が同じなら
// `visibilityChanged` も `metaChanged` も false になる——そのあと削除しても
// 掃除を頼まず、塞いだはずの穴が**印を消す側から**戻ってくる。
describe("何も変わっていない保存では、印を触らない", () => {
    const hidden = { id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: false, staticStale: true };

    it("依頼を出していないなら、印は下ろさない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: hidden }).mockResolvedValueOnce({});
        mockRebuild.mockClear();
        // 非公開のまま、値も変えずに保存（画面は published を毎回送る）
        await invoke(event("owner", "p1", { published: false }));

        expect(mockRebuild, "何も変わっていないのに依頼を出している").not.toHaveBeenCalled();
        const updates = mockDdbSend.mock.calls.map((c) => c[0])
            .filter((cmd) => (cmd as { constructor: { name: string } })?.constructor?.name === "UpdateCommand");
        expect(updates.some((u) => String((u as { input: { UpdateExpression: string } }).input.UpdateExpression)
            .includes("REMOVE staticStale")), "依頼していないのに印を下ろした").toBe(false);
    });

    it("BGM だけ変えた保存でも下ろさない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: hidden }).mockResolvedValueOnce({});
        mockRebuild.mockClear();
        await invoke(event("owner", "p1", { song: null }));

        const updates = mockDdbSend.mock.calls.map((c) => c[0])
            .filter((cmd) => (cmd as { constructor: { name: string } })?.constructor?.name === "UpdateCommand");
        expect(updates.some((u) => String((u as { input: { UpdateExpression: string } }).input.UpdateExpression)
            .includes("REMOVE staticStale"))).toBe(false);
    });
});

// Get → Update の2段なので、その間に写真が消えると `staticStale` だけを
// 持つ**幽霊行**ができる（一覧・GSI・詳細のどれからも辿れず、本人にも
// 消せない）。本体の更新は同じ理由で条件を付けてある。印の2本も同じ。
describe("印の書き込みも幽霊行を作らない", () => {
    it("staticStale の Update には attribute_exists(id) が付く", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(false);   // 届かない → 印を立てる
        await invoke(event("owner", "p1", { published: false }));

        const marks = mockDdbSend.mock.calls.map((c) => c[0])
            .filter((cmd) => (cmd as { constructor: { name: string } })?.constructor?.name === "UpdateCommand")
            .filter((u) => String((u as { input: { UpdateExpression: string } }).input.UpdateExpression).includes("staticStale"));
        expect(marks).toHaveLength(1);
        expect((marks[0] as { input: { ConditionExpression?: string } }).input.ConditionExpression,
            "幽霊行を作りうる書き込みに条件が無い").toBe("attribute_exists(id)");
    });

    it("印を下ろす Update にも付く", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "owner", src: "https://cdn/p1.jpg", published: true, staticStale: true } })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
        mockRebuild.mockResolvedValue(true);
        await invoke(event("owner", "p1", { published: false }));

        const marks = mockDdbSend.mock.calls.map((c) => c[0])
            .filter((cmd) => (cmd as { constructor: { name: string } })?.constructor?.name === "UpdateCommand")
            .filter((u) => String((u as { input: { UpdateExpression: string } }).input.UpdateExpression).includes("REMOVE staticStale"));
        expect(marks).toHaveLength(1);
        expect((marks[0] as { input: { ConditionExpression?: string } }).input.ConditionExpression).toBe("attribute_exists(id)");
    });
});

// **地名から補った座標（geoApprox）は地名に付随する。**
// `scripts/geocode-locations.js` が「パリ」から引いた街の中心は、撮影地を
// 「ロンドン」に直した瞬間に嘘になる（/map で「ロンドン（おおよそ）」の
// ピンがパリに立つ）。編集画面は座標を送らないので、残すと利用者には直す
// 手段が無い。逆に **GPS 由来の正確な座標は地名を直しても消さない**。
describe("updatePhotoVisibility: おおよその座標（geoApprox）の扱い", () => {
    const approxRow = { id: "p1", userId: "u1", location: "パリ", coords: { lat: 48.86, lng: 2.35 }, geoApprox: true };

    it("地名を直したら、地名から補った座標を印ごと捨てる", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: approxRow }).mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { location: "ロンドン" }));
        expect(res.statusCode).toBe(200);
        const u = lastUpdate();
        expect(u.UpdateExpression).toMatch(/REMOVE .*#coords/);
        expect(u.UpdateExpression).toMatch(/REMOVE .*#geoApprox/);
        expect(u.ExpressionAttributeNames?.["#coords"]).toBe("coords");
        expect(u.ExpressionAttributeNames?.["#geoApprox"]).toBe("geoApprox");
    });

    it("地名を消しても同じ（座標の根拠が無くなる）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: approxRow }).mockResolvedValueOnce({});
        await invoke(event("u1", "p1", { location: "" }));
        expect(lastUpdate().UpdateExpression).toMatch(/REMOVE .*#coords/);
    });

    it("同じ地名を送り直しただけなら触らない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: approxRow }).mockResolvedValueOnce({});
        await invoke(event("u1", "p1", { location: "パリ", title: "新しい題" }));
        const u = lastUpdate();
        expect(u.UpdateExpression).not.toContain("#coords");
        expect(u.UpdateExpression).not.toContain("#geoApprox");
    });

    it("地名に触らない編集（タイトルだけ）では触らない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: approxRow }).mockResolvedValueOnce({});
        await invoke(event("u1", "p1", { title: "新しい題" }));
        const u = lastUpdate();
        expect(u.UpdateExpression).not.toContain("#coords");
        expect(u.UpdateExpression).not.toContain("#geoApprox");
    });

    it("正確な座標を書くなら、座標は SET して「おおよそ」の印だけ下ろす", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: approxRow }).mockResolvedValueOnce({});
        await invoke(event("u1", "p1", { coords: { lat: 48.8584, lng: 2.2945 } }));
        const u = lastUpdate();
        expect(u.UpdateExpression).toMatch(/SET .*#coords = :coords/);
        expect(u.UpdateExpression).toMatch(/REMOVE .*#geoApprox/);
        // 同じ属性を SET と REMOVE の両方に書くと DynamoDB が ValidationException
        expect(u.UpdateExpression.match(/#coords/g)?.length).toBe(1);
        expect(u.ExpressionAttributeValues[":coords"]).toEqual({ lat: 48.86, lng: 2.29 });
    });

    it("座標を消す指定（不正な座標）でも、印だけ孤立させない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: approxRow }).mockResolvedValueOnce({});
        await invoke(event("u1", "p1", { coords: "abc" }));
        const u = lastUpdate();
        expect(u.UpdateExpression).toMatch(/REMOVE .*#coords/);
        expect(u.UpdateExpression).toMatch(/REMOVE .*#geoApprox/);
        expect(u.UpdateExpression.match(/#coords/g)?.length, "同じ属性を2回書いている").toBe(1);
    });

    it("印を下ろしただけでも静的ページの作り直しを頼む（丸めたら同値の座標）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: approxRow }).mockResolvedValueOnce({});
        await invoke(event("u1", "p1", { coords: { lat: 48.8612, lng: 2.3501 } }));
        expect(lastUpdate().UpdateExpression).toMatch(/REMOVE .*#geoApprox/);
        expect(mockRebuild, "JSON-LD の geo と「地図で見る」が変わるのに頼んでいない").toHaveBeenCalled();
    });

    // **逆向きを固定する。** GPS 由来の正確な座標は、地名を書き換えても消さない
    // （写真そのものが持っていた情報で、地名の誤記を直すだけのことは多い）
    it("GPS 由来の座標（geoApprox なし）は、地名を直しても消さない", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1", location: "パリ", coords: { lat: 48.86, lng: 2.35 } } })
            .mockResolvedValueOnce({});
        await invoke(event("u1", "p1", { location: "ロンドン" }));
        const u = lastUpdate();
        expect(u.UpdateExpression).not.toContain("#coords");
        expect(u.UpdateExpression).not.toContain("#geoApprox");
    });
});


// **下書き保存したら、あとで公開してもアルバムに入らなかった。**
// `savePhoto` は `albumId && isPublished` のときだけ入れるので、招待から
// 入った人が「下書き保存」した写真は一生アルバムに出ない——本人の行には
// `albumId` が付いているので、**入ったつもりになる**（画面上は成功して見える）。
describe("公開に切り替えたら、共同アルバムに入れる", () => {
    const world = (item: Record<string, unknown>) => {
        mockDdbSend.mockImplementation((cmd: { constructor: { name: string } }) => {
            if (cmd.constructor.name === "GetCommand") return Promise.resolve({ Item: { id: "p1", src: "s", userId: "u1", ...item } });
            return Promise.resolve({ Attributes: { id: "p1" } });
        });
    };

    it("下書き → 公開 で、アルバムに足す", async () => {
        world({ published: false, albumId: "a1" });
        const res = await invoke(event("u1", "p1", { published: true }));
        expect(res.statusCode).toBe(200);
        expect(mockAddToAlbum, "公開してもアルバムに入らない").toHaveBeenCalledWith("a1", "p1");
    });

    // **「変わった回」で見ると、押し直しが効かない。** 1回目でここが落ちた
    // （スロットル・500枚上限）あと押し直しても `wasPublished` が true で
    // `visibilityChanged` が false ＝公開されているのに一生入らない。
    // `upload.ts` の再送は同じ場面に「再送でもアルバムに足す」で答えている
    it("既に公開済みの写真をもう一度公開しても、アルバムに足しにいく（押し直しで直る）", async () => {
        world({ published: true, albumId: "a1" });
        const res = await invoke(event("u1", "p1", { published: true }));
        expect(res.statusCode).toBe(200);
        expect(mockAddToAlbum, "押し直しても直らない").toHaveBeenCalledWith("a1", "p1");
    });

    // 上の代償。公開中の写真を編集するたびに1回来る（冪等なので増えない）
    it("公開中の写真のメタ情報だけ直しても、足しにいく", async () => {
        world({ published: true, albumId: "a1" });
        const res = await invoke(event("u1", "p1", { title: "新しい題" }));
        expect(res.statusCode).toBe(200);
        expect(mockAddToAlbum).toHaveBeenCalledWith("a1", "p1");
    });

    // **下書きのままなら足さない。** ここを緩めると、招待ページの
    // `published !== false` のふるいだけが最後の砦になる
    it("下書きのままメタ情報を直しても足さない", async () => {
        world({ published: false, albumId: "a1" });
        const res = await invoke(event("u1", "p1", { title: "新しい題" }));
        expect(res.statusCode).toBe(200);
        expect(mockAddToAlbum, "下書きがアルバムに入る").not.toHaveBeenCalled();
    });

    it("アルバムに入っていない写真では呼ばない", async () => {
        world({ published: false });
        await invoke(event("u1", "p1", { published: true }));
        expect(mockAddToAlbum).not.toHaveBeenCalled();
    });

    it("非公開にするときは足さない（外す側の仕事）", async () => {
        world({ published: true, albumId: "a1" });
        await invoke(event("u1", "p1", { published: false }));
        expect(mockAddToAlbum, "非公開にしたのにアルバムへ入れている").not.toHaveBeenCalled();
    });

    // **失敗しても公開は成功で返す**（写真はもう公開されている。
    // `savePhoto` の同じ呼び出しと同じ扱い）
    it("足せなくても公開は成功", async () => {
        world({ published: false, albumId: "a1" });
        mockAddToAlbum.mockRejectedValue(new Error("boom"));
        expect((await invoke(event("u1", "p1", { published: true }))).statusCode).toBe(200);
    });

    // **片側だけの防御にしない。** `savePhoto` は「ここを通さずに
    // `albumId` を保存できると、誰でも他人のアルバムに写真を差し込める」
    // として `isAlbumMember` を通す。こちらは行の `albumId` を信じて
    // 素通しだった。いまは脱退の口が無いので悪用できないが、
    // 「脱退」を足した日に静かに穴になる
    it("もうメンバーでなければ、公開してもアルバムには足さない", async () => {
        world({ published: false, albumId: "a1" });
        mockIsAlbumMember.mockResolvedValue(false);
        expect((await invoke(event("u1", "p1", { published: true }))).statusCode).toBe(200);
        expect(mockAddToAlbum, "メンバーでない人の写真が入っている").not.toHaveBeenCalled();
    });

    // **判定は `UpdateCommand` のあと。** 裸の await を置くと、写真はもう
    // 公開されているのに 500 が返り、押し直すと `visibilityChanged` が
    // false になって**アルバムに足す処理を永久に飛ばす**
    it("メンバー判定が落ちても、公開そのものは成功で返す", async () => {
        world({ published: false, albumId: "a1" });
        mockIsAlbumMember.mockRejectedValue(new Error("throttled"));
        const res = await invoke(event("u1", "p1", { published: true }));
        expect(res.statusCode, "公開できているのに失敗と出る").toBe(200);
        expect(mockAddToAlbum).not.toHaveBeenCalled();
    });

    it("メンバー判定は、そのアルバムと押した本人で見る", async () => {
        world({ published: false, albumId: "a1" });
        await invoke(event("u1", "p1", { published: true }));
        expect(mockIsAlbumMember).toHaveBeenCalledWith("a1", "u1");
    });
});

/**
 * **写真の差し替え**（消して投稿し直さずに実体だけ入れ替える）。
 *
 * 純関数の側は `photoReplace.test.ts` が見る。ここで見るのは**配線**
 * ——この口に届いているか、古い実体を消すか、作り直しを頼むか。
 */
describe("写真の差し替え", () => {
    const old = {
        id: "p1", userId: UID, published: true,
        src: mine("old.webp"), thumbSrc: mine("old_thumb.webp"),
        srcAvif: mine("old.avif"), thumbAvif: mine("old_t.avif"), width: 100, height: 50,
    };
    const replace = { key: `uploads/${UID}/new.webp`, publicUrl: mine("new.webp") };
    const lastUpdate = () => (mockDdbSend.mock.calls[1][0] as {
        input: { UpdateExpression: string; ExpressionAttributeValues: Record<string, unknown> };
    }).input;

    /**
     * 🔴 **この関門に足し忘れると、差し替えだけの保存が 400 で断られる。**
     * `META_KEYS` のコメントが名指しで警告している罠で、実際に踏んだ。
     */
    it("差し替えだけの本文でも受け付ける（更新項目がありません、にしない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: old }).mockResolvedValueOnce({});
        const res = await invoke(event(UID, "p1", { replace }));
        expect(res.statusCode, `断られた: ${res.body}`).toBe(200);
    });

    it("src を新しい実体に差し替える", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: old }).mockResolvedValueOnce({});
        await invoke(event(UID, "p1", { replace }));
        const u = lastUpdate();
        expect(u.ExpressionAttributeValues[":r_src"]).toBe(mine("new.webp"));
    });

    /** 残すと **AVIF を出す端末にだけ古い写真が出続ける** */
    it("ビルドが作る派生を消す（次のビルドで作り直させる）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: old }).mockResolvedValueOnce({});
        await invoke(event(UID, "p1", { replace }));
        const expr = lastUpdate().UpdateExpression;
        for (const f of ["srcAvif", "thumbAvif", "thumbSmAvif", "thumbSm", "width", "height", "aspectRatio"]) {
            expect(expr, `${f} が残る（古い写真が出る）`).toMatch(new RegExp(`REMOVE[^]*#${f}`));
        }
    });

    it("差し替え前の実体を消す（新しい鍵は消さない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: old }).mockResolvedValueOnce({});
        await invoke(event(UID, "p1", { replace }));
        expect(mockS3DeleteMany, "古い実体が S3 に残る").toHaveBeenCalledTimes(1);
        const keys = mockS3DeleteMany.mock.calls[0][0];
        expect(keys, "差し替え前の実体を消していない").toContain(`uploads/${UID}/old.webp`);
        expect(keys, "**いま差し替えた実体を消している**").not.toContain(`uploads/${UID}/new.webp`);
    });

    /**
     * 🔴 **再送で写真が割れないこと。**
     *
     * 保存は届いたのに応答を取り逃して押し直した回、行は**もう新しい実体**を
     * 指している。そこで「古い実体」を素朴に集めると、**差し替えたばかりの
     * ものを消す**——写真ページが割れ、元に戻す手段が無い。
     * `savePhoto` が同じ形の再送を一度踏んでいる。
     */
    it("再送しても、いま指している実体は消さない", async () => {
        // **1回目が通ったあとの本物の姿。** 派生は1回目の更新で REMOVE 済み
        // ——ここを `...old` で作ると AVIF が残り、「消す対象が他にある」ので
        // 肝心の判定（**何も消さない**）が空振りする
        const after = {
            id: "p1", userId: UID, published: true,
            src: mine("new.webp"),
            thumbSrc: mine("new_thumb.webp"),
        };
        mockDdbSend.mockResolvedValueOnce({ Item: after }).mockResolvedValueOnce({});
        const res = await invoke(event(UID, "p1", {
            replace: { ...replace, thumbUrl: mine("new_thumb.webp") },
        }));
        expect(res.statusCode).toBe(200);
        // **何も消さないのが正解。** 行が指しているのは全部「これから指す値」
        // ——ここで1つでも消すと、差し替えたばかりの実体が消えて写真が割れる
        const keys = mockS3DeleteMany.mock.calls.flatMap((c) => c[0]);
        expect(keys, "**差し替えたばかりの実体を消している**").not.toContain(`uploads/${UID}/new.webp`);
        expect(keys, "**差し替えたばかりのサムネを消している**").not.toContain(`uploads/${UID}/new_thumb.webp`);
        expect(keys, "消すものが無いのに消しにいっている").toEqual([]);
    });

    /**
     * 🔴 **消すのは行を書き換えたあと。** 逆だと、更新が落ちたときに
     * **行が存在しない実体を指す**（写真ページが割れ、戻す手段が無い）。
     * コミットではこれを判断として書いたのに、順序を見るテストが無かった
     * ——`s3DeleteMany` を `UpdateCommand` の前へ動かしても全部緑だった。
     */
    it("古い実体を消すのは、行を書き換えたあと", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: old }).mockResolvedValueOnce({});
        await invoke(event(UID, "p1", { replace }));
        const updateOrder = mockDdbSend.mock.invocationCallOrder[1];
        const deleteOrder = mockS3DeleteMany.mock.invocationCallOrder[0];
        expect(deleteOrder, "行を書き換える前に消している（落ちたら写真が割れる）").toBeGreaterThan(updateOrder);
    });

    /**
     * 🔴 **依頼が畳まれた回に黙らない。**
     * 古い実体はエッジごと消えるので、静的ページの写真は**割れて出る**。
     * 次のビルドまで放置されるのに、行にも応答にも痕跡が無かった。
     */
    it("作り直しを頼めなかったら、ページが古いと伝える", async () => {
        mockRebuild.mockResolvedValueOnce(false);
        mockDdbSend.mockResolvedValueOnce({ Item: old }).mockResolvedValueOnce({});
        const res = await invoke(event(UID, "p1", { replace }));
        expect(JSON.parse(res.body).staticOutdated, "黙って古いページを残している").toBe(true);
    });

    it("頼めたときは余計なことを言わない", async () => {
        mockRebuild.mockResolvedValueOnce(true);
        mockDdbSend.mockResolvedValueOnce({ Item: old }).mockResolvedValueOnce({});
        const res = await invoke(event(UID, "p1", { replace }));
        expect(JSON.parse(res.body).staticOutdated).toBeUndefined();
    });

    it("消せなくても差し替えは成功する（残るのは孤児だけ）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: old }).mockResolvedValueOnce({});
        mockS3DeleteMany.mockRejectedValueOnce(new Error("boom"));
        const res = await invoke(event(UID, "p1", { replace }));
        expect(res.statusCode).toBe(200);
    });

    it("静的ページの作り直しを頼む（src が焼かれている）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: old }).mockResolvedValueOnce({});
        await invoke(event(UID, "p1", { replace }));
        expect(mockRebuild, "古い写真が /photo/<id> に残る").toHaveBeenCalled();
    });

    /**
     * 🔴 **同じ属性が SET と REMOVE の両方に出ると、DynamoDB が式ごと拒否する**
     * （"Two document paths overlap with each other"）＝ **500**。
     *
     * `sets` / `removes` は重複を畳まないので、入口が増えるたびに起きうる。
     * **1つずつ名指しで見ない**——次に入口が増えたときに拾えない。
     * **組み上がった式に同じ属性が二度出ていないこと**を見る。
     */
    const attrsOf = (expr: string) => {
        const setPart = /SET ([^]*?)(?: REMOVE |$)/.exec(expr)?.[1] ?? "";
        const remPart = /REMOVE ([^]*)$/.exec(expr)?.[1] ?? "";
        const names = (part: string) => [...part.matchAll(/#(\w+)/g)].map((m) => m[1]);
        return [...names(setPart), ...names(remPart)];
    };

    it("判定器の自己確認: 重なりを見分ける", () => {
        expect(attrsOf("SET #a = :a REMOVE #b").filter((v, i, xs) => xs.indexOf(v) !== i)).toEqual([]);
        expect(attrsOf("SET #a = :a REMOVE #a")).toEqual(["a", "a"]);
        expect(attrsOf("SET #a = :x, #a = :y")).toEqual(["a", "a"]);
    });

    it.each([
        ["差し替えだけ", {}],
        ["＋撮影地の変更（geoApprox の写真）", { location: "ロンドン" }],
        ["＋撮影日を打った", { date: "2020-01-02" }],
        ["＋座標を打った", { coords: { lat: 1, lng: 2 } }],
        ["＋座標を消した", { coords: null }],
        ["＋タイトルと公開", { title: "あ", published: true }],
    ])("同じ属性を二度書かない: %s", async (_name, extra) => {
        // `geoApprox: true` は `geocode-locations` が座標を補った写真の形。
        // 実データに相当数あり、**いちばん踏みやすい**
        mockDdbSend.mockResolvedValueOnce({ Item: { ...old, geoApprox: true, coords: { lat: 48.8, lng: 2.3 }, location: "パリ" } }).mockResolvedValueOnce({});
        const res = await invoke(event(UID, "p1", {
            replace: { ...replace, date: "2024-11-01", coords: { lat: 35.6, lng: 139.7 } },
            ...extra,
        }));
        expect(res.statusCode, `断られた: ${res.body}`).toBe(200);
        const attrs = attrsOf(lastUpdate().UpdateExpression);
        const dup = attrs.filter((v, i, xs) => xs.indexOf(v) !== i);
        expect(dup, `同じ属性を二度書いている（DynamoDB が式ごと拒否する）: ${dup.join(", ")}`).toEqual([]);
    });

    /** 明示的に打った値が、写真から読めた値より優先 */
    it("自分で打った撮影日は、写真の EXIF に上書きされない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: old }).mockResolvedValueOnce({});
        await invoke(event(UID, "p1", { replace: { ...replace, date: "2024-11-01" }, date: "2020-01-02" }));
        const v = lastUpdate().ExpressionAttributeValues;
        expect(v[":date"], "打った日付が消えている").toBe("2020-01-02");
        expect(v[":r_date"], "写真の EXIF が勝っている").toBeUndefined();
    });

    /**
     * 🔴 **差し替えは3つ目の「正確な座標を書く口」。**
     * 印が残ると、座標は新しい写真のものなのに
     * **地図リンクも JSON-LD の geo も出なくなる**
     */
    it("差し替えで座標が入ったら、「おおよそ」の印を下ろす", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { ...old, geoApprox: true, coords: { lat: 48.8, lng: 2.3 } } }).mockResolvedValueOnce({});
        await invoke(event(UID, "p1", { replace: { ...replace, coords: { lat: 35.6, lng: 139.7 } } }));
        const expr = lastUpdate().UpdateExpression;
        expect(expr, "印が残る（地図リンクも geo も出ない）").toMatch(/REMOVE[^]*#geoApprox/);
    });

    it("読めない撮影日の差し替えは断る（無言で不発にしない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: old });
        const res = await invoke(event(UID, "p1", { replace: { ...replace, date: "1985-06-01" } }));
        expect(res.statusCode, "黙って落としている").toBe(400);
    });

    it("他人のアップロード領域は断る（相手の実体が消える）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: old }).mockResolvedValueOnce({});
        const other = "99999999-8888-4777-8666-555555555555";
        const res = await invoke(event(UID, "p1", {
            replace: { key: `uploads/${other}/x.webp`, publicUrl: `${CDN}/uploads/${other}/x.webp` },
        }));
        expect(res.statusCode).toBe(400);
        expect(mockS3DeleteMany, "断ったのに消しにいっている").not.toHaveBeenCalled();
    });

    it("他人の写真は差し替えられない（所有権は既存の判定が効く）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { ...old, userId: "someone-else" } });
        const res = await invoke(event(UID, "p1", { replace }));
        expect(res.statusCode).toBe(403);
    });
});
// 🔴 **公開範囲を絞ったら、静的サイトを作り直す。**
//
// この関門は `published` と `META_KEYS` しか見ていなかった。`audience` は
// どちらにも入っていないので、公開 →「フォロワーのみ」に変えても
// **再ビルドを頼まず**、既に配られている個別ページ・`photos.json`・
// サイトマップ・OGP が**公開のまま残って**いた。定期ビルドは週1なので
// 最大7日。「絞った写真は静的サイトに出さない」が本当になるのは
// 次のビルドから、という状態だった。
describe("公開範囲を絞ったら、公開のページを作り直す", () => {
    const published = (audience?: string) => ({
        Item: { id: "p1", userId: "u1", published: true, ...(audience ? { audience } : {}) },
    });

    it("公開 →「フォロワーのみ」で再ビルドを頼む", async () => {
        mockDdbSend.mockReset().mockResolvedValueOnce(published()).mockResolvedValueOnce({});
        mockRebuild.mockReset().mockResolvedValue(true);
        await invoke(event("u1", "p1", { audience: "followers" }));
        expect(mockRebuild).toHaveBeenCalled();
    });

    it("「フォロワーのみ」→ 解除でも頼む（ページを作りに行く）", async () => {
        mockDdbSend.mockReset().mockResolvedValueOnce(published("followers")).mockResolvedValueOnce({});
        mockRebuild.mockReset().mockResolvedValue(true);
        await invoke(event("u1", "p1", { audience: null }));
        expect(mockRebuild).toHaveBeenCalled();
    });

    it("同じ値で保存し直しても頼まない（連打で予算を使わない）", async () => {
        mockDdbSend.mockReset().mockResolvedValueOnce(published("followers")).mockResolvedValueOnce({});
        mockRebuild.mockReset().mockResolvedValue(true);
        await invoke(event("u1", "p1", { audience: "followers" }));
        expect(mockRebuild).not.toHaveBeenCalled();
    });

    // **届かなかった回は行に印を残す。** 残さないと、公開のままのページを
    // 誰も消さない（削除側は「非公開だった写真にページは無い」と決め打つ）
    it("依頼が届かなかったら staticStale を残す", async () => {
        mockDdbSend.mockReset()
            .mockResolvedValueOnce(published())
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
        mockRebuild.mockReset().mockResolvedValue(false);
        const res = await invoke(event("u1", "p1", { audience: "followers" }));
        expect(JSON.parse(res.body).staticStale).toBe(true);
        const wrote = mockDdbSend.mock.calls.some((c) =>
            /SET staticStale/.test(String(((c[0] as { input: { UpdateExpression?: string } }).input).UpdateExpression ?? "")));
        expect(wrote, "行にも印が要る").toBe(true);
    });

    // **下書きを絞っただけなら、公開のページは無い**
    it("非公開の写真を絞っても staticStale は立てない", async () => {
        mockDdbSend.mockReset()
            .mockResolvedValueOnce({ Item: { id: "p1", userId: "u1", published: false } })
            .mockResolvedValueOnce({});
        mockRebuild.mockReset().mockResolvedValue(false);
        const res = await invoke(event("u1", "p1", { audience: "followers" }));
        expect(JSON.parse(res.body).staticStale).toBeFalsy();
    });
});

// 🔴 **絞った写真の差し替え・ストーリーと共有している実体**（レビューで見つかった2件）
describe("絞った写真の差し替えも private/ へ", () => {
    const priv = (p: string) => `${CDN}/private/${UID}/${p}`;
    const restrictedRow = {
        id: "p1", userId: UID, published: true, audience: "followers",
        src: priv("old.webp"), thumbSrc: priv("old_thumb.webp"),
    };
    const replace = { key: `uploads/${UID}/new.webp`, publicUrl: mine("new.webp") };
    const lastUpdate = () => (mockDdbSend.mock.calls[1][0] as {
        input: { UpdateExpression: string; ExpressionAttributeNames: Record<string, string>; ExpressionAttributeValues: Record<string, unknown> };
    }).input;
    /** SET 句で同じ属性を2か所から触っていないか（DynamoDB が式ごと拒否する） */
    const setTargets = () => {
        const u = lastUpdate();
        const setPart = u.UpdateExpression.split(" REMOVE ")[0].replace(/^SET /, "");
        return setPart.split(", ").map((a) => {
            const lhs = a.split(" = ")[0].trim();
            return u.ExpressionAttributeNames?.[lhs] ?? lhs;
        });
    };

    beforeEach(() => {
        mockCopyAll.mockReset().mockResolvedValue(true);
        mockDropOld.mockReset().mockResolvedValue(0);
        mockListMyMedia.mockReset().mockResolvedValue([]);
        mockS3DeleteMany.mockClear();
    });

    it("新しい画像を private/ へ移してから行に書く（公開の置き場に出さない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: restrictedRow }).mockResolvedValueOnce({});
        const res = await invoke(event(UID, "p1", { replace }));
        expect(res.statusCode, res.body).toBe(200);
        expect(mockCopyAll.mock.calls[0][0]).toContainEqual({ from: `uploads/${UID}/new.webp`, to: `private/${UID}/new.webp` });
        expect(lastUpdate().ExpressionAttributeValues[":r_src"]).toBe(priv("new.webp"));
        expect(mockDropOld.mock.calls.flatMap((c) => c[0] as { from: string }[]).map((m) => m.from))
            .toContain(`uploads/${UID}/new.webp`);
    });

    it("差し替えと公開範囲の変更を同時に送っても、同じ属性を2か所から触らない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { ...restrictedRow, audience: undefined, src: mine("old.webp"), thumbSrc: mine("old_thumb.webp") } })
            .mockResolvedValueOnce({});
        const res = await invoke(event(UID, "p1", { replace, audience: "followers" }));
        expect(res.statusCode, res.body).toBe(200);
        const targets = setTargets();
        expect(new Set(targets).size, `重複: ${targets.join(",")}`).toBe(targets.length);
        expect(lastUpdate().ExpressionAttributeValues[":r_src"]).toBe(priv("new.webp"));
    });

    it("差し替えの再送（前回で移し済み）では、いま指している実体を消さない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { ...restrictedRow, src: priv("new.webp") } }).mockResolvedValueOnce({});
        const res = await invoke(event(UID, "p1", { replace }));
        expect(res.statusCode, res.body).toBe(200);
        expect(mockCopyAll, "元はもう無いのにコピーしている（500 になる）").not.toHaveBeenCalled();
        const deleted = mockS3DeleteMany.mock.calls.flat(2);
        expect(deleted, "いま指している実体を消している").not.toContain(`private/${UID}/new.webp`);
    });

    it("公開の写真の差し替えでは移さない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "p1", userId: UID, published: true, src: mine("old.webp") } }).mockResolvedValueOnce({});
        await invoke(event(UID, "p1", { replace }));
        expect(mockCopyAll).not.toHaveBeenCalled();
        expect(lastUpdate().ExpressionAttributeValues[":r_src"]).toBe(mine("new.webp"));
    });
});

// 🔴 **消す鍵は「今の行 − 最終形」で1か所で決める**（レビューで見つかった形）
describe("差し替えで消す鍵", () => {
    const priv = (p: string) => `${CDN}/private/${UID}/${p}`;
    const replace = { key: `uploads/${UID}/new.webp`, publicUrl: mine("new.webp") };
    const deleted = () => mockS3DeleteMany.mock.calls.flatMap((c) => c[0] as string[]);
    const lastUpdate = () => (mockDdbSend.mock.calls[1][0] as {
        input: { UpdateExpression: string; ExpressionAttributeNames: Record<string, string> };
    }).input;

    beforeEach(() => {
        mockCopyAll.mockReset().mockResolvedValue(true);
        mockDropOld.mockReset().mockResolvedValue(0);
        mockListMyMedia.mockReset().mockResolvedValue([]);
    });

    // 以前は「差し替えた項目」だけで最終形を見ていたので、行に残る2枚目以降まで
    // 古い実体として消していた（公開写真でも。画面は複数枚でも差し替えを出す）
    it("公開写真の差し替えで、2枚目以降の実体を消さない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: {
            id: "p1", userId: UID, published: true, src: mine("old.webp"),
            extraImages: [{ src: mine("e1.webp"), thumbSrc: mine("e1_t.webp") }],
        } }).mockResolvedValueOnce({});
        const res = await invoke(event(UID, "p1", { replace }));
        expect(res.statusCode, res.body).toBe(200);
        expect(deleted()).toContain(`uploads/${UID}/old.webp`);
        expect(deleted(), "2枚目を消している（割れる）").not.toContain(`uploads/${UID}/e1.webp`);
        expect(deleted()).not.toContain(`uploads/${UID}/e1_t.webp`);
    });

    it("差し替え＋絞るでも、ほかの行が使っている元は消さない", async () => {
        mockListMyMedia.mockResolvedValue([{ id: "p2", src: mine("e1.webp") }]);
        mockDdbSend.mockResolvedValueOnce({ Item: {
            id: "p1", userId: UID, published: true, src: mine("old.webp"),
            extraImages: [{ src: mine("e1.webp") }],
        } }).mockResolvedValueOnce({});
        const res = await invoke(event(UID, "p1", { replace, audience: "followers" }));
        expect(res.statusCode, res.body).toBe(200);
        expect(deleted(), "ほかの写真の実体を消している").not.toContain(`uploads/${UID}/e1.webp`);
        expect(deleted()).toContain(`uploads/${UID}/old.webp`);
    });

    // 元のストーリーが消えたあと（実体は写真だけのもの）の差し替え
    it("ストーリーから残した写真の差し替えでは key も外し、古い画像を指し続けない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: {
            id: "p1", userId: UID, published: true, audience: "followers", keptFrom: "story-1",
            key: `private/${UID}/k.jpg`, src: priv("k.jpg"),
        } }).mockResolvedValueOnce({}).mockResolvedValueOnce({});   // 写真 → ストーリー（もう無い）→ 更新
        const res = await invoke(event(UID, "p1", { replace }));
        expect(res.statusCode, res.body).toBe(200);
        const upd = mockDdbSend.mock.calls.map((c) => (c[0] as { input: { UpdateExpression?: string } }).input)
            .find((i) => i.UpdateExpression);
        expect(upd?.UpdateExpression).toMatch(/REMOVE[^]*#key/);
        expect(deleted(), "差し替えた古い画像が残る").toContain(`private/${UID}/k.jpg`);
    });

    // 差し替えが消す派生（srcAvif など）を最終形から外さないと、移動が同じ属性を
    // SET し、差し替えが REMOVE する——DynamoDB が式ごと拒否する（500）
    it("差し替え＋絞るで、消す派生を SET と REMOVE の両方で触らない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: {
            id: "p1", userId: UID, published: true, src: mine("old.webp"), srcAvif: mine("old.avif"),
        } }).mockResolvedValueOnce({});
        const res = await invoke(event(UID, "p1", { replace, audience: "followers" }));
        expect(res.statusCode, res.body).toBe(200);
        const u = lastUpdate();
        const [setPart, removePart = ""] = u.UpdateExpression.split(" REMOVE ");
        const setAttrs = setPart.replace(/^SET /, "").split(", ").map((a) => u.ExpressionAttributeNames[a.split(" = ")[0]] ?? a.split(" = ")[0]);
        const removeAttrs = removePart.split(", ").map((a) => u.ExpressionAttributeNames[a.trim()] ?? a.trim());
        expect(setAttrs.filter((a) => removeAttrs.includes(a)), "同じ属性を SET と REMOVE の両方で触っている").toEqual([]);
    });

    // 前回が行を書いたあと元を消す前に落ちていたら、元が公開の置き場に残る
    it("差し替えの再送でも、移し済みの元は消す候補に入れる", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: {
            id: "p1", userId: UID, published: true, audience: "followers", src: priv("new.webp"),
        } }).mockResolvedValueOnce({});
        await invoke(event(UID, "p1", { replace }));
        expect(mockCopyAll).not.toHaveBeenCalled();
        expect(deleted(), "公開の置き場に新しい画像が残ったまま").toContain(`uploads/${UID}/new.webp`);
        expect(deleted()).not.toContain(`private/${UID}/new.webp`);
    });
});

// 🔴 **元のストーリーが残っている間は、残した写真の公開範囲の変更と差し替えを断る。**
// その間は写真とストーリーが同じ実体を共有していて、`keptAs` の付け外しは
// 期限切れの掃除と競合して写真の実体を失いうる（レビューで3回、別の形で再現）
describe("ストーリーから残した写真（元のストーリーが残っている間）", () => {
    const U = "22222222-2222-2222-2222-222222222222";
    const kept = { id: "p1", userId: "u1", published: false, keptFrom: "story-1", key: `uploads/${U}/k.jpg`, src: `${CDN}/uploads/${U}/k.jpg` };
    const replace = { key: `uploads/${U}/new.webp`, publicUrl: `${CDN}/uploads/${U}/new.webp` };
    const wrote = () => mockDdbSend.mock.calls.some((c) => "UpdateExpression" in ((c[0] as { input: object }).input));

    beforeEach(() => {
        mockCopyAll.mockReset().mockResolvedValue(true);
        mockDropOld.mockReset().mockResolvedValue(0);
        mockS3DeleteMany.mockClear();
    });

    it("公開範囲の変更を断る（何も動かさない）", async () => {
        mockDdbSend.mockReset().mockResolvedValueOnce({ Item: kept }).mockResolvedValueOnce({ Item: { id: "story-1", story: true } });
        const res = await invoke(event("u1", "p1", { audience: "followers" }));
        expect(res.statusCode).toBe(409);
        expect(mockCopyAll).not.toHaveBeenCalled();
        expect(wrote(), "行を書いている").toBe(false);
    });

    it("差し替えを断る", async () => {
        mockDdbSend.mockReset().mockResolvedValueOnce({ Item: { ...kept, userId: "u1" } }).mockResolvedValueOnce({ Item: { id: "story-1", story: true } });
        const res = await invoke(event("u1", "p1", { replace }));
        expect(res.statusCode, res.body).toBe(409);
        expect(wrote()).toBe(false);
        expect(mockS3DeleteMany).not.toHaveBeenCalled();
    });

    it("ストーリーを読めなければ断る（分からないなら止める）", async () => {
        mockDdbSend.mockReset().mockResolvedValueOnce({ Item: kept }).mockRejectedValueOnce(new Error("throttled"));
        const res = await invoke(event("u1", "p1", { audience: "followers" }));
        expect(res.statusCode).toBe(503);
        expect(mockCopyAll).not.toHaveBeenCalled();
    });

    it("公開範囲も差し替えも触らない保存（題など）は、これまでどおり通す", async () => {
        mockDdbSend.mockReset().mockResolvedValueOnce({ Item: kept }).mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { title: "港の夕暮れ" }));
        expect(res.statusCode, res.body).toBe(200);
        const readStory = mockDdbSend.mock.calls.some((c) => (c[0] as { input: { Key?: { id?: string } } }).input.Key?.id === "story-1");
        expect(readStory, "関係の無い保存でストーリーを読みにいっている").toBe(false);
    });

    it("ストーリーが消えたあとは、公開範囲を変えられる", async () => {
        mockDdbSend.mockReset().mockResolvedValueOnce({ Item: kept }).mockResolvedValueOnce({}).mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { audience: "followers" }));
        expect(res.statusCode, res.body).toBe(200);
        expect(mockCopyAll).toHaveBeenCalled();
    });
});

describe("移した元は、ほかの行が使っていれば消さない", () => {
    const U = "22222222-2222-2222-2222-222222222222";
    // `keptFrom` は持たせない——残した写真は元のストーリーが残っている間は門で断る。
    // ここで見るのは「ほかの行（サムネに同じ URL を渡した別の写真・ストーリー）が
    // 使っている実体」
    const row = {
        id: "p1", userId: "u1", published: true,
        src: `${CDN}/uploads/${U}/p1.jpg`,
    };
    const dropped = () => mockDropOld.mock.calls.flatMap((c) => c[0] as { from: string }[]).map((m) => m.from);

    beforeEach(() => {
        mockCopyAll.mockReset().mockResolvedValue(true);
        mockDropOld.mockReset().mockResolvedValue(0);
        mockListMyMedia.mockReset().mockResolvedValue([]);
    });

    it("ほかの行（ストーリー）が使っている実体は、絞っても消さない", async () => {
        mockListMyMedia.mockResolvedValue([{ id: "story-1", story: true, src: `${CDN}/uploads/${U}/p1.jpg` }]);
        mockDdbSend.mockReset().mockResolvedValueOnce({ Item: row }).mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { audience: "followers" }));
        expect(res.statusCode, res.body).toBe(200);
        expect(dropped(), "ストーリーの実体を消している").not.toContain(`uploads/${U}/p1.jpg`);
    });

    // 一覧は結果整合なので、書き換えた直後は同じ写真の古い版が見えうる。
    // それを「使用中」と読むと、絞ったのに公開の置き場に残る
    it("一覧に同じ写真の古い版が見えても、元は消す", async () => {
        mockListMyMedia.mockResolvedValue([{ id: "p1", src: `${CDN}/uploads/${U}/p1.jpg` }]);
        mockDdbSend.mockReset().mockResolvedValueOnce({ Item: row }).mockResolvedValueOnce({});
        await invoke(event("u1", "p1", { audience: "followers" }));
        expect(dropped()).toContain(`uploads/${U}/p1.jpg`);
    });
});

// 🔴 **案A: 絞ったら実体を `private/` へ動かす**
// （`docs/restricted-image-delivery.md`・owner 承認済み 2026-09-23）
describe("公開範囲を絞ったら、実体も動かす", () => {
    const U = "22222222-2222-2222-2222-222222222222";
    const CDN = "https://d1s3dwwzgxf5ni.cloudfront.net";
    const publicRow = (audience?: string) => ({
        Item: {
            id: "p1", userId: "u1", published: true,
            key: `uploads/${U}/p1.jpg`,
            src: `${CDN}/uploads/${U}/p1.jpg`,
            thumbSrc: `${CDN}/uploads/${U}/p1-t.jpg`,
            ...(audience ? { audience } : {}),
        },
    });
    const update = () => (mockDdbSend.mock.calls
        .map((c) => (c[0] as { input: Record<string, unknown> }).input)
        .find((i) => "UpdateExpression" in i)) as
        { UpdateExpression: string; ExpressionAttributeValues: Record<string, unknown> } | undefined;

    beforeEach(() => {
        mockCopyAll.mockReset().mockResolvedValue(true);
        mockDropOld.mockReset().mockResolvedValue(0);
    });

    it("コピーしてから、行に新しい URL を書く", async () => {
        mockDdbSend.mockReset().mockResolvedValueOnce(publicRow()).mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { audience: "followers" }));
        expect(res.statusCode).toBe(200);
        expect(mockCopyAll).toHaveBeenCalled();

        const input = update();
        const values = input?.ExpressionAttributeValues ?? {};
        // 🔴 **値を積んだだけでは行は変わらない。** `SET` 句に入っている
        // ことまで見る——最初これを見ていなくて、`sets.push` を消す変異が
        // **1件も落ちなかった**（行が更新されないのにテストは緑）
        const written = Object.entries(values)
            .filter(([key]) => key.startsWith(":mv"))
            .filter(([key]) => input?.UpdateExpression.includes(key));
        expect(written.length, "新しい URL が SET 句に入っていない").toBeGreaterThan(0);

        const urls = written.map(([, v]) => String(v));
        expect(urls.some((v) => v.includes("/private/")), "URL が書き換わっていない").toBe(true);
        expect(urls.some((v) => v === `private/${U}/p1.jpg`), "生キーも書き換える").toBe(true);
        // 名前も対で入っていること（`#mv0 = :mv0`）
        expect(input?.UpdateExpression).toMatch(/#mv\d+ = :mv\d+/);
    });

    // 🔴 **順番。** 逆だと、途中で落ちたときに行が存在しない実体を指す
    it("元を消すのは、行を書き換えた**あと**", async () => {
        mockDdbSend.mockReset().mockResolvedValueOnce(publicRow()).mockResolvedValueOnce({});
        await invoke(event("u1", "p1", { audience: "followers" }));
        expect(mockCopyAll.mock.invocationCallOrder[0])
            .toBeLessThan(mockDropOld.mock.invocationCallOrder[0]);
    });

    // 🔴 **「絞った」と表示しながら画像が公開 URL に残るのは、
    //     守れない約束を画面に書くこと。** 分からないなら止める
    it("コピーに失敗したら 500。公開範囲も変えない", async () => {
        mockCopyAll.mockResolvedValue(false);
        mockDdbSend.mockReset().mockResolvedValueOnce(publicRow()).mockResolvedValueOnce({});
        const res = await invoke(event("u1", "p1", { audience: "followers" }));
        expect(res.statusCode).toBe(500);
        expect(update(), "行を1つも書き換えていないこと").toBeUndefined();
        expect(mockDropOld, "元を消していないこと").not.toHaveBeenCalled();
    });

    it("解除したら、逆へ戻す", async () => {
        mockDdbSend.mockReset()
            .mockResolvedValueOnce({ Item: {
                id: "p1", userId: "u1", published: true, audience: "followers",
                key: `private/${U}/p1.jpg`, src: `${CDN}/private/${U}/p1.jpg`,
            } })
            .mockResolvedValueOnce({});
        await invoke(event("u1", "p1", { audience: null }));
        const input = update();
        const back = Object.entries(input?.ExpressionAttributeValues ?? {})
            .filter(([k]) => k.startsWith(":mv") && input?.UpdateExpression.includes(k))
            .map(([, v]) => String(v));
        expect(back.some((v) => v.includes("/uploads/")), "SET 句で戻していない").toBe(true);
    });

    // **公開範囲を触らない保存では、1つも動かさない**（題を直しただけで
    // S3 が動いたら、編集のたびに実体が往復する）
    it("公開範囲を触らない保存では、何も動かさない", async () => {
        mockDdbSend.mockReset().mockResolvedValueOnce(publicRow()).mockResolvedValueOnce({});
        await invoke(event("u1", "p1", { title: "新しい題" }));
        expect(mockCopyAll).not.toHaveBeenCalled();
        expect(mockDropOld).not.toHaveBeenCalled();
    });

    // **同じ値で保存し直しても動かさない**（二度押しで往復しない）
    it("既に絞ってある写真を、もう一度絞っても動かさない", async () => {
        mockDdbSend.mockReset().mockResolvedValueOnce(publicRow("followers")).mockResolvedValueOnce({});
        await invoke(event("u1", "p1", { audience: "followers" }));
        expect(mockCopyAll).not.toHaveBeenCalled();
    });
});


