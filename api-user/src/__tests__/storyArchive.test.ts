import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ストーリーのアーカイブ（24時間で消えたあとも、本人だけが見られる）。
 *
 * **仕組みは `keptAs` と同じ1本**——行に印があれば掃除が消さない。
 * ここで見るのは4つ:
 *   1. 投稿で印（`archive: true`）が立つ／既定では立たない
 *   2. 掃除が印を見て、消す代わりに `archivedAt` を刻み GSI から外す。
 *      **他人の言葉と名前（返信の文書・viewers・replyCount）は消す**、
 *      本人の実体（S3）と行は残る。印の無い行は今までどおり消える
 *   3. 一覧は本人の索引を「印あり ＋ 期限切れ」で引く（`archivedAt` では
 *      引かない——掃除が来るまでの1時間、どこにも無い時間を作らない）
 *   4. アーカイブから「残す」は**押せない**（残した写真と実体を共有する
 *      ので、写真を消すとアーカイブごと消える。切り離すまでは断る）
 */

const mockDdbSend = vi.hoisted(() => vi.fn());
const mockS3Send = vi.hoisted(() => vi.fn());
const mockInvalidate = vi.hoisted(() => vi.fn(async () => undefined));
const mockPutPhoto = vi.hoisted(() => vi.fn());
const mockPhotoLimit = vi.hoisted(() => vi.fn(async () => null));

vi.mock("../dynamodb", () => ({
    ddb: { send: mockDdbSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
    STORY_INDEX: "storyFeed-expiresAt-index",
    STORY_FEED_KEY: "1",
}));
vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = mockS3Send; },
    DeleteObjectCommand: class { input: unknown; constructor(input: unknown) { this.input = input; } },
    DeleteObjectsCommand: class { input: unknown; constructor(input: unknown) { this.input = input; } },
}));
vi.mock("../cdnInvalidate", () => ({ invalidateUploads: (...a: unknown[]) => mockInvalidate(...(a as [])) }));
vi.mock("../ddb-photos", () => ({ putPhoto: mockPutPhoto }));
vi.mock("../photoLimit", () => ({ photoLimitError: () => mockPhotoLimit() }));
vi.mock("../blockCheck", async (importActual) => ({
    ...(await importActual<typeof import("../blockCheck")>()),
    isBlocked: async () => false,
    hiddenUserIds: async () => new Set<string>(),
}));
vi.mock("../notify", async (importActual) => ({
    ...(await importActual<typeof import("../notify")>()),
    lookupDisplayName: async () => "名前",
    lookupDisplayNameIfSet: async () => "名前",
    deletedUserIds: async () => new Set<string>(),
}));
vi.stubEnv("CLOUDFRONT_URL", "https://cdn.test");
vi.stubEnv("UPLOAD_BUCKET", "bucket-test");

const { createStory, cleanupExpiredStories } = await import("../stories");
const { getStoryArchive } = await import("../storyArchive");
const { keepStory } = await import("../storyKeep");

type Result = { statusCode: number; headers?: Record<string, string>; body: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const invoke = (h: unknown, e: unknown): Promise<Result> => (h as any)(e);
const ev = (sub: string | undefined, overrides: Record<string, unknown> = {}) => ({
    requestContext: { authorizer: { jwt: { claims: { sub } } } },
    ...overrides,
});
type Cmd = { constructor: { name: string }; input: Record<string, unknown> };
const cmds = () => mockDdbSend.mock.calls.map((c) => c[0] as Cmd);
const ofKind = (name: string) => cmds().filter((c) => c.constructor.name === name);
const deletedIds = () => ofKind("DeleteCommand").map((c) => (c.input.Key as { id: string }).id);
const s3Keys = () => mockS3Send.mock.calls.flatMap((c) => {
    const input = (c[0] as { input: { Delete?: { Objects?: Array<{ Key: string }> }; Key?: string } }).input;
    return input.Delete?.Objects?.map((o) => o.Key) ?? (input.Key ? [input.Key] : []);
});

const ME = "11111111-1111-4111-8111-111111111111";
const PAST = "2026-07-04T10:00:00.000Z";

beforeEach(() => {
    mockDdbSend.mockReset();
    mockS3Send.mockReset().mockResolvedValue({});
    mockInvalidate.mockReset().mockResolvedValue(undefined);
    mockPutPhoto.mockReset().mockResolvedValue(undefined);
    mockPhotoLimit.mockReset().mockResolvedValue(null);
});

// ────────────────────────────────
// 1. 投稿で印が立つ
// ────────────────────────────────
describe("createStory: アーカイブに自動保存", () => {
    const post = (body: Record<string, unknown>) => invoke(createStory, ev(ME, {
        body: JSON.stringify({ publicUrl: `https://cdn.test/uploads/${ME}/a.webp`, ...body }),
    }));
    const saved = () => ofKind("PutCommand")[0]?.input.Item as Record<string, unknown>;

    beforeEach(() => { mockDdbSend.mockResolvedValue({ Count: 0 }); });

    it("既定では印を持たない＝今までどおり24時間で消える", async () => {
        expect((await post({})).statusCode).toBe(201);
        expect(saved()).not.toHaveProperty("archive");
    });

    it("true を明示したときだけ立てる", async () => {
        await post({ archive: true });
        expect(saved().archive).toBe(true);
    });

    it("true 以外（文字列の \"true\"・1）では立てない", async () => {
        for (const v of ["true", 1, "yes"]) {
            mockDdbSend.mockReset().mockResolvedValue({ Count: 0 });
            await post({ archive: v });
            expect(saved(), `${JSON.stringify(v)} で立っている`).not.toHaveProperty("archive");
        }
    });
});

// ────────────────────────────────
// 2. 掃除が印を見る
// ────────────────────────────────
describe("cleanupExpiredStories: 印のある行は消さずに棚へ", () => {
    const rows = (items: Record<string, unknown>[]) => {
        mockDdbSend.mockImplementation((cmd: Cmd) =>
            Promise.resolve(cmd.constructor.name === "QueryCommand" ? { Items: items } : {}));
    };
    const KEEP = { id: "s-keep", userId: ME, story: true, key: `uploads/${ME}/k.webp`, src: `https://cdn.test/uploads/${ME}/k.webp`, expiresAt: PAST, archive: true };
    const GONE = { id: "s-gone", userId: ME, story: true, key: `uploads/${ME}/g.webp`, src: `https://cdn.test/uploads/${ME}/g.webp`, expiresAt: PAST };

    it("印のある行: 返信を消し、archivedAt を刻み、storyFeed・viewers・replyCount を外す。S3 と行は残る", async () => {
        rows([KEEP]);
        const r = await cleanupExpiredStories();
        expect(r).toEqual({ deleted: 0, archived: 1 });

        // **他人の言葉と名前は消える側**（`photoUpdate.ts` が塞いだ
        // 「24時間で消えるはずの他人の文章と uid が無期限に残る」を作らない）
        expect(deletedIds(), "返信の文書を消していない／行を消している").toEqual(["storyreplies#s-keep"]);

        const up = ofKind("UpdateCommand");
        expect(up, "棚へ移す更新が1回でない").toHaveLength(1);
        const expr = String(up[0].input.UpdateExpression);
        expect(expr, "archivedAt を刻んでいない").toMatch(/SET archivedAt = :now/);
        expect(expr, "GSI から外していない（毎時また拾う・一覧に出続ける）").toMatch(/REMOVE storyFeed/);
        expect(expr, "閲覧者を残している").toMatch(/\bviewers\b/);
        expect(expr, "返信の数を残している（消した文書と食い違う）").toMatch(/\breplyCount\b/);
        expect(up[0].input.ConditionExpression, "いま移してよい行だけ、という条件が無い")
            .toBe("attribute_exists(id) AND archive = :t AND attribute_not_exists(archivedAt)");
        expect((up[0].input.Key as { id: string }).id).toBe("s-keep");

        expect(s3Keys(), "実体を消している").toEqual([]);
    });

    it("印の無い行は今までどおり消える（S3 → 返信 → 行）", async () => {
        rows([GONE]);
        const r = await cleanupExpiredStories();
        expect(r).toEqual({ deleted: 1, archived: 0 });
        expect(s3Keys()).toContain(`uploads/${ME}/g.webp`);
        expect(deletedIds()).toEqual(["storyreplies#s-gone", "s-gone"]);
        expect(ofKind("UpdateCommand")).toHaveLength(0);
    });

    it("混ざっていても、それぞれ正しい側へ", async () => {
        rows([KEEP, GONE]);
        const r = await cleanupExpiredStories();
        expect(r).toEqual({ deleted: 1, archived: 1 });
        expect(deletedIds()).toEqual(["storyreplies#s-keep", "storyreplies#s-gone", "s-gone"]);
        expect(s3Keys()).toEqual([`uploads/${ME}/g.webp`]);
    });

    it("返信を消せなければ棚へ移さない（行は GSI に残り、次回また来る）", async () => {
        mockDdbSend.mockImplementation((cmd: Cmd) => {
            if (cmd.constructor.name === "QueryCommand") return Promise.resolve({ Items: [KEEP] });
            if (cmd.constructor.name === "DeleteCommand") return Promise.reject(new Error("throttled"));
            return Promise.resolve({});
        });
        const r = await cleanupExpiredStories();
        expect(r).toEqual({ deleted: 0, archived: 0 });
        expect(ofKind("UpdateCommand"), "返信が残ったまま GSI から外している（二度と辿れない）").toHaveLength(0);
        expect(s3Keys()).toEqual([]);
    });

    it("棚へ移せなかったら行を消さない（次回にまた来る）", async () => {
        mockDdbSend.mockImplementation((cmd: Cmd) => {
            if (cmd.constructor.name === "QueryCommand") return Promise.resolve({ Items: [KEEP] });
            if (cmd.constructor.name === "UpdateCommand") return Promise.reject(new Error("throttled"));
            return Promise.resolve({});
        });
        const r = await cleanupExpiredStories();
        expect(r).toEqual({ deleted: 0, archived: 0 });
        expect(deletedIds(), "行を消している").toEqual(["storyreplies#s-keep"]);
        expect(s3Keys()).toEqual([]);
    });

    it("条件が外れた（もう棚に在る・行が消えた）は静かに飛ばす", async () => {
        mockDdbSend.mockImplementation((cmd: Cmd) => {
            if (cmd.constructor.name === "QueryCommand") return Promise.resolve({ Items: [KEEP] });
            if (cmd.constructor.name === "UpdateCommand") {
                return Promise.reject(Object.assign(new Error("ccf"), { name: "ConditionalCheckFailedException" }));
            }
            return Promise.resolve({});
        });
        // **エラーとして記録しない。** やることが無いだけで、失敗ではない
        // （毎時「失敗」が積もると、本物の失敗が埋もれる）
        const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            const r = await cleanupExpiredStories();
            expect(r).toEqual({ deleted: 0, archived: 0 });
            expect(s3Keys()).toEqual([]);
            expect(err.mock.calls.filter((c) => String(c[0]).includes("s-keep")), "失敗として記録している").toEqual([]);
        } finally {
            err.mockRestore();
        }
    });

    it("Scan の経路は archivedAt の在る行を拾わない（毎時撫で直さない）", async () => {
        // GSI が無い環境（ValidationException）で Scan に落ちる
        mockDdbSend.mockImplementation((cmd: Cmd) => {
            if (cmd.constructor.name === "QueryCommand") {
                return Promise.reject(Object.assign(new Error("no index"), { name: "ValidationException" }));
            }
            return Promise.resolve({ Items: [] });
        });
        await cleanupExpiredStories();
        const scan = ofKind("ScanCommand");
        expect(scan).toHaveLength(1);
        expect(String(scan[0].input.FilterExpression)).toContain("attribute_not_exists(archivedAt)");
    });
});

// ────────────────────────────────
// 3. 一覧
// ────────────────────────────────
describe("getStoryArchive", () => {
    it("未ログインは 401", async () => {
        expect((await invoke(getStoryArchive, ev(undefined))).statusCode).toBe(401);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it("本人の索引を「印あり ＋ 期限切れ」で新しい順に引き、閲覧者と返信の数は外す", async () => {
        mockDdbSend.mockResolvedValue({ Items: [
            { id: "a2", userId: ME, story: true, archive: true, expiresAt: PAST, createdAt: "2", viewers: { u9: { at: "t" } }, replyCount: 3 },
            { id: "a1", userId: ME, story: true, archive: true, expiresAt: PAST, createdAt: "1", archivedAt: "x" },
        ] });
        const r = await invoke(getStoryArchive, ev(ME));
        expect(r.statusCode).toBe(200);

        const q = ofKind("QueryCommand")[0].input;
        expect(q.IndexName).toBe("userId-createdAt-index");
        expect(q.KeyConditionExpression).toBe("userId = :u");
        const values = q.ExpressionAttributeValues as Record<string, unknown>;
        expect(values[":u"]).toBe(ME);
        const filter = String(q.FilterExpression);
        expect(filter, "印の無い行（普通のストーリー・写真）が混ざる").toContain("archive = :t");
        expect(filter, "まだ生きている行が混ざる（バーとアーカイブに二重に出る）").toContain("expiresAt <= :now");
        expect(filter, "archivedAt で引いている（掃除が来るまでの1時間、どこにも無い）").not.toContain("archivedAt");
        expect(typeof values[":now"]).toBe("string");
        expect(filter).toContain("story = :t");
        expect(q.ScanIndexForward, "古い順になっている").toBe(false);

        const items = JSON.parse(r.body) as Array<Record<string, unknown>>;
        expect(items.map((i) => i.id)).toEqual(["a2", "a1"]);
        expect(items[0].viewers, "閲覧者を応答に出している（掃除が消すものは出さない）").toBeUndefined();
        expect(items[0].replyCount, "返信の数を応答に出している").toBeUndefined();
        expect(r.headers?.["Cache-Control"]).toContain("no-store");
    });

    it("ページをまたいで全部引く", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Items: [{ id: "a3" }], LastEvaluatedKey: { id: "a3" } })
            .mockResolvedValueOnce({ Items: [{ id: "a2" }] });
        const r = await invoke(getStoryArchive, ev(ME));
        expect((JSON.parse(r.body) as Array<{ id: string }>).map((i) => i.id)).toEqual(["a3", "a2"]);
        expect(ofKind("QueryCommand")[1].input.ExclusiveStartKey).toEqual({ id: "a3" });
    });

    it("読めなければ 500（空の一覧に見せない）", async () => {
        mockDdbSend.mockRejectedValue(new Error("throttled"));
        expect((await invoke(getStoryArchive, ev(ME))).statusCode).toBe(500);
    });
});

// ────────────────────────────────
// 4. アーカイブから「残す」は押せない
// ────────────────────────────────
describe("keepStory: アーカイブ済みでも期限切れは断る", () => {
    // 残した写真とストーリーは S3 の実体を共有する。写真を消すと
    // `deleteMyPhoto` の `keptFrom` がストーリーの行ごと消すので、アーカイブに
    // 残すつもりのものが黙って消える。切り離すまでは、残せるのは生きている間だけ
    it("印と archivedAt があっても 404", async () => {
        const KEY = `uploads/${ME}/3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607.webp`;
        mockDdbSend.mockImplementation((cmd: Cmd) => Promise.resolve(cmd.constructor.name === "GetCommand"
            ? { Item: {
                id: "story-1", story: true, userId: ME, mediaType: "image",
                src: `https://cdn.test/${KEY}`, key: KEY, createdAt: PAST, expiresAt: PAST,
                archive: true, archivedAt: "2026-07-05T11:00:00.000Z",
            } }
            : {}));
        const r = await invoke(keepStory, ev(ME, { pathParameters: { id: "story-1" } }));
        expect(r.statusCode).toBe(404);
        expect(mockPutPhoto, "写真を作っている").not.toHaveBeenCalled();
    });
});
