import { describe, it, expect, vi, beforeEach } from "vitest";
import { handler, trunkId, parseTrunk, rewardInto, REWARD_COINS, COINS_MAX } from "../trunk";

/**
 * アイコン・カバーを初めて設定したお礼（`POST /user/trunk/reward`・#304・2026-10-18）。
 *
 * DynamoDB は `trunkWelcome.test.ts` と同じ**中身を持つ作り物**（rev 条件を本当に通す）。
 * S3 の実体の有無（`profileImage.ts`）は差し替える。
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
const images = vi.hoisted(() => new Set<string>());
const mockExists = vi.hoisted(() => vi.fn());
vi.mock("../profileImage", () => ({ profileImageExists: mockExists }));
// trunk.ts は読み込んだときに USERS_TABLE を読む（静的な import より前に入れる）
vi.hoisted(() => { process.env.USERS_TABLE = "users-test"; });

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
const usersReads: Item[] = [];

async function send(cmd: { constructor: { name: string }; input: Record<string, unknown> }) {
    await new Promise((r) => setTimeout(r, 0));
    const name = cmd.constructor.name;
    const input = cmd.input as { TableName: string; Key?: Item; Item?: Item; ConditionExpression?: string; ExpressionAttributeValues?: Item };
    calls.push(`${name}:${input.TableName ?? ""}`);
    if (name === "GetCommand") {
        if (input.TableName === "users-test") usersReads.push(cmd.input);
        const v = store.get(keyOf(input.TableName, input.Key!));
        return { Item: v ? structuredClone(v) : undefined };
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


const UID = "user-1234";
function setProfile(p: Item = {}) { store.set(`users-test|${UID}`, { userId: UID, createdAt: "2026-10-18T00:00:00.000Z", ...p }); }
function setTrunk(t: Item) { store.set(`photos-test|${trunkId(UID)}`, { id: trunkId(UID), uid: UID, rev: 1, ...t }); }
const trunkRow = () => store.get(`photos-test|${trunkId(UID)}`) as Item | undefined;

type Res = { statusCode: number; body: string };
async function reward(kind: unknown, sub: string | null = UID): Promise<{ status: number; json: Record<string, unknown> }> {
    const ev = {
        routeKey: "POST /user/trunk/reward",
        body: JSON.stringify({ kind }),
        requestContext: { authorizer: { jwt: { claims: sub ? { sub } : {} } }, http: { method: "POST" } },
    };
    const res = await (handler as unknown as (e: unknown) => Promise<Res>)(ev);
    return { status: res.statusCode, json: JSON.parse(res.body) };
}

beforeEach(() => {
    store.clear();
    images.clear();
    calls.length = 0;
    usersReads.length = 0;
    fakeSend.mockReset().mockImplementation(send);
    mockListMyPhotos.mockReset().mockResolvedValue([]);
    mockExists.mockReset().mockImplementation(async (uid: string, kind: string) => images.has(`${uid}:${kind}`));
});

describe("アイコン・カバーのお礼（POST /user/trunk/reward）", () => {
    it("枚数は3（owner「3枚ずつ」）", () => {
        expect(REWARD_COINS).toBe(3);
    });

    it("アイコンを設定した人: トランクの行が無くても作って3枚。応答は { granted, added, coins, rewarded } だけ・印は trunk# の行", async () => {
        setProfile();
        images.add(`${UID}:avatar`);
        const r = await reward("avatar");
        expect(r.status).toBe(200);
        expect(r.json).toEqual({ granted: true, added: 3, coins: 3, rewarded: true });
        expect(trunkRow()?.coins).toBe(3);
        expect(typeof trunkRow()?.rewardAvatarAt).toBe("string");
        expect(trunkRow()?.rewardAvatarAdded).toBe(3);
        expect(trunkRow()?.rewardCoverAt).toBeUndefined();
    });

    it("users の行は強い読み（ConsistentRead）で読む", async () => {
        setProfile();
        images.add(`${UID}:cover`);
        await reward("cover");
        expect(usersReads).toHaveLength(1);
        expect(usersReads[0].ConsistentRead).toBe(true);
        expect(mockExists).toHaveBeenCalledWith(UID, "cover");
    });

    it("アイコンとカバーは別々に1回ずつ（両方で +6）", async () => {
        setProfile();
        images.add(`${UID}:avatar`);
        images.add(`${UID}:cover`);
        expect((await reward("avatar")).json).toEqual({ granted: true, added: 3, coins: 3, rewarded: true });
        expect((await reward("cover")).json).toEqual({ granted: true, added: 3, coins: 6, rewarded: true });
        expect(trunkRow()?.coins).toBe(6);
    });

    it("二度目は配らない。2回目はトランクの2行だけ読み、users も S3 も読まない", async () => {
        setProfile();
        images.add(`${UID}:avatar`);
        await reward("avatar");
        calls.length = 0;
        mockExists.mockClear();
        const r = await reward("avatar");
        expect(r.status).toBe(200);
        expect(r.json).toEqual({ granted: false, added: 0, coins: 3, rewarded: true });
        expect(calls).toEqual(["GetCommand:photos-test", "GetCommand:photos-test"]);
        expect(mockExists).not.toHaveBeenCalled();
    });

    it("消して付け直しても、もう一度はもらえない（硬貨を使ったあとでも）", async () => {
        setProfile();
        images.add(`${UID}:avatar`);
        await reward("avatar");
        setTrunk({ ...trunkRow(), coins: 0 });
        images.delete(`${UID}:avatar`);
        expect((await reward("avatar")).json).toEqual({ granted: false, added: 0, coins: 0, rewarded: true });
        images.add(`${UID}:avatar`);
        expect((await reward("avatar")).json).toEqual({ granted: false, added: 0, coins: 0, rewarded: true });
        expect(trunkRow()?.coins).toBe(0);
    });

    it("まだ設定していない: 配らず、印も立てない（設定したあとの呼び出しで渡せる）", async () => {
        setProfile();
        expect((await reward("cover")).json).toEqual({ granted: false, added: 0, coins: 0, rewarded: false });
        expect(trunkRow()).toBeUndefined();
        images.add(`${UID}:cover`);
        expect((await reward("cover")).json).toEqual({ granted: true, added: 3, coins: 3, rewarded: true });
    });

    it("上限 99 を超える分は配らない。0 枚でも印は立てる（あとで空いても配り直さない）", async () => {
        setProfile();
        images.add(`${UID}:avatar`);
        images.add(`${UID}:cover`);
        setTrunk({ coins: 98 });
        expect((await reward("avatar")).json).toEqual({ granted: true, added: 1, coins: COINS_MAX, rewarded: true });
        expect(trunkRow()?.rewardAvatarAdded).toBe(1);
        expect((await reward("cover")).json).toEqual({ granted: false, added: 0, coins: COINS_MAX, rewarded: true });
        expect(typeof trunkRow()?.rewardCoverAt).toBe("string");
        expect(trunkRow()?.rewardCoverAdded).toBe(0);
        setTrunk({ ...trunkRow(), coins: 10 });
        expect((await reward("cover")).json).toEqual({ granted: false, added: 0, coins: 10, rewarded: true });
    });

    it("退会の墓石には配らない", async () => {
        setProfile({ deletedAt: "2026-10-18T01:00:00.000Z" });
        images.add(`${UID}:avatar`);
        expect((await reward("avatar")).json).toEqual({ granted: false, added: 0, coins: 0, rewarded: false });
        expect(trunkRow()).toBeUndefined();
    });

    it("並んだ2本でも1回だけ（rev 条件）", async () => {
        setProfile();
        images.add(`${UID}:avatar`);
        const [a, b] = await Promise.all([reward("avatar"), reward("avatar")]);
        expect([a.json.added, b.json.added].sort()).toEqual([0, 3]);
        expect(trunkRow()?.coins).toBe(3);
    });

    it("ほかの持ち物（はじめての硬貨の印・部品）を消さない", async () => {
        setProfile();
        images.add(`${UID}:cover`);
        setTrunk({ coins: 12, parts: ["pin.1"], welcomeCoinsAt: "2026-10-18T00:00:00.000Z", welcomeCoinsAdded: 10 });
        await reward("cover");
        const doc = parseTrunk(trunkRow());
        expect(doc.coins).toBe(15);
        expect(doc.parts).toEqual(["pin.1"]);
        expect(doc.welcomeCoinsAt).toBe("2026-10-18T00:00:00.000Z");
        expect(doc.welcomeCoinsAdded).toBe(10);
    });

    it("kind が違えば 400 badKind（何も読まない）", async () => {
        for (const k of ["badge", undefined, 3]) {
            const r = await reward(k);
            expect(r.status).toBe(400);
            expect(r.json.code).toBe("badKind");
        }
        expect(calls).toHaveLength(0);
    });

    it("rewarded: まだ設定していない回だけ false（アプリは false の間、起動のときに確かめ直す）", async () => {
        setProfile();
        expect((await reward("avatar")).json.rewarded).toBe(false);
        images.add(`${UID}:avatar`);
        expect((await reward("avatar")).json.rewarded).toBe(true);
        images.delete(`${UID}:avatar`);
        expect((await reward("avatar")).json.rewarded).toBe(true);
    });

    it("ログインしていなければ 401", async () => {
        expect((await reward("avatar", null)).status).toBe(401);
    });

    it("rewardInto: 印の読み書きが行を行き来しても残る（parseTrunk ⇄ 保存）", () => {
        const now = new Date("2026-10-18T05:00:00.000Z");
        const r = rewardInto(parseTrunk(undefined), "avatar", true, now);
        expect(r.doc?.rewardAvatarAt).toBe(now.toISOString());
        // 印があれば変えない
        expect(rewardInto(r.doc!, "avatar", true, now).doc).toBeNull();
        // 設定されていなければ変えない
        expect(rewardInto(parseTrunk(undefined), "cover", false, now).doc).toBeNull();
        const back = parseTrunk({ rewardAvatarAt: now.toISOString(), rewardAvatarAdded: 3 });
        expect(back.rewardAvatarAt).toBe(now.toISOString());
        expect(back.rewardAvatarAdded).toBe(3);
        expect(back.rewardCoverAt).toBeUndefined();
    });
});
