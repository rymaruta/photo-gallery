import { describe, it, expect, vi, beforeEach } from "vitest";

// DynamoDB / S3 をモック
const mockDdbSend = vi.hoisted(() => vi.fn());
const mockS3Send = vi.hoisted(() => vi.fn());

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));

vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = mockS3Send; },
    DeleteObjectCommand: class { input: unknown; constructor(input: unknown) { this.input = input; } },
}));

// 環境変数はモジュール読込時に評価されるため、stub してから動的 import する
// （静的 import はファイル先頭に巻き上げられ stubEnv より先に実行されてしまう）
vi.stubEnv("CLOUDFRONT_URL", "https://cdn.test");
vi.stubEnv("UPLOAD_BUCKET", "bucket-test");
const { getStories, createStory, deleteStory, viewStory, getStoryViewers, cleanupExpiredStories } = await import("../stories");

type LambdaResult = { statusCode: number; headers?: Record<string, string>; body: string };
// テストでは最小限のイベントだけ渡すため any 経由で呼び出す
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (handler: unknown, event: unknown): Promise<LambdaResult> => (handler as any)(event);

function authedEvent(sub: string | undefined, overrides: Record<string, unknown> = {}) {
    return {
        requestContext: { authorizer: { jwt: { claims: { sub } } } },
        ...overrides,
    };
}

beforeEach(() => {
    mockDdbSend.mockReset();
    mockS3Send.mockReset();
});

// ────────────────────────────────
// GET /stories
// ────────────────────────────────
describe("getStories", () => {
    it("未ログイン（sub 欠落）は 401 でストーリーを返さない", async () => {
        const res = await invoke(getStories, authedEvent(undefined));
        expect(res.statusCode).toBe(401);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it("ログイン済みなら作成順で返し、viewers は除外・共有キャッシュもしない", async () => {
        mockDdbSend.mockResolvedValueOnce({
            Items: [
                { id: "s2", createdAt: "2026-07-04T11:00:00Z", viewers: { "u9": { at: "x" } } },
                { id: "s1", createdAt: "2026-07-04T10:00:00Z" },
            ],
        });
        const res = await invoke(getStories, authedEvent("viewer"));
        expect(res.statusCode).toBe(200);
        const items = JSON.parse(res.body) as Array<Record<string, unknown>>;
        expect(items.map((i) => i.id)).toEqual(["s1", "s2"]);
        expect(items.find((i) => i.id === "s2")?.viewers).toBeUndefined();
        expect(res.headers?.["Cache-Control"]).toContain("no-store");
    });

    it("ページネーション（LastEvaluatedKey）を辿って全件返す", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Items: [{ id: "a", createdAt: "1" }], LastEvaluatedKey: { id: "a" } })
            .mockResolvedValueOnce({ Items: [{ id: "b", createdAt: "2" }] });
        const res = await invoke(getStories, authedEvent("viewer"));
        const items = JSON.parse(res.body) as Array<Record<string, unknown>>;
        expect(items).toHaveLength(2);
        expect(mockDdbSend).toHaveBeenCalledTimes(2);
    });

    it("DynamoDB エラーは 500", async () => {
        mockDdbSend.mockRejectedValueOnce(new Error("boom"));
        const res = await invoke(getStories, authedEvent("viewer"));
        expect(res.statusCode).toBe(500);
    });
});

// ────────────────────────────────
// POST /stories
// ────────────────────────────────
describe("createStory", () => {
    it("認証なし（sub 欠落）は 401", async () => {
        const res = await invoke(createStory, authedEvent(undefined, { body: "{}" }));
        expect(res.statusCode).toBe(401);
    });

    it("publicUrl なしは 400", async () => {
        const res = await invoke(createStory, authedEvent("u1", { body: JSON.stringify({}) }));
        expect(res.statusCode).toBe(400);
    });

    it("配信ドメイン外の publicUrl は 400", async () => {
        const res = await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://evil.example.com/x.jpg" }),
        }));
        expect(res.statusCode).toBe(400);
    });

    it("uploads/ 以外の key は 400", async () => {
        const res = await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/a.jpg", key: "profiles/hack" }),
        }));
        expect(res.statusCode).toBe(400);
    });

    // 投稿は「本数カウントの Query → Put」の順に DynamoDB を呼ぶ
    it("正常系: story=true / published=false / 24時間の期限付きで保存される", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Count: 0 }) // 本日の投稿数
            .mockResolvedValueOnce({}); // Put
        const before = Date.now();
        const res = await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({
                publicUrl: "https://cdn.test/uploads/a.jpg",
                key: "uploads/a.jpg",
                caption: "  旅の思い出  ",
                displayName: "旅人",
            }),
        }));
        expect(res.statusCode).toBe(201);
        const put = mockDdbSend.mock.calls[1][0] as { input: { Item: Record<string, unknown> } };
        const item = put.input.Item;
        expect(item.story).toBe(true);
        expect(item.published).toBe(false);
        expect(item.userId).toBe("u1");
        expect(item.mediaType).toBe("image");
        expect(item.caption).toBe("旅の思い出");
        expect(item.key).toBe("uploads/a.jpg");
        expect(String(item.id)).toMatch(/^story-/);
        const ttl = Date.parse(String(item.expiresAt)) - Date.parse(String(item.createdAt));
        expect(ttl).toBe(24 * 60 * 60 * 1000);
        expect(Date.parse(String(item.createdAt))).toBeGreaterThanOrEqual(before - 1000);
    });

    it("mediaType=video が保存される（不正値は image に落ちる）", async () => {
        mockDdbSend.mockResolvedValue({}); // Query({Count:undefined→0}) と Put の両方に効く
        await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/v.mp4", mediaType: "video" }),
        }));
        // 1件目: calls[0]=Query, calls[1]=Put
        let item = (mockDdbSend.mock.calls[1][0] as { input: { Item: Record<string, unknown> } }).input.Item;
        expect(item.mediaType).toBe("video");

        await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/x.jpg", mediaType: "gif" }),
        }));
        // 2件目: calls[2]=Query, calls[3]=Put
        item = (mockDdbSend.mock.calls[3][0] as { input: { Item: Record<string, unknown> } }).input.Item;
        expect(item.mediaType).toBe("image");
    });

    it("キャプションは200文字に切り詰められる", async () => {
        mockDdbSend.mockResolvedValueOnce({ Count: 0 }).mockResolvedValueOnce({});
        await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/a.jpg", caption: "あ".repeat(300) }),
        }));
        const item = (mockDdbSend.mock.calls[1][0] as { input: { Item: Record<string, unknown> } }).input.Item;
        expect(String(item.caption)).toHaveLength(200);
    });

    it("表示秒数は3〜15秒に丸め、既定の5秒なら保存しない", async () => {
        mockDdbSend.mockResolvedValue({});
        await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/a.jpg", durationSec: 10 }),
        }));
        expect((mockDdbSend.mock.calls[1][0] as { input: { Item: Record<string, unknown> } }).input.Item.durationSec).toBe(10);

        await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/a.jpg", durationSec: 999 }),
        }));
        expect((mockDdbSend.mock.calls[3][0] as { input: { Item: Record<string, unknown> } }).input.Item.durationSec).toBe(15);

        await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/a.jpg", durationSec: 5 }),
        }));
        expect((mockDdbSend.mock.calls[5][0] as { input: { Item: Record<string, unknown> } }).input.Item.durationSec).toBeUndefined();
    });

    it("曲の開始位置（好きな部分）は0〜29秒に丸めて保存する", async () => {
        mockDdbSend.mockResolvedValue({});
        const song = { title: "Song", previewUrl: "https://cdn.test/p.m4a" };
        await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/a.jpg", song: { ...song, startSec: 12.4 } }),
        }));
        let item = (mockDdbSend.mock.calls[1][0] as { input: { Item: Record<string, unknown> } }).input.Item;
        expect((item.song as { startSec?: number }).startSec).toBe(12);

        await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/a.jpg", song: { ...song, startSec: 120 } }),
        }));
        item = (mockDdbSend.mock.calls[3][0] as { input: { Item: Record<string, unknown> } }).input.Item;
        expect((item.song as { startSec?: number }).startSec).toBe(29);
    });

    it("24時間の投稿上限に達していたら 429 で保存しない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Count: 20 }); // 上限ちょうど
        const res = await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/a.jpg" }),
        }));
        expect(res.statusCode).toBe(429);
        expect(mockDdbSend).toHaveBeenCalledTimes(1); // Query のみ、Put なし
    });

    it("投稿数カウントが失敗しても投稿は継続する", async () => {
        mockDdbSend
            .mockRejectedValueOnce(new Error("query down")) // カウント失敗
            .mockResolvedValueOnce({}); // Put は成功
        const res = await invoke(createStory, authedEvent("u1", {
            body: JSON.stringify({ publicUrl: "https://cdn.test/uploads/a.jpg" }),
        }));
        expect(res.statusCode).toBe(201);
    });
});

// ────────────────────────────────
// DELETE /stories/{id}
// ────────────────────────────────
describe("deleteStory", () => {
    it("id なしは 400", async () => {
        const res = await invoke(deleteStory, authedEvent("u1", { pathParameters: undefined }));
        expect(res.statusCode).toBe(400);
    });

    it("存在しない / ストーリーでないものは 404", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: undefined });
        const res = await invoke(deleteStory, authedEvent("u1", { pathParameters: { id: "story-x" } }));
        expect(res.statusCode).toBe(404);
    });

    it("投稿者以外は 403（他人のストーリーは消せない）", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "owner" } });
        const res = await invoke(deleteStory, authedEvent("attacker", { pathParameters: { id: "story-1" } }));
        expect(res.statusCode).toBe(403);
        expect(mockS3Send).not.toHaveBeenCalled();
    });

    it("投稿者本人は DDB レコードと S3 オブジェクトを削除できる", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "u1", key: "uploads/a.jpg" } }) // Get
            .mockResolvedValueOnce({}); // Delete
        mockS3Send.mockResolvedValueOnce({});
        const res = await invoke(deleteStory, authedEvent("u1", { pathParameters: { id: "story-1" } }));
        expect(res.statusCode).toBe(200);
        const s3Input = (mockS3Send.mock.calls[0][0] as { input: { Key: string } }).input;
        expect(s3Input.Key).toBe("uploads/a.jpg");
    });

    it("S3 削除に失敗しても DDB レコードは削除する", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "u1", key: "uploads/a.jpg" } })
            .mockResolvedValueOnce({});
        mockS3Send.mockRejectedValueOnce(new Error("s3 down"));
        const res = await invoke(deleteStory, authedEvent("u1", { pathParameters: { id: "story-1" } }));
        expect(res.statusCode).toBe(200);
    });

    // 以前はサムネ生成スクリプトがストーリーも対象にしていたため、
    // 派生画像（AVIF・小サイズ）が max-age=31536000 で残っている個体がある。
    // 原本だけ消すと、24時間で消えるはずのものが公開URLで取得できてしまう。
    it("派生画像も残さず消す", async () => {
        mockDdbSend
            .mockResolvedValueOnce({
                Item: {
                    id: "story-1", story: true, userId: "u1",
                    key: "uploads/a.jpg",
                    src: "https://cdn.example.com/uploads/a.jpg",
                    srcOriginal: "https://cdn.example.com/uploads/a_orig.jpg",
                    srcAvif: "https://cdn.example.com/uploads/a_lg.avif",
                    thumbSrc: "https://cdn.example.com/uploads/a_thumb.webp",
                    thumbAvif: "https://cdn.example.com/uploads/a_thumb.avif",
                    thumbSm: "https://cdn.example.com/uploads/a_thumb_sm.webp",
                    thumbSmAvif: "https://cdn.example.com/uploads/a_thumb_sm.avif",
                },
            })
            .mockResolvedValueOnce({});
        mockS3Send.mockResolvedValue({});

        const res = await invoke(deleteStory, authedEvent("u1", { pathParameters: { id: "story-1" } }));
        expect(res.statusCode).toBe(200);

        const deleted = mockS3Send.mock.calls.map((c) => (c[0] as { input: { Key: string } }).input.Key);
        expect(deleted).toEqual(expect.arrayContaining([
            "uploads/a.jpg", "uploads/a_orig.jpg", "uploads/a_lg.avif",
            "uploads/a_thumb.webp", "uploads/a_thumb.avif",
            "uploads/a_thumb_sm.webp", "uploads/a_thumb_sm.avif",
        ]));
        // key と src は同じオブジェクトなので重複して消さない
        expect(new Set(deleted).size).toBe(deleted.length);
    });
});

// ────────────────────────────────
// POST /stories/{id}/view
// ────────────────────────────────
describe("viewStory", () => {
    it("id なしは 400", async () => {
        const res = await invoke(viewStory, authedEvent("u1", { body: "{}" }));
        expect(res.statusCode).toBe(400);
    });

    it("存在しない / ストーリーでないレコードは 404", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: undefined });
        let res = await invoke(viewStory, authedEvent("u1", { pathParameters: { id: "story-x" }, body: "{}" }));
        expect(res.statusCode).toBe(404);

        mockDdbSend.mockResolvedValueOnce({ Item: { id: "photo-1", story: undefined } });
        res = await invoke(viewStory, authedEvent("u1", { pathParameters: { id: "photo-1" }, body: "{}" }));
        expect(res.statusCode).toBe(404);
    });

    it("本人の閲覧は記録しない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "u1" } });
        const res = await invoke(viewStory, authedEvent("u1", { pathParameters: { id: "story-1" }, body: "{}" }));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).self).toBe(true);
        expect(mockDdbSend).toHaveBeenCalledTimes(1); // Get のみ、Update なし
    });

    it("他人の閲覧は viewers マップに初回時刻つきで記録する", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "owner" } })
            .mockResolvedValueOnce({ Item: { displayName: "本当の名前" } }) // 表示名をテーブルから引く
            .mockResolvedValueOnce({}) // viewers マップ初期化
            .mockResolvedValueOnce({}); // 閲覧者エントリ追加
        const res = await invoke(viewStory, authedEvent("viewer-1", {
            pathParameters: { id: "story-1" },
            body: JSON.stringify({ displayName: "なりすまし" }),
        }));
        expect(res.statusCode).toBe(200);
        expect(mockDdbSend).toHaveBeenCalledTimes(4);
        const initExpr = (mockDdbSend.mock.calls[2][0] as { input: { UpdateExpression: string } }).input.UpdateExpression;
        expect(initExpr).toContain("if_not_exists(viewers");
        const addCall = (mockDdbSend.mock.calls[3][0] as {
            input: {
                UpdateExpression: string;
                ExpressionAttributeNames: Record<string, string>;
                ExpressionAttributeValues: Record<string, { displayName?: string }>;
            };
        }).input;
        expect(addCall.ExpressionAttributeNames["#uid"]).toBe("viewer-1");
        expect(addCall.UpdateExpression).toContain("if_not_exists(viewers.#uid"); // 初回閲覧時刻を上書きしない
        // 名前はテーブルから引いた値を使う。リクエストの申告は無視する
        // （改造したクライアントから任意の名前で閲覧履歴に載れないように）
        expect(addCall.ExpressionAttributeValues[":v"].displayName).toBe("本当の名前");
    });
});

// ────────────────────────────────
// GET /stories/{id}/viewers
// ────────────────────────────────
describe("getStoryViewers", () => {
    it("投稿者以外は 403", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "owner" } });
        const res = await invoke(getStoryViewers, authedEvent("stranger", { pathParameters: { id: "story-1" } }));
        expect(res.statusCode).toBe(403);
    });

    it("投稿者本人には閲覧時刻の新しい順でリストを返す", async () => {
        mockDdbSend.mockResolvedValueOnce({
            Item: {
                id: "story-1", story: true, userId: "owner",
                viewers: {
                    "u-a": { displayName: "A", at: "2026-07-04T10:00:00Z" },
                    "u-b": { displayName: "B", at: "2026-07-04T11:00:00Z" },
                },
            },
        });
        const res = await invoke(getStoryViewers, authedEvent("owner", { pathParameters: { id: "story-1" } }));
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { viewers: Array<{ userId: string }>; count: number };
        expect(body.count).toBe(2);
        expect(body.viewers.map((v) => v.userId)).toEqual(["u-b", "u-a"]);
    });

    it("viewers 未設定なら空リスト", async () => {
        mockDdbSend.mockResolvedValueOnce({ Item: { id: "story-1", story: true, userId: "owner" } });
        const res = await invoke(getStoryViewers, authedEvent("owner", { pathParameters: { id: "story-1" } }));
        expect(JSON.parse(res.body)).toEqual({ viewers: [], count: 0 });
    });
});

// ────────────────────────────────
// 期限切れクリーンアップ
// ────────────────────────────────
describe("cleanupExpiredStories", () => {
    it("期限切れストーリーの S3 オブジェクトと DDB レコードを削除する", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Items: [{ id: "story-1", key: "uploads/a.jpg", src: "https://cdn.test/uploads/a.jpg" }] }) // scan
            .mockResolvedValueOnce({}); // delete
        mockS3Send.mockResolvedValueOnce({});

        const result = await cleanupExpiredStories();
        expect(result.deleted).toBe(1);
        const s3Input = (mockS3Send.mock.calls[0][0] as { input: { Bucket: string; Key: string } }).input;
        expect(s3Input).toEqual({ Bucket: "bucket-test", Key: "uploads/a.jpg" });
    });

    it("key が無い場合は src の URL パスから導出する", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Items: [{ id: "story-2", src: "https://cdn.test/uploads/b.mp4" }] })
            .mockResolvedValueOnce({});
        mockS3Send.mockResolvedValueOnce({});

        await cleanupExpiredStories();
        const s3Input = (mockS3Send.mock.calls[0][0] as { input: { Key: string } }).input;
        expect(s3Input.Key).toBe("uploads/b.mp4");
    });

    it("S3 削除に失敗しても DDB レコードは削除する", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Items: [{ id: "story-3", key: "uploads/c.jpg" }] })
            .mockResolvedValueOnce({});
        mockS3Send.mockRejectedValueOnce(new Error("s3 down"));

        const result = await cleanupExpiredStories();
        expect(result.deleted).toBe(1);
    });

    it("期限切れが無ければ何もしない", async () => {
        mockDdbSend.mockResolvedValueOnce({ Items: [] });
        const result = await cleanupExpiredStories();
        expect(result.deleted).toBe(0);
        expect(mockS3Send).not.toHaveBeenCalled();
    });
});
