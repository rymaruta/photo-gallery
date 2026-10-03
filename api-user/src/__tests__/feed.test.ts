import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("../dynamodb", () => ({
    ddb: { send: vi.fn() },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
    STORY_INDEX: "storyFeed-expiresAt-index",
    STORY_FEED_KEY: "1",
}));

const { getFeed, encodeCursor, decodeCursor, parseLimit, MAX_ROUNDS, MAX_LIMIT, DEFAULT_LIMIT } = await import("../feed");
const { ddb } = await import("../dynamodb");
const { PUBLIC_INDEX, PUBLIC_FEED_KEY, RESTRICTED_FEED_KEY } = await import("../publicFeed");

/**
 * **本物の索引のふるまいを真似る小さな偽物。**
 *
 * `rows` を「索引の仕切り "1" に createdAt の新しい順で並んでいる行」とみなし、
 * `Limit` と `ExclusiveStartKey` を DynamoDB と同じ意味で解く:
 *   - ExclusiveStartKey の id の**次の行から**読む
 *   - Limit 件読んだら止め、まだ後ろがあれば最後に読んだ行のキーを LastEvaluatedKey に返す
 *     （後ろが無くても Limit ちょうどで止まったら返す——DynamoDB も返しうる）
 *   - **Limit はふるう前に効く**（偽物は何もふるわない。ふるうのは feed.ts）
 */
let rows: Record<string, unknown>[] = [];
let users: Record<string, Record<string, unknown>> = {};
let queries: Record<string, unknown>[] = [];

function wire(): void {
    (ddb.send as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: { input: Record<string, unknown> }) => {
        const input = cmd.input;
        if (input.KeyConditionExpression) {
            queries.push(input);
            expect(input.IndexName).toBe(PUBLIC_INDEX);
            expect((input.ExpressionAttributeValues as Record<string, unknown>)[":k"]).toBe(PUBLIC_FEED_KEY);
            const start = input.ExclusiveStartKey as { id: string; publicFeed: string } | undefined;
            if (start) expect(start.publicFeed, "仕切りの外から読ませている").toBe(PUBLIC_FEED_KEY);
            let from = 0;
            if (start) from = rows.findIndex((r) => r.id === start.id) + 1;
            const limit = Number(input.Limit);
            const slice = rows.slice(from, from + limit);
            const last = slice[slice.length - 1];
            const more = from + slice.length < rows.length || slice.length === limit;
            return {
                Items: slice.map((r) => ({ ...r })),
                LastEvaluatedKey: more && last
                    ? { id: last.id, createdAt: last.createdAt, publicFeed: PUBLIC_FEED_KEY }
                    : undefined,
            };
        }
        if (input.TableName === process.env.USERS_TABLE) {
            const uid = (input.Key as { userId: string }).userId;
            if (uid === "broken-user") throw Object.assign(new Error("boom"), { name: "ProvisionedThroughputExceededException" });
            return { Item: users[uid] };
        }
        return {};
    });
}

const at = (i: number) => new Date(Date.UTC(2026, 8, 30) - i * 60_000).toISOString();
const photo = (i: number, extra: Record<string, unknown> = {}) => ({
    id: `p${String(i).padStart(3, "0")}`,
    src: `https://journey-photo.com/uploads/${i}.jpg`,
    createdAt: at(i),
    publicFeed: PUBLIC_FEED_KEY,
    userId: "u1",
    displayName: "旧い名前",
    ...extra,
});

type Body = { items: Record<string, unknown>[]; nextCursor: string | null };
async function call(params: Record<string, string> = {}): Promise<{ statusCode: number; body: Body; headers: Record<string, string> }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (getFeed as any)({ queryStringParameters: params });
    return { statusCode: res.statusCode, body: JSON.parse(res.body), headers: res.headers };
}

/** カーソルを辿って全部読む（呼び出し回数の上限つき） */
async function readAll(limit: string): Promise<{ ids: string[]; pages: number }> {
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
        const res = await call(cursor ? { limit, cursor } : { limit });
        expect(res.statusCode).toBe(200);
        ids.push(...res.body.items.map((p) => String(p.id)));
        cursor = res.body.nextCursor;
        pages++;
        expect(pages, "カーソルが終わらない").toBeLessThan(100);
    } while (cursor);
    return { ids, pages };
}

beforeEach(() => {
    rows = [];
    users = { u1: { userId: "u1", displayName: "いまの名前" } };
    queries = [];
    wire();
});

describe("GET /feed: ページの区切り", () => {
    it("limit 件ずつ新しい順に返し、続きがあれば nextCursor を付ける", async () => {
        rows = Array.from({ length: 5 }, (_, i) => photo(i));
        const first = await call({ limit: "2" });
        expect(first.statusCode).toBe(200);
        expect(first.body.items.map((p) => p.id)).toEqual(["p000", "p001"]);
        expect(first.body.nextCursor).toEqual(expect.any(String));
    });

    it("カーソルを辿ると、全件をちょうど1回ずつ、順番どおりに読める", async () => {
        rows = Array.from({ length: 7 }, (_, i) => photo(i));
        const { ids } = await readAll("3");
        expect(ids).toEqual(rows.map((r) => r.id));
    });

    it("最後のページは nextCursor が null", async () => {
        rows = Array.from({ length: 2 }, (_, i) => photo(i));
        const res = await call({ limit: "5" });
        expect(res.body.items).toHaveLength(2);
        expect(res.body.nextCursor).toBeNull();
    });

    it("limit を省くと既定、上限を超えたら上限で読む", async () => {
        rows = Array.from({ length: 100 }, (_, i) => photo(i));
        expect((await call()).body.items).toHaveLength(DEFAULT_LIMIT);
        expect((await call({ limit: "999" })).body.items).toHaveLength(MAX_LIMIT);
        expect(DEFAULT_LIMIT).toBe(30);
        expect(MAX_LIMIT).toBe(60);
    });

    it.each(["0", "-1", "abc", "1.5", "1e2"])("limit=%s は 400", async (limit) => {
        const res = await call({ limit });
        expect(res.statusCode).toBe(400);
        expect(queries).toHaveLength(0);
    });

    it("索引の新しい順（ScanIndexForward: false）で引く", async () => {
        rows = [photo(0)];
        await call();
        expect(queries[0].ScanIndexForward).toBe(false);
    });

    it("共有キャッシュに載せてよい答え（誰が来ても同じ）", async () => {
        rows = [photo(0)];
        expect((await call()).headers["Cache-Control"]).toBe("public, s-maxage=30");
    });
});

describe("GET /feed: カーソル", () => {
    it("往復する（encode → decode で索引のキーに戻る）", () => {
        const key = { id: "a129394d-f386-4795-9623-2d6e915d20c7", createdAt: "2026-04-29T13:25:07.841Z", publicFeed: PUBLIC_FEED_KEY };
        const c = encodeCursor(key);
        expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(decodeCursor(c)).toEqual(key);
    });

    /// **仕切りはカーソルから読まない。** 書き換えて "restricted" を引かせない
    it("カーソルに仕切りの値は入らず、読むときは必ず公開の仕切りに戻す", () => {
        const c = encodeCursor({ id: "p1", createdAt: at(1), publicFeed: RESTRICTED_FEED_KEY });
        expect(Buffer.from(c, "base64url").toString("utf8")).not.toContain(RESTRICTED_FEED_KEY);
        expect(decodeCursor(c)?.publicFeed).toBe(PUBLIC_FEED_KEY);
    });

    const b64 = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v), "utf8").toString("base64url");
    it.each([
        ["base64url でない文字", "abc$%"],
        ["JSON でない", b64("not json")],
        ["配列", b64([1, 2])],
        ["版が違う", b64({ v: 2, id: "p1", createdAt: at(1) })],
        ["鍵が足りない", b64({ v: 1, id: "p1" })],
        ["余計な鍵（仕切りを差し込む）", b64({ v: 1, id: "p1", createdAt: at(1), publicFeed: "restricted" })],
        ["id が文字列でない", b64({ v: 1, id: 1, createdAt: at(1) })],
        ["id に # （写真以外の文書）", b64({ v: 1, id: "notifs#u1", createdAt: at(1) })],
        ["createdAt が日時でない", b64({ v: 1, id: "p1", createdAt: "yesterday" })],
        ["長すぎる", "A".repeat(600)],
    ])("壊れた・書き換えたカーソルは 400（%s）", async (_label, cursor) => {
        expect(decodeCursor(cursor)).toBeNull();
        const res = await call({ cursor });
        expect(res.statusCode).toBe(400);
        expect(queries, "壊れたカーソルで索引を読んでいる").toHaveLength(0);
    });

    it("空のカーソルも 400", async () => {
        expect((await call({ cursor: "" })).statusCode).toBe(400);
    });

    it("parseLimit の境界", () => {
        expect(parseLimit(undefined)).toBe(30);
        expect(parseLimit("1")).toBe(1);
        expect(parseLimit("60")).toBe(60);
        expect(parseLimit("61")).toBe(60);
        expect(parseLimit("0")).toBeNull();
    });
});

describe("GET /feed: 返さないもの", () => {
    it.each([
        ["非公開（published: false）", { published: false }],
        ["ストーリー", { story: true }],
        ["フォロワーのみ", { audience: "followers" }],
        ["親しい友達", { audience: "closeFriends" }],
        ["知らない公開範囲の値", { audience: "someday" }],
        ["写真でない行（src が無い）", { src: undefined }],
    ])("%s は返さない", async (_label, extra) => {
        rows = [photo(0), photo(1, extra), photo(2)];
        const res = await call();
        expect(res.body.items.map((p) => p.id)).toEqual(["p000", "p002"]);
    });

    it("published を持たない古い行は公開として返す（静的一覧と同じ規則）", async () => {
        const old = photo(0);
        delete (old as Record<string, unknown>).published;
        rows = [old];
        expect((await call()).body.items).toHaveLength(1);
    });

    /// `photos.json` と同じ項目。sync の `PRIVATE_FIELDS` を全部落とす
    it.each(["srcOriginal", "key", "staticStale", "commentCount", "publicFeed", "keptFrom"])(
        "応答に %s を出さない", async (field) => {
            rows = [photo(0, {
                srcOriginal: "https://journey-photo.com/uploads/originals/0.jpg",
                key: "uploads/u1/0.jpg", staticStale: true, commentCount: 3, keptFrom: "story-1",
            })];
            const res = await call();
            expect(res.body.items[0], `${field} が残っている`).not.toHaveProperty(field);
            expect(res.body.items[0].src).toBe(rows[0].src);
        });
});

describe("GET /feed: ふるいで足りないとき続きを読む", () => {
    it("非公開が混ざって limit に届かなければ、続きを読んで limit 件そろえる", async () => {
        rows = [
            photo(0), photo(1, { published: false }), photo(2, { story: true }),
            photo(3), photo(4, { audience: "followers" }), photo(5), photo(6), photo(7),
        ];
        const res = await call({ limit: "3" });
        expect(res.body.items.map((p) => p.id)).toEqual(["p000", "p003", "p005"]);
        expect(queries.length, "1回で諦めている").toBeGreaterThan(1);
        // 2回目以降は「あと何枚要るか」だけ読む（多めに読んで捨てると、捨てた行が次のページから抜ける）
        expect(queries.map((q) => q.Limit)).toEqual([3, 2, 1]);
        expect(res.body.nextCursor).toEqual(expect.any(String));
    });

    it("ふるいが混ざっていても、カーソルを辿れば公開写真を漏れなく1回ずつ読める", async () => {
        rows = Array.from({ length: 23 }, (_, i) => photo(i, i % 3 === 1 ? { published: false } : {}));
        const { ids } = await readAll("4");
        expect(ids).toEqual(rows.filter((r) => r.published !== false).map((r) => r.id));
    });

    it("落ちる行が続いても、Query は MAX_ROUNDS 回で打ち切り、続きは nextCursor で返す", async () => {
        rows = [
            ...Array.from({ length: 40 }, (_, i) => photo(i, { published: false })),
            photo(40), photo(41),
        ];
        const res = await call({ limit: "2" });
        expect(queries).toHaveLength(MAX_ROUNDS);
        expect(res.body.items.length).toBeLessThan(2);
        expect(res.body.nextCursor, "打ち切った回に続きを失っている").toEqual(expect.any(String));
        const { ids } = await readAll("2");
        expect(ids).toEqual(["p040", "p041"]);
    });
});

describe("GET /feed: 表示名はいまの名前", () => {
    it("users テーブルの今の名前に差し替える", async () => {
        rows = [photo(0)];
        expect((await call()).body.items[0].displayName).toBe("いまの名前");
    });

    it("退会した人・行が無い人・読めなかった人は写真の値のまま", async () => {
        users.u2 = { userId: "u2", displayName: "退会者", deletedAt: "2026-09-01T00:00:00Z" };
        rows = [photo(0, { userId: "u2" }), photo(1, { userId: "nobody" }), photo(2, { userId: "broken-user" })];
        const res = await call();
        expect(res.statusCode).toBe(200);
        expect(res.body.items.map((p) => p.displayName)).toEqual(["旧い名前", "旧い名前", "旧い名前"]);
    });

    it("名前を消した人は displayName を持たない", async () => {
        users.u1 = { userId: "u1", displayName: "  " };
        rows = [photo(0)];
        expect((await call()).body.items[0]).not.toHaveProperty("displayName");
    });
});

describe("GET /feed: 失敗", () => {
    it("索引の読み取りが落ちたら 500（中身は出さない）", async () => {
        (ddb.send as ReturnType<typeof vi.fn>).mockRejectedValue(
            Object.assign(new Error("The table does not have the specified index"), { name: "ValidationException" }));
        const res = await call();
        expect(res.statusCode).toBe(500);
        expect(JSON.stringify(res.body)).not.toContain("index");
    });
});

describe("GET /feed: 配線", () => {
    const yml = readFileSync("api-user/serverless.yml", "utf8");

    it("serverless.yml に未認証の GET /feed として載っている", () => {
        const block = /^ {2}getFeed:\n([\s\S]*?)(?=^ {2}\S|^\S)/m.exec(yml)?.[1] ?? "";
        expect(block).toContain("handler: src/feed.getFeed");
        expect(block).toMatch(/path: \/feed\n\s+method: GET/);
        expect(block).not.toContain("authorizer:");
        expect(block).toMatch(/^\s{4}role: PublicReadRole\s*$/m);
    });

    /// 索引名を yml にも書いているので、`publicFeed.ts` とずれたら Query が AccessDenied で全滅する
    it("読み取り専用ロールに、この索引の Query だけを足している", () => {
        expect(yml).toContain(`table/\${param:photosTable}/index/${PUBLIC_INDEX}`);
        const role = yml.split(/\n {4}PublicReadRole:\n/)[1]?.split(/\n {4}\w+:\n/)[0] ?? "";
        expect(role).toContain("dynamodb:Query");
        expect(role, "索引を名指しせず全部に開けている").not.toMatch(/photosTable\}\/index\/\*/);
    });
});
