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

const { createStory, cleanupExpiredStories, getStoryViewers, getStories } = await import("../stories");
const { getStoryArchive } = await import("../storyArchive");
const { keepStory } = await import("../storyKeep");
const { getStoryReplies, postStoryReply, storyRepliesId } = await import("../storyReplies");
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
/** 棚入れのトランザクション（行の更新 ＋ 返信の文書の削除）を順に取り出す */
type TxItem = { Update?: Record<string, unknown>; Delete?: { Key: { id: string } } };
const shelves = () => ofKind("TransactWriteCommand").map((c) => c.input.TransactItems as TxItem[]);
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
    // GSI が返す行は必ず `storyFeed` を持つ（それがキー）。持たせておかないと、
    // 「読み直した行」と「読んだ時点の行」を取り違えても気づけない
    const KEEP = { id: "s-keep", userId: ME, story: true, storyFeed: "1", key: `uploads/${ME}/k.webp`, src: `https://cdn.test/uploads/${ME}/k.webp`, expiresAt: PAST, archive: true };
    const GONE = { id: "s-gone", userId: ME, story: true, storyFeed: "1", key: `uploads/${ME}/g.webp`, src: `https://cdn.test/uploads/${ME}/g.webp`, expiresAt: PAST };

    it("印のある行: 1つのトランザクションで、返信を消し・archivedAt を刻み・storyFeed/viewers/replyCount を外す。S3 と行は残る", async () => {
        rows([KEEP]);
        const r = await cleanupExpiredStories();
        expect(r).toEqual({ deleted: 0, archived: 1 });

        // **1回で書く。** 2回に分ける（文書を消す → 行を更新）と、その間に
        // 届いた返信が文書を作り直し、件数の更新は archivedAt がまだ無いので
        // 通り、他人の返信の文書が棚の行の隣に残る（掃除は二度と来ない）
        expect(deletedIds(), "別々に消している（間に返信が挟まる）／行を消している").toEqual([]);
        expect(ofKind("UpdateCommand"), "別々に更新している").toHaveLength(0);
        const tx = shelves();
        expect(tx, "棚入れのトランザクションが1回でない").toHaveLength(1);
        const [update, del, votes] = tx[0];
        expect(del?.Delete?.Key.id, "返信の文書を一緒に消していない").toBe("storyreplies#s-keep");
        // 票の文書も他人の uid なので、棚には残さない（`storyVotes.ts`）
        expect(votes?.Delete?.Key.id, "票の文書を一緒に消していない").toBe("storyvotes#s-keep");
        expect(update?.Update, "行の更新が無い").toBeTruthy();
        const up = update!.Update!;
        const expr = String(up.UpdateExpression);
        // **刻むのは期限の時刻**（掃除が来た時刻ではない）。一覧は掃除前の
        // 行にも期限の時刻を埋めるので、ここが違うと同じ行の日付が掃除の
        // 前後で跳ぶ。行の `expiresAt` をそのまま写す（手元の値を渡さない）
        expect(expr, "archivedAt に期限の時刻を（最初の時刻を守る形で）写していない")
            .toMatch(/SET archivedAt = if_not_exists\(archivedAt, expiresAt\)/);
        expect(Object.keys(up.ExpressionAttributeValues as Record<string, unknown>), "掃除側の時計の値を渡している").not.toContain(":exp");
        expect(expr, "GSI から外していない（毎時また拾う・一覧に出続ける）").toMatch(/REMOVE storyFeed/);
        expect(expr, "閲覧者を残している").toMatch(/\bviewers\b/);
        expect(expr, "返信の数を残している（消した文書と食い違う）").toMatch(/\breplyCount\b/);
        // 条件: 印が立っていて、まだ棚へ移していない行だけ——**Scan の
        // 絞り込みと同じ物差し**（ずれると、絞り込みだけが拾う行が毎時
        // 条件不成立で永久に収束しない）。`attribute_exists(id)` は要らない
        // ——行が無ければ `#a = :t` が必ず外れる（書き足すと見張りが二重になる）
        expect(up.ConditionExpression)
            .toBe("#a = :t AND (attribute_exists(storyFeed) OR attribute_not_exists(archivedAt))");
        expectNoBareArchive(up, "ConditionExpression", "UpdateExpression");
        expect((up.ExpressionAttributeValues as Record<string, unknown>)[":t"]).toBe(true);
        expect((up.Key as { id: string }).id).toBe("s-keep");

        expect(s3Keys(), "実体を消している").toEqual([]);
    });

    it("印の無い行は今までどおり消える（S3 → 返信 → 行）", async () => {
        rows([GONE]);
        const r = await cleanupExpiredStories();
        expect(r).toEqual({ deleted: 1, archived: 0 });
        expect(s3Keys()).toContain(`uploads/${ME}/g.webp`);
        // 票の文書は行より先に、そして行のあとにもう一度（`storyVotes.ts`）
        expect(deletedIds()).toEqual(["storyreplies#s-gone", "storyvotes#s-gone", "s-gone", "storyvotes#s-gone"]);
        expect(ofKind("UpdateCommand")).toHaveLength(0);
    });

    it("混ざっていても、それぞれ正しい側へ", async () => {
        rows([KEEP, GONE]);
        const r = await cleanupExpiredStories();
        expect(r).toEqual({ deleted: 1, archived: 1 });
        expect(deletedIds()).toEqual(["storyreplies#s-gone", "storyvotes#s-gone", "s-gone", "storyvotes#s-gone"]);
        expect(shelves()).toHaveLength(1);
        expect(s3Keys()).toEqual([`uploads/${ME}/g.webp`]);
    });

    it("expiresAt を持たない行は飛ばす（最後の砦。error では鳴らさない）", async () => {
        // `archivedAt` に期限を写すので、無いと更新は ValidationException に
        // なる。ここに来る行は必ず持つ（GSI のソートキー／Scan の絞り込み）。
        // 直す手が無い行を毎時 error で鳴らすと本物の失敗が埋もれる
        const noExp = Object.fromEntries(Object.entries(KEEP).filter(([k]) => k !== "expiresAt"));
        rows([noExp]);
        const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            const r = await cleanupExpiredStories();
            expect(r).toEqual({ deleted: 0, archived: 0 });
            expect(shelves(), "書きにいっている").toHaveLength(0);
            expect(deletedIds()).toEqual([]);
            expect(warn.mock.calls.some((c) => String(c[0]).includes("no expiresAt")), "理由を残していない").toBe(true);
            expect(err.mock.calls.some((c) => String(c[0]).includes("s-keep")), "失敗として鳴らしている").toBe(false);
        } finally {
            err.mockRestore();
            warn.mockRestore();
        }
    });

    it("書けなければ（取り消し以外の失敗）失敗として次回に回す。部分適用は無い", async () => {
        mockDdbSend.mockImplementation((cmd: Cmd) => {
            if (cmd.constructor.name === "QueryCommand") return Promise.resolve({ Items: [KEEP] });
            if (cmd.constructor.name === "TransactWriteCommand") return Promise.reject(new Error("throttled"));
            return Promise.resolve({});
        });
        const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            const r = await cleanupExpiredStories();
            expect(r).toEqual({ deleted: 0, archived: 0 });
            // トランザクションなので「返信だけ消えた」「行だけ移った」は無い
            expect(deletedIds(), "文書を別に消している").toEqual([]);
            expect(ofKind("UpdateCommand"), "行を別に更新している").toHaveLength(0);
            expect(s3Keys()).toEqual([]);
            expect(err.mock.calls.some((c) => String(c[0]).includes("archive failed for s-keep")), "失敗を記録していない").toBe(true);
        } finally {
            err.mockRestore();
        }
    });

    /**
     * 条件が外れた（CCF）ときの世界。**error にはしない**（毎時「失敗」が
     * 積もると本物が埋もれる）が、**黙りもしない**——しかも「消された
     * （普通の競合）」「もう棚に在る」「読み直せなかった」を**見分けられる**
     * 形で残す。読み直した行を使っていることは、`KEEP`（storyFeed あり）と
     * 読み直しの行（storyFeed 無し）が違うことで確かめる
     */
    const ccfWorld = (reread: "shelved" | "gone" | "fail" | "infeed") => {
        const shelved = Object.fromEntries(Object.entries(KEEP).filter(([k]) => k !== "storyFeed"));
        mockDdbSend.mockImplementation((cmd: Cmd) => {
            if (cmd.constructor.name === "QueryCommand") return Promise.resolve({ Items: [KEEP] });
            if (cmd.constructor.name === "TransactWriteCommand") {
                return Promise.reject(Object.assign(new Error("canceled"), { name: "TransactionCanceledException" }));
            }
            if (cmd.constructor.name === "GetCommand") {
                if (reread === "fail") return Promise.reject(Object.assign(new Error("slow"), { name: "ProvisionedThroughputExceededException" }));
                if (reread === "infeed") return Promise.resolve({ Item: KEEP });
                return Promise.resolve(reread === "shelved" ? { Item: { ...shelved, archivedAt: PAST } } : {});
            }
            return Promise.resolve({});
        });
    };
    const warnLine = async () => {
        const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            const r = await cleanupExpiredStories();
            expect(r).toEqual({ deleted: 0, archived: 0 });
            expect(s3Keys()).toEqual([]);
            expect(err.mock.calls.filter((c) => String(c[0]).includes("s-keep")), "失敗として記録している").toEqual([]);
            const line = warn.mock.calls.map((c) => String(c[0])).find((s) => s.includes("s-keep"));
            expect(line, "黙って飛ばしている").toBeTruthy();
            return line as string;
        } finally {
            err.mockRestore();
            warn.mockRestore();
        }
    };

    it("条件が外れた: もう棚に在る → 読み直した行の状態を言う", async () => {
        ccfWorld("shelved");
        const line = await warnLine();
        expect(line, "読んだ時点の行（storyFeed あり）を出している").toContain("storyFeed=false");
        expect(line, "archivedAt が読み取れない").toContain(`archivedAt=${PAST}`);
    });

    it("条件が外れた: 行が消えていた → そう言う", async () => {
        ccfWorld("gone");
        expect(await warnLine()).toContain("row gone");
    });

    it("条件が外れた: 読み直せなかった → 「消された」とは言わない", async () => {
        ccfWorld("fail");
        const line = await warnLine();
        expect(line, "読み直しの失敗を「消された」と言っている").not.toContain("row gone");
        expect(line).toContain("re-read failed");
    });

    it("取り消されたが、読み直すとまだ一覧に載っている（条件は通る形）→ 混雑。失敗として次回に回す", async () => {
        ccfWorld("infeed");
        const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            const r = await cleanupExpiredStories();
            expect(r).toEqual({ deleted: 0, archived: 0 });
            expect(err.mock.calls.some((c) => String(c[0]).includes("s-keep")), "失敗として記録していない（黙って飛ばすと混雑が見えない）").toBe(true);
            expect(warn.mock.calls.some((c) => String(c[0]).includes("s-keep")), "「やることは無い」扱いにしている").toBe(false);
        } finally {
            err.mockRestore();
            warn.mockRestore();
        }
    });

    // Scan の経路（GSI が無い環境）の絞り込みは `stories.test.ts` の
    // 「索引が無い環境のフォールバックでも expiresAt <= now を引く」が
    // **式全体を完全一致**で固定している（括弧が落ちると AND が先に結び、
    // 表の写真・コメント・印の行が全部「期限切れ」として削除の経路に流れる）。
    // ここに弱い写しを重ねない（見張りは1本ずつ）
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

// ────────────────────────────────
// 6. 棚へ移った行に、閲覧者と返信の数を書き戻さない
// ────────────────────────────────
describe("棚へ移った行に書き戻さない（期限を読んでから書くまでの競合）", () => {
    // 期限を見てから書くまでの間（表示名の往復など）に掃除が棚へ移すと、
    // `viewers` を外した行に閲覧者が、消した返信の数が書き戻る——行はもう
    // GSI に無いので掃除は二度と来ない。**書き込みの条件で断つ**
    const OTHER = "22222222-2222-4222-8222-222222222222";
    const live = { id: "story-1", story: true, userId: OTHER, src: "https://cdn.test/s.jpg", expiresAt: FUTURE };
    const world = () => {
        mockDdbSend.mockImplementation((cmd: Cmd) => {
            const id = String((cmd.input.Key as { id?: string } | undefined)?.id ?? "");
            if (cmd.constructor.name === "GetCommand") {
                if (id === "story-1") return Promise.resolve({ Item: live });
                if (id === storyRepliesId("story-1")) return Promise.resolve({ Item: { items: [] } });
                // ストーリーはフォロワーしか見られない。印が無いと返信の門で
                // 404 になり、書き込みの条件を確かめる前に終わる
                if (id === `follow#${OTHER}#${ME}`) return Promise.resolve({ Item: { id } });
                return Promise.resolve({});
            }
            return Promise.resolve({});
        });
    };
    const req = (body?: unknown) => ev(ME, { pathParameters: { id: "story-1" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

    // `viewStory` の2つの更新は `stories.test.ts`（閲覧記録の条件を完全一致で
    // 固定）が見ている。ここに弱い写しを重ねない（見張りは1本ずつ）
    it("postStoryReply の返信の数の更新は、archivedAt の無い行にだけ書く", async () => {
        world();
        expect((await invoke(postStoryReply, req({ text: "いいね" }))).statusCode).toBe(200);
        const count = ofKind("UpdateCommand").find((u) => String(u.input.UpdateExpression).includes("replyCount"));
        expect(count, "返信の数の更新を見つけられない（形が変わった？）").toBeTruthy();
        expect(String(count!.input.ConditionExpression), "棚へ移った行にも書く").toContain("attribute_not_exists(archivedAt)");
    });
});

// ────────────────────────────────
// 7. 印は本人だけのもの
// ────────────────────────────────
describe("getStories: 「アーカイブに自動保存」の印は本人にだけ返す", () => {
    // 見る人に「この投稿は24時間後も本人の手元に残る」と知らせる理由が無い
    // （`keptAs` / `replyCount` と同じ扱い）
    it("他人の行からは archive を落とし、自分の行には残す", async () => {
        const OTHER = "22222222-2222-4222-8222-222222222222";
        mockDdbSend.mockImplementation((cmd: Cmd) => {
            if (cmd.constructor.name === "QueryCommand") {
                return Promise.resolve({ Items: [
                    { id: "mine", userId: ME, createdAt: "1", archive: true },
                    { id: "theirs", userId: OTHER, createdAt: "2", archive: true },
                ] });
            }
            // OTHER はフォローしている（フォローのふるいはここの本題ではない）
            const id = String((cmd.input.Key as { id?: string } | undefined)?.id ?? "");
            return Promise.resolve(id === `follow#${OTHER}#${ME}` ? { Item: { id } } : {});
        });
        const r = await invoke(getStories, ev(ME));
        const items = JSON.parse(r.body) as Array<{ id: string; archive?: boolean }>;
        expect(items.find((i) => i.id === "mine")?.archive, "自分の印まで落としている").toBe(true);
        expect(items.find((i) => i.id === "theirs"), "他人に印を見せている").not.toHaveProperty("archive");
    });
});
