import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ストーリーのアーカイブ（24時間で消えたあとも、本人だけが見られる）。
 *
 * **仕組みは `keptAs` と同じ1本**——行に印があれば掃除が消さない。
 * ここで見るのは5つ:
 *   1. 投稿で印（`archive: true`）が立つ／既定では立たない
 *   2. 掃除が印を見て、消す代わりに `archivedAt` を刻み GSI から外す。
 *      **他人の言葉と名前（返信の文書・viewers・replyCount）は消す**、
 *      本人の実体（S3）と行は残る。印の無い行は今までどおり消える
 *   3. 一覧は本人の索引を「印あり ＋ 期限切れ」で引く（`archivedAt` では
 *      引かない——掃除が来るまでの1時間、どこにも無い時間を作らない）
 *   4. 「残す」は印のある投稿を断る（残した写真と実体を共有するので、
 *      写真を消すとアーカイブごと消える。切り離すまでは、どちらか一方）
 *   5. 期限が切れたら閲覧者も返信も読めない（掃除が来るまでの窓も含めて）
 *
 * **`archive` は DynamoDB の予約語。** 式に素で書くと ValidationException で、
 * 掃除は1行も移せず・一覧は必ず 500 になる。モックのテストでは絶対に
 * 捕まらないので、ここでは**置き換え名を使っていること**を固定する。
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
    pushNotification: async () => undefined,
}));
vi.stubEnv("CLOUDFRONT_URL", "https://cdn.test");
vi.stubEnv("UPLOAD_BUCKET", "bucket-test");

const { createStory, cleanupExpiredStories, getStoryViewers } = await import("../stories");
const { getStoryArchive } = await import("../storyArchive");
const { keepStory } = await import("../storyKeep");
const { getStoryReplies, storyRepliesId } = await import("../storyReplies");
const { isStoryExpired } = await import("../storyExpiry");

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
/**
 * 式が予約語 `archive` を素で使っていないこと。**置き換え名の宣言まで見る**
 * ——`#a` と書いても `ExpressionAttributeNames` が無ければ同じく落ちる
 */
const expectNoBareArchive = (input: Record<string, unknown>, ...exprKeys: string[]) => {
    for (const k of exprKeys) {
        const expr = String(input[k] ?? "");
        expect(expr, `${k} が予約語 archive を素で使っている（ValidationException になる）`).not.toMatch(/(^|[^#\w])archive\b/);
    }
    const names = (input.ExpressionAttributeNames ?? {}) as Record<string, string>;
    expect(Object.values(names), "置き換え名が archive を指していない").toContain("archive");
};

const ME = "11111111-1111-4111-8111-111111111111";
const PAST = "2026-07-04T10:00:00.000Z";
const FUTURE = "2099-07-05T10:00:00.000Z";

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
        expect(expr, "archivedAt を刻んでいない（最初の時刻を守る形で）").toMatch(/SET archivedAt = if_not_exists\(archivedAt, :exp\)/);
        // **刻むのは期限の時刻**（掃除が来た時刻ではない）。一覧は掃除前の
        // 行にも期限の時刻を埋めるので、ここが違うと同じ行の日付が掃除の
        // 前後で跳ぶ
        expect((up[0].input.ExpressionAttributeValues as Record<string, unknown>)[":exp"], "掃除の時刻を刻んでいる").toBe(PAST);
        expect(expr, "GSI から外していない（毎時また拾う・一覧に出続ける）").toMatch(/REMOVE storyFeed/);
        expect(expr, "閲覧者を残している").toMatch(/\bviewers\b/);
        expect(expr, "返信の数を残している（消した文書と食い違う）").toMatch(/\breplyCount\b/);
        // 条件: 印が立っていて、まだ GSI に載っている行だけ
        expect(up[0].input.ConditionExpression).toBe("#a = :t AND attribute_exists(storyFeed)");
        expectNoBareArchive(up[0].input, "ConditionExpression", "UpdateExpression");
        expect((up[0].input.ExpressionAttributeValues as Record<string, unknown>)[":t"]).toBe(true);
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

    it("条件が外れた（もう棚に在る・印が外れた・行が消えた）は失敗にせず、どれかを言う", async () => {
        // 読み直すと、もう棚に在る（storyFeed 無し・archivedAt あり）
        const shelved = { ...KEEP, archivedAt: PAST } as Record<string, unknown>;
        mockDdbSend.mockImplementation((cmd: Cmd) => {
            if (cmd.constructor.name === "QueryCommand") return Promise.resolve({ Items: [KEEP] });
            if (cmd.constructor.name === "UpdateCommand") {
                return Promise.reject(Object.assign(new Error("ccf"), { name: "ConditionalCheckFailedException" }));
            }
            if (cmd.constructor.name === "GetCommand") return Promise.resolve({ Item: shelved });
            return Promise.resolve({});
        });
        // **error にはしない**（毎時「失敗」が積もると本物が埋もれる）が、
        // **黙りもしない**——しかも「消された（普通の競合）」と「印が外れた・
        // storyFeed が無いのに一覧に出た（異常）」を**見分けられる**形で残す
        const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            const r = await cleanupExpiredStories();
            expect(r).toEqual({ deleted: 0, archived: 0 });
            expect(s3Keys()).toEqual([]);
            expect(err.mock.calls.filter((c) => String(c[0]).includes("s-keep")), "失敗として記録している").toEqual([]);
            const line = warn.mock.calls.map((c) => String(c[0])).find((s) => s.includes("s-keep"));
            expect(line, "黙って飛ばしている").toBeTruthy();
            expect(line, "どの状態で外れたかが分からない").toContain("storyFeed=false");
        } finally {
            err.mockRestore();
            warn.mockRestore();
        }
    });

    it("Scan の経路は棚へ移した行（storyFeed 無し）を拾わない（毎時撫で直さない）", async () => {
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
        const filter = String(scan[0].input.FilterExpression);
        // 物差しは棚へ移す条件式と同じ「まだ一覧に載っているか」。
        // `archivedAt` で見ると、刻まれたのに storyFeed が残る半端な行を
        // この経路では永久に直せない
        expect(filter).toContain("attribute_exists(storyFeed)");
        expect(filter, "archivedAt で見ている（半端な行が直らない）").not.toContain("archivedAt");
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

    it("本人の索引を「印あり ＋ 期限切れ」で新しい順に引き、2つの形を1つに揃えて返す", async () => {
        mockDdbSend.mockResolvedValue({ Items: [
            // 掃除がまだ来ていない行（期限は切れている）
            { id: "a2", userId: ME, story: true, archive: true, storyFeed: "1", expiresAt: PAST, createdAt: "2", viewers: { u9: { at: "t" } }, replyCount: 3 },
            // 棚へ移った行
            { id: "a1", userId: ME, story: true, archive: true, expiresAt: PAST, createdAt: "1", archivedAt: "2026-07-04T11:00:00.000Z" },
        ] });
        const r = await invoke(getStoryArchive, ev(ME));
        expect(r.statusCode).toBe(200);

        const q = ofKind("QueryCommand")[0].input;
        expect(q.IndexName).toBe("userId-createdAt-index");
        expect(q.KeyConditionExpression).toBe("userId = :u");
        const values = q.ExpressionAttributeValues as Record<string, unknown>;
        expect(values[":u"]).toBe(ME);
        const filter = String(q.FilterExpression);
        expect(filter, "印の無い行（普通のストーリー・写真）が混ざる").toContain("#a = :t");
        expect(filter, "まだ生きている行が混ざる（バーとアーカイブに二重に出る）").toContain("expiresAt <= :now");
        expect(filter, "archivedAt で引いている（掃除が来るまでの1時間、どこにも無い）").not.toContain("archivedAt");
        expectNoBareArchive(q, "FilterExpression", "KeyConditionExpression");
        expect(typeof values[":now"]).toBe("string");
        expect(filter).toContain("story = :t");
        expect(q.ScanIndexForward, "古い順になっている").toBe(false);

        const items = JSON.parse(r.body) as Array<Record<string, unknown>>;
        expect(items.map((i) => i.id)).toEqual(["a2", "a1"]);
        // 掃除が消すものは応答にも出さない
        expect(items[0].viewers, "閲覧者を応答に出している").toBeUndefined();
        expect(items[0].replyCount, "返信の数を応答に出している").toBeUndefined();
        expect(items[0].storyFeed, "索引の都合の列を画面に出している").toBeUndefined();
        // 棚へ移る前の行にも archivedAt を埋める（画面が2つの形を知らなくて済む）
        expect(items[0].archivedAt, "掃除前の行に archivedAt が無い").toBe(PAST);
        expect(items[1].archivedAt, "刻まれた時刻を上書きしている").toBe("2026-07-04T11:00:00.000Z");
        expect(r.headers?.["Cache-Control"]).toContain("no-store");
    });

    it("ページをまたいで全部引く", async () => {
        mockDdbSend
            .mockResolvedValueOnce({ Items: [{ id: "a3", expiresAt: PAST }], LastEvaluatedKey: { id: "a3" } })
            .mockResolvedValueOnce({ Items: [{ id: "a2", expiresAt: PAST }] });
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
// 4. 「残す」は印のある投稿を断る
// ────────────────────────────────
describe("keepStory: アーカイブに自動保存の投稿は残せない", () => {
    const KEY = `uploads/${ME}/3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607.webp`;
    const base = {
        id: "story-1", story: true, userId: ME, mediaType: "image",
        src: `https://cdn.test/${KEY}`, key: KEY, createdAt: PAST,
    };
    const world = (story: Record<string, unknown>) => {
        mockDdbSend.mockImplementation((cmd: Cmd) =>
            Promise.resolve(cmd.constructor.name === "GetCommand" ? { Item: story } : {}));
    };
    const keep = () => invoke(keepStory, ev(ME, { pathParameters: { id: "story-1" } }));

    // 残した写真とストーリーは S3 の実体を共有する。写真を消すと
    // `deleteMyPhoto` の `keptFrom` がストーリーの行ごと消すので、アーカイブに
    // 残すつもりのものが黙って消える。切り離すまでは、どちらか一方
    it("生きていても、印があれば 409 と理由", async () => {
        world({ ...base, expiresAt: FUTURE, archive: true });
        const r = await keep();
        expect(r.statusCode).toBe(409);
        expect(JSON.parse(r.body).error, "理由が伝わらない").toContain("アーカイブ");
        expect(mockPutPhoto, "写真を作っている").not.toHaveBeenCalled();
    });

    it("期限切れは、棚へ移っていても 404（今までどおり）", async () => {
        world({ ...base, expiresAt: PAST, archive: true, archivedAt: "2026-07-05T11:00:00.000Z" });
        expect((await keep()).statusCode).toBe(404);
        expect(mockPutPhoto).not.toHaveBeenCalled();
    });

    it("印の無い生きている投稿は残せる（今までどおり）", async () => {
        world({ ...base, expiresAt: FUTURE });
        expect((await keep()).statusCode).toBe(200);
        expect(mockPutPhoto).toHaveBeenCalledTimes(1);
    });

    // 応答が失われて押し直された回に、409 ではなく同じ写真IDを返す
    // （断るのは冪等の分岐より後ろ）
    it("既に残してあれば、印があっても冪等で同じ写真IDを返す", async () => {
        world({ ...base, expiresAt: FUTURE, archive: true, keptAs: "p1" });
        const r = await keep();
        expect(r.statusCode).toBe(200);
        expect(JSON.parse(r.body)).toEqual({ photoId: "p1", already: true });
    });
});

// ────────────────────────────────
// 期限の判定は1か所
// ────────────────────────────────
describe("isStoryExpired", () => {
    const NOW = "2026-07-04T12:00:00.000Z";
    it("過去なら切れている・未来なら生きている・同時刻は切れている", () => {
        expect(isStoryExpired({ expiresAt: "2026-07-04T11:59:59.000Z" }, NOW)).toBe(true);
        expect(isStoryExpired({ expiresAt: "2026-07-04T12:00:01.000Z" }, NOW)).toBe(false);
        expect(isStoryExpired({ expiresAt: NOW }, NOW)).toBe(true);
    });
    it("持たない・文字列でない・空は有効扱い（無い理由で締め出さない）", () => {
        expect(isStoryExpired({}, NOW)).toBe(false);
        expect(isStoryExpired({ expiresAt: 0 }, NOW)).toBe(false);
        expect(isStoryExpired({ expiresAt: "" }, NOW)).toBe(false);
    });
});

// ────────────────────────────────
// 5. 期限が切れたら、閲覧者も返信も読めない
// ────────────────────────────────
describe("期限切れの閲覧者・返信は本人にも出さない（掃除が来るまでの窓も）", () => {
    const story = (expiresAt: string) => ({
        id: "story-1", story: true, userId: ME, src: "https://cdn.test/s.jpg", expiresAt,
        viewers: { "u9": { displayName: "見た人", at: "t" } },
    });
    const world = (expiresAt: string) => {
        mockDdbSend.mockImplementation((cmd: Cmd) => {
            const id = String((cmd.input.Key as { id?: string } | undefined)?.id ?? "");
            if (cmd.constructor.name !== "GetCommand") return Promise.resolve({});
            if (id === "story-1") return Promise.resolve({ Item: story(expiresAt) });
            if (id === storyRepliesId("story-1")) {
                return Promise.resolve({ Item: { items: [{ id: "r1", uid: "u9", name: "見た人", text: "きれい", t: "t" }] } });
            }
            return Promise.resolve({});
        });
    };
    const req = ev(ME, { pathParameters: { id: "story-1" } });

    it("閲覧者: 期限切れなら 0 人（名前は期限とともに消える側）", async () => {
        world(PAST);
        const r = await invoke(getStoryViewers, req);
        expect(r.statusCode).toBe(200);
        expect(JSON.parse(r.body)).toEqual({ viewers: [], count: 0 });
    });

    it("閲覧者: 生きていれば今までどおり出る", async () => {
        world(FUTURE);
        const r = await invoke(getStoryViewers, req);
        expect(JSON.parse(r.body).count).toBe(1);
    });

    it("返信: 期限切れなら 0 件（相手は 24時間で消えるつもりで送っている）", async () => {
        world(PAST);
        const r = await invoke(getStoryReplies, req);
        expect(r.statusCode).toBe(200);
        expect(JSON.parse(r.body)).toEqual({ items: [], count: 0 });
        expect(ofKind("GetCommand").map((c) => (c.input.Key as { id: string }).id), "文書まで読みにいっている")
            .not.toContain(storyRepliesId("story-1"));
    });

    it("返信: 生きていれば今までどおり出る", async () => {
        world(FUTURE);
        const r = await invoke(getStoryReplies, req);
        expect(JSON.parse(r.body).count).toBe(1);
    });
});
