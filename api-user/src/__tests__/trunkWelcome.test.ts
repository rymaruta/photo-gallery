import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * はじめての硬貨（`POST /user/trunk/welcome`・2026-10-18 owner 承認）。
 *
 * DynamoDB は `trunk.test.ts` と同じく**中身を持つ作り物**（rev 条件を本当に通す）。
 * 索引の Query（機能より前の写真があるか）も、入れた行から本当に絞って返す。
 */
type Item = Record<string, unknown>;
const store = vi.hoisted(() => new Map<string, Item>());
const keyOf = (table: string, key: Record<string, unknown>) => `${table}|${String(key.id ?? key.userId)}`;
const fakeSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({
    ddb: { send: fakeSend },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));
const mockListMyPhotos = vi.hoisted(() => vi.fn());
vi.mock("../ddb-photos", () => ({ listMyPhotos: mockListMyPhotos }));
vi.stubEnv("USERS_TABLE", "users-test");

function condHolds(k: string, input: { ConditionExpression?: string; ExpressionAttributeValues?: Item }): boolean {
    const cur = store.get(k);
    const want = input.ExpressionAttributeValues?.[":rev"];
    const cond = input.ConditionExpression ?? "";
    if (!cond) return true;
    return cond.includes("attribute_not_exists(rev)")
        ? !cur || cur.rev === undefined || cur.rev === want
        : cur?.rev === want;
}

const calls: string[] = [];

async function send(cmd: { constructor: { name: string }; input: Record<string, unknown> }) {
    await new Promise((r) => setTimeout(r, 0));
    const name = cmd.constructor.name;
    const input = cmd.input as { TableName: string; Key?: Item; Item?: Item; ConditionExpression?: string; ExpressionAttributeValues?: Item };
    calls.push(`${name}:${input.TableName ?? ""}`);
    if (name === "GetCommand") {
        const v = store.get(keyOf(input.TableName, input.Key!));
        return { Item: v ? structuredClone(v) : undefined };
    }
    if (name === "QueryCommand") {
        const q = cmd.input as { IndexName?: string; KeyConditionExpression?: string; ExpressionAttributeValues: Item; Limit?: number };
        expect(q.IndexName).toBe("userId-createdAt-index");
        expect(q.KeyConditionExpression).toBe("userId = :u AND createdAt < :t");
        const rows = [...store.entries()]
            .filter(([k, v]) => k.startsWith(`${input.TableName}|`)
                && v.userId === q.ExpressionAttributeValues[":u"]
                && typeof v.createdAt === "string" && v.createdAt < String(q.ExpressionAttributeValues[":t"]))
            .map(([, v]) => ({ id: v.id }));
        return { Items: rows.slice(0, q.Limit ?? rows.length) };
    }
    if (name === "TransactWriteCommand") {
        const items = (cmd.input as { TransactItems: { Put?: typeof input; ConditionCheck?: typeof input }[] }).TransactItems;
        const keyed = items.map((t) => {
            const op = (t.Put ?? t.ConditionCheck)!;
            return { op, put: !!t.Put, k: keyOf(op.TableName, (t.Put ? op.Item : op.Key)!) };
        });
        if (keyed.some(({ k, op }) => !condHolds(k, op))) {
            throw Object.assign(new Error("tx"), { name: "TransactionCanceledException", CancellationReasons: [{ Code: "ConditionalCheckFailed" }] });
        }
        for (const { k, op, put } of keyed) if (put) store.set(k, structuredClone(op.Item!));
        return {};
    }
    throw new Error(`想定外の命令 ${name}`);
}

const T = await import("../trunk");
const { handler, trunkId, trunkLedgerId, grantLabel, TRUNK_COINS_LAUNCHED_AT, WELCOME_COINS } = T;
import type { Photo } from "../types";

const UID = "user-1234";
const BEFORE = "2026-09-01T00:00:00.000Z";
const AFTER = "2026-10-18T03:00:00.000Z";

function setProfile(p: Item) { store.set(`users-test|${UID}`, { userId: UID, ...p }); }
function setTrunk(t: Item) { store.set(`photos-test|${trunkId(UID)}`, { id: trunkId(UID), uid: UID, rev: 1, ...t }); }
function setPhoto(id: string, createdAt: string) {
    store.set(`photos-test|${id}`, { id, userId: UID, src: `https://cdn.example.com/${id}.webp`, published: true, createdAt });
}
const trunkRow = () => store.get(`photos-test|${trunkId(UID)}`) as Item | undefined;
const ledgerRow = () => store.get(`photos-test|${trunkLedgerId(UID)}`) as Item | undefined;

type Res = { statusCode: number; body: string };
async function welcome(sub: string | null = UID, extra: Record<string, unknown> = {}): Promise<{ status: number; json: Record<string, unknown> }> {
    const ev = {
        routeKey: "POST /user/trunk/welcome",
        requestContext: { authorizer: { jwt: { claims: sub ? { sub, ...extra } : {} } }, http: { method: "POST" } },
    };
    const res = await (handler as unknown as (e: unknown) => Promise<Res>)(ev);
    return { status: res.statusCode, json: JSON.parse(res.body) };
}

beforeEach(() => {
    store.clear();
    calls.length = 0;
    fakeSend.mockReset().mockImplementation(send);
    mockListMyPhotos.mockReset().mockResolvedValue([]);
});

describe("はじめての硬貨（POST /user/trunk/welcome）", () => {
    it("線の値: 硬貨を本番に出した Deploy API（run 39079109521）の完了時刻", () => {
        expect(TRUNK_COINS_LAUNCHED_AT).toBe("2026-10-17T23:32:10.000Z");
        expect(WELCOME_COINS).toBe(10);
    });

    it("対象（機能より前に登録）: トランクの行が無くても作って10枚。応答は { granted, added, coins } だけ", async () => {
        setProfile({ createdAt: BEFORE });
        const r = await welcome();
        expect(r.status).toBe(200);
        expect(r.json).toEqual({ granted: true, added: 10, coins: 10 });
        expect(trunkRow()?.coins).toBe(10);
        expect(typeof trunkRow()?.welcomeCoinsAt).toBe("string");
        expect(trunkRow()?.welcomeCoinsAdded).toBe(10);
        // 写真の索引に出ない（userId を持たない）
        expect(trunkRow()?.userId).toBeUndefined();
        // 前に登録した人は索引を引かない
        expect(calls.filter((c) => c.startsWith("QueryCommand"))).toHaveLength(0);
    });

    it("持っている硬貨に足す", async () => {
        setProfile({ createdAt: BEFORE });
        setTrunk({ coins: 3 });
        expect((await welcome()).json).toEqual({ granted: true, added: 10, coins: 13 });
    });

    it("二度目は配らない（granted: false・エラーにしない）。トランクの2行だけ読み、users も索引も読まない", async () => {
        setProfile({ createdAt: BEFORE });
        await welcome();
        calls.length = 0;
        const r = await welcome();
        expect(r.status).toBe(200);
        expect(r.json).toEqual({ granted: false, added: 0, coins: 10 });
        expect(calls).toEqual(["GetCommand:photos-test", "GetCommand:photos-test"]);
        expect(trunkRow()?.coins).toBe(10);
    });

    it("硬貨を使ったあとでも配り直さない", async () => {
        setProfile({ createdAt: BEFORE });
        await welcome();
        setTrunk({ ...trunkRow(), coins: 0, rev: Number(trunkRow()?.rev) + 1 });
        expect((await welcome()).json).toEqual({ granted: false, added: 0, coins: 0 });
    });

    it("並んだ2本でも1回だけ（rev の競合で読み直して印を見る）", async () => {
        setProfile({ createdAt: BEFORE });
        const rs = await Promise.all([welcome(), welcome()]);
        expect(rs.map((r) => r.json.granted).sort()).toEqual([false, true]);
        expect(trunkRow()?.coins).toBe(10);
        // どちらも同じ枚数を返す（遅れた方は今の枚数）
        expect(rs.map((r) => r.json.coins)).toEqual([10, 10]);
    });

    it("並んだ3本でも10枚", async () => {
        setProfile({ createdAt: BEFORE });
        const rs = await Promise.all(Array.from({ length: 3 }, () => welcome()));
        expect(rs.filter((r) => r.json.granted === true)).toHaveLength(1);
        expect(trunkRow()?.coins).toBe(10);
    });

    it("投稿の硬貨と同時でも、どちらも残る（11枚）", async () => {
        setProfile({ createdAt: BEFORE });
        const photo = { id: "p1", src: "https://cdn.example.com/p1.webp", userId: UID, published: true, createdAt: AFTER } as Photo;
        const [w, g] = await Promise.all([welcome(), grantLabel(UID, photo)]);
        expect(w.json.granted).toBe(true);
        expect(g.coin).toBe(1);
        expect(trunkRow()?.coins).toBe(11);
    });

    it("上限 99 を超えない: 95 枚なら4枚だけ足す", async () => {
        setProfile({ createdAt: BEFORE });
        setTrunk({ coins: 95 });
        expect((await welcome()).json).toEqual({ granted: true, added: 4, coins: 99 });
        expect(trunkRow()?.welcomeCoinsAdded).toBe(4);
    });

    it("99 枚なら足せない（granted: false・added: 0）。印は残し、あとで空いても配り直さない", async () => {
        setProfile({ createdAt: BEFORE });
        setTrunk({ coins: 99 });
        expect((await welcome()).json).toEqual({ granted: false, added: 0, coins: 99 });
        expect(typeof trunkRow()?.welcomeCoinsAt).toBe("string");
        setTrunk({ ...trunkRow(), coins: 50, rev: Number(trunkRow()?.rev) + 1 });
        expect((await welcome()).json).toEqual({ granted: false, added: 0, coins: 50 });
    });

    it("対象外（機能より後に登録・前からの写真なし）: 配らず、対象外の印を残す。2回目は読むだけ", async () => {
        setProfile({ createdAt: AFTER });
        setPhoto("new1", AFTER);
        const r = await welcome();
        expect(r.json).toEqual({ granted: false, added: 0, coins: 0 });
        expect(typeof trunkRow()?.welcomeCheckedAt).toBe("string");
        expect(trunkRow()?.welcomeCoinsAt).toBeUndefined();
        expect(trunkRow()?.coins).toBe(0);
        calls.length = 0;
        expect((await welcome()).json).toEqual({ granted: false, added: 0, coins: 0 });
        expect(calls).toEqual(["GetCommand:photos-test", "GetCommand:photos-test"]);
    });

    it("ちょうど線の時刻に登録した人は対象外（線より前だけ）", async () => {
        setProfile({ createdAt: TRUNK_COINS_LAUNCHED_AT });
        expect((await welcome()).json.granted).toBe(false);
        expect(typeof trunkRow()?.welcomeCheckedAt).toBe("string");
    });

    it("行の作成が機能より後でも、機能より前の写真があれば対象（トリガーが落ちて後から行ができた人）", async () => {
        setProfile({ createdAt: AFTER });
        setPhoto("old1", BEFORE);
        expect((await welcome()).json).toEqual({ granted: true, added: 10, coins: 10 });
    });

    it("登録時刻が取れない（行に createdAt が無い）: 前の写真があれば対象", async () => {
        setProfile({ displayName: "古い人" });
        setPhoto("old1", BEFORE);
        expect((await welcome()).json).toEqual({ granted: true, added: 10, coins: 10 });
    });

    it("行はあるが createdAt が無い（2026-08-19 より前の古い利用者）: 前の写真が無くても対象・索引は引かない", async () => {
        setProfile({ displayName: "古い人" });
        expect((await welcome()).json).toEqual({ granted: true, added: 10, coins: 10 });
        expect(calls.filter((c) => c.startsWith("QueryCommand"))).toHaveLength(0);
    });

    it("プロフィールの行が無い・前の写真も無い: 配らない・何も書かない", async () => {
        expect((await welcome()).json).toEqual({ granted: false, added: 0, coins: 0 });
        expect(trunkRow()).toBeUndefined();
    });

    it("プロフィールの行が無くても、前の写真があれば対象", async () => {
        setPhoto("old1", BEFORE);
        expect((await welcome()).json.granted).toBe(true);
    });

    it("登録の時刻が壊れている（読めない文字）: createdAt が無い行と同じく対象", async () => {
        setProfile({ createdAt: "きのう" });
        expect((await welcome()).json.granted).toBe(true);
    });

    describe("JWT の auth_time（最初のサインインの時刻）", () => {
        const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

        it("前から居るのに、開いた瞬間に行が今の時刻で作られた人: auth_time が線より前なら対象・索引は引かない", async () => {
            setProfile({ createdAt: AFTER });
            // API Gateway（HTTP API）は数の claim を文字にして渡す
            expect((await welcome(UID, { auth_time: String(sec(BEFORE)) })).json).toEqual({ granted: true, added: 10, coins: 10 });
            expect(calls.filter((c) => c.startsWith("QueryCommand"))).toHaveLength(0);
        });

        it("数のままでも読む", async () => {
            setProfile({ createdAt: AFTER });
            expect((await welcome(UID, { auth_time: sec(BEFORE) })).json.granted).toBe(true);
        });

        it("行が無くても auth_time が線より前なら対象", async () => {
            expect((await welcome(UID, { auth_time: String(sec(BEFORE)) })).json.granted).toBe(true);
        });

        it("auth_time が線より後・行も後・前の写真なし: 対象外（印を残す）", async () => {
            setProfile({ createdAt: AFTER });
            expect((await welcome(UID, { auth_time: String(sec(AFTER)) })).json.granted).toBe(false);
            expect(typeof trunkRow()?.welcomeCheckedAt).toBe("string");
        });

        it("行が無く auth_time が線より後・前の写真なし: 対象外（印を残す）", async () => {
            expect((await welcome(UID, { auth_time: String(sec(AFTER)) })).json.granted).toBe(false);
            expect(typeof trunkRow()?.welcomeCheckedAt).toBe("string");
        });

        it("行が無く auth_time が読めない: 決められない（印を残さない）", async () => {
            expect((await welcome(UID, { auth_time: "abc" })).json.granted).toBe(false);
            expect(trunkRow()).toBeUndefined();
        });

        it("auth_time が後でも、前の写真があれば対象", async () => {
            setProfile({ createdAt: AFTER });
            setPhoto("old1", BEFORE);
            expect((await welcome(UID, { auth_time: String(sec(AFTER)) })).json.granted).toBe(true);
        });

        it("authTimeMsOf: 秒をミリ秒に・文字も読む・負や小数・空は読まない", () => {
            expect(T.authTimeMsOf(1700000000)).toBe(1700000000000);
            expect(T.authTimeMsOf("1700000000")).toBe(1700000000000);
            expect(T.authTimeMsOf("")).toBeUndefined();
            expect(T.authTimeMsOf("-5")).toBeUndefined();
            expect(T.authTimeMsOf(undefined)).toBeUndefined();
            expect(T.authTimeMsOf(0)).toBeUndefined();
        });
    });

    it("退会の墓石の行: 配らない・何も書かない・索引も引かない", async () => {
        setProfile({ deletedAt: AFTER, createdAt: BEFORE });
        setPhoto("old1", BEFORE);
        expect((await welcome()).json.granted).toBe(false);
        expect(trunkRow()).toBeUndefined();
        expect(calls.filter((c) => c.startsWith("QueryCommand"))).toHaveLength(0);
    });

    it("他の人の前の写真は数えない（JWT の sub の人の行だけ）", async () => {
        setProfile({ createdAt: AFTER });
        store.set("photos-test|other1", { id: "other1", userId: "someone-else", createdAt: BEFORE });
        expect((await welcome()).json.granted).toBe(false);
    });

    it("認証が無ければ 401（何も読まない）", async () => {
        const r = await welcome(null);
        expect(r.status).toBe(401);
        expect(calls).toHaveLength(0);
    });

    it("印は trunk# の行に置く（退会で trunk# を消すと一緒に消える）・GET には出さない", async () => {
        setProfile({ createdAt: BEFORE });
        await welcome();
        expect(trunkRow()?.welcomeCoinsAt).toBeDefined();
        expect(ledgerRow()?.welcomeCoinsAt).toBeUndefined();
        const res = await (handler as unknown as (e: unknown) => Promise<Res>)({
            routeKey: "GET /user/trunk",
            requestContext: { authorizer: { jwt: { claims: { sub: UID } } }, http: { method: "GET" } },
        });
        const body = JSON.parse(res.body);
        expect(body.coins).toBe(10);
        expect(body.welcomeCoinsAt).toBeUndefined();
    });

    it("ほかの書き込み（型を選ぶ）で印が消えない", async () => {
        setProfile({ createdAt: BEFORE });
        await welcome();
        await (handler as unknown as (e: unknown) => Promise<Res>)({
            routeKey: "PUT /user/trunk/model",
            body: JSON.stringify({ model: "canvas" }),
            requestContext: { authorizer: { jwt: { claims: { sub: UID } } }, http: { method: "PUT" } },
        });
        expect(trunkRow()?.model).toBe("canvas");
        expect(trunkRow()?.welcomeCoinsAt).toBeDefined();
        expect((await welcome()).json.granted).toBe(false);
    });
});
