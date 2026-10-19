import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * 旅のトランク（`trunk#<uid>`）。
 *
 * DynamoDB は**中身を持つ作り物**にする（読む → rev 条件で Put を本当に通す）。
 * 呼ばれた順番を数える形だと、二重に配らないこと・競合で読み直すことを確かめられない。
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

async function send(cmd: { constructor: { name: string }; input: Record<string, unknown> }) {
    // 1拍おく（同時の2本が本当に交互に走るように）
    await new Promise((r) => setTimeout(r, 0));
    const input = cmd.input as { TableName: string; Key?: Item; Item?: Item; ConditionExpression?: string; ExpressionAttributeValues?: Item };
    if (cmd.constructor.name === "GetCommand") {
        const v = store.get(keyOf(input.TableName, input.Key!));
        return { Item: v ? structuredClone(v) : undefined };
    }
    if (cmd.constructor.name === "PutCommand") {
        const k = keyOf(input.TableName, input.Item!);
        if (!condHolds(k, input)) throw Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
        store.set(k, structuredClone(input.Item!));
        return {};
    }
    // 2行を一度に（`updateTrunk`）。条件を全部確かめてから全部書く＝1つでも外れたら何も書かない
    if (cmd.constructor.name === "TransactWriteCommand") {
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
    throw new Error(`想定外の命令 ${cmd.constructor.name}`);
}

const T = await import("../trunk");
const { handler, grantLabel, buildLabel, dealInto, parseTrunk, trunkId } = T;
import type { Photo } from "../types";
import { TRUNK_PARTS } from "../trunkParts";

const UID = "user-1234";
const PRO = { userId: UID, supporter: { active: true } };
const FREE = { userId: UID };

const photo = (id: string, over: Partial<Photo> = {}): Photo => ({
    id, src: `https://cdn.example.com/uploads/${UID}/${id}.webp`, userId: UID, published: true, ...over,
} as Photo);

const label = (id: string, over: Record<string, unknown> = {}) => ({
    id, photoId: id, kind: "place", place: { name: "京都" }, seed: 42, at: "2026-10-01T00:00:00.000Z", ...over,
});

function setProfile(p: Item) { store.set(`users-test|${UID}`, p); }
function setTrunk(t: Item) { store.set(`photos-test|${trunkId(UID)}`, { id: trunkId(UID), uid: UID, rev: 1, ...t }); }
const trunkRow = () => store.get(`photos-test|${trunkId(UID)}`) as Item | undefined;
const ledgerRow = () => store.get(`photos-test|${T.trunkLedgerId(UID)}`) as Item | undefined;
const pocketIds = () => ((trunkRow()?.pocket ?? []) as { i?: string; id?: string }[]).map((l) => l.i ?? l.id);

type Res = { statusCode: number; body: string; headers?: Record<string, string> };
async function call(routeKey: string, opts: { id?: string; body?: unknown; sub?: string } = {}): Promise<{ status: number; json: Record<string, unknown> }> {
    const ev = {
        routeKey,
        pathParameters: opts.id ? { id: opts.id } : undefined,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        requestContext: { authorizer: { jwt: { claims: { sub: opts.sub ?? UID } } }, http: { method: routeKey.split(" ")[0] } },
    };
    const res = (await (handler as unknown as (e: unknown) => Promise<Res>)(ev));
    return { status: res.statusCode, json: JSON.parse(res.body) };
}

beforeEach(() => {
    store.clear();
    fakeSend.mockReset().mockImplementation(send);
    mockListMyPhotos.mockReset().mockResolvedValue([]);
});
afterEach(() => { vi.useRealTimers(); });

describe("配る（grantLabel）", () => {
    it("公開の投稿に1枚配る。id は写真の id", async () => {
        setProfile(FREE);
        const out = await grantLabel(UID, photo("p1"));
        expect(out.label?.id).toBe("p1");
        expect(out.label?.photoId).toBe("p1");
        expect(pocketIds()).toEqual(["p1"]);
        // 写真の索引に出ない（userId を持たない）
        expect(trunkRow()?.userId).toBeUndefined();
        expect(trunkRow()?.uid).toBe(UID);
    });

    it("同じ写真に二度配らない（再送）——2回目は配り済みの1枚を返す", async () => {
        setProfile(FREE);
        const a = await grantLabel(UID, photo("p1"));
        const b = await grantLabel(UID, photo("p1"));
        expect(pocketIds()).toEqual(["p1"]);
        expect(b.label).toEqual(a.label);
        expect(b.labelSkipped).toBeUndefined();
    });

    it("同時に2本来ても1枚（rev の競合で読み直して、配り済みを見る）", async () => {
        setProfile(FREE);
        await Promise.all([grantLabel(UID, photo("p1")), grantLabel(UID, photo("p1"))]);
        expect(pocketIds()).toEqual(["p1"]);
    });

    it("貼ったあとに再送が来ても、手持ちに戻さない", async () => {
        setProfile(FREE);
        setTrunk({ pocket: [], stuck: [label("p1")] });
        const out = await grantLabel(UID, photo("p1"));
        expect(out.label?.id).toBe("p1");
        expect(pocketIds()).toEqual([]);
    });

    it("下書き・ストーリーには配らない", async () => {
        setProfile(FREE);
        expect((await grantLabel(UID, photo("p1", { published: false }))).labelSkipped).toBe("draft");
        expect((await grantLabel(UID, photo("p2", { story: true } as Partial<Photo>))).labelSkipped).toBe("draft");
        expect(trunkRow()).toBeUndefined();
    });

    it("無料は手持ち30でいっぱい（配らない・投稿は止めない）", async () => {
        setProfile(FREE);
        setTrunk({ pocket: Array.from({ length: 30 }, (_, i) => label(`a${i}`)), stuck: [] });
        const out = await grantLabel(UID, photo("p1"));
        expect(out).toEqual({ label: null, labelSkipped: "full", coin: 1 });
        expect(pocketIds()).toHaveLength(30);
    });

    it("29なら配れる（境目）", async () => {
        setProfile(FREE);
        setTrunk({ pocket: Array.from({ length: 29 }, (_, i) => label(`a${i}`)), stuck: [] });
        expect((await grantLabel(UID, photo("p1"))).label?.id).toBe("p1");
    });

    it("Pro は150まで（30を超えても配る・150でいっぱい）", async () => {
        setProfile(PRO);
        setTrunk({ pocket: Array.from({ length: 30 }, (_, i) => label(`a${i}`)), stuck: [] });
        expect((await grantLabel(UID, photo("p1"))).label?.id).toBe("p1");
        setTrunk({ pocket: Array.from({ length: 150 }, (_, i) => label(`a${i}`)), stuck: [] });
        expect((await grantLabel(UID, photo("p2"))).labelSkipped).toBe("full");
    });

    it("貼ったものは上限に数えない", async () => {
        setProfile(FREE);
        setTrunk({ pocket: [], stuck: Array.from({ length: 200 }, (_, i) => label(`s${i}`)) });
        expect((await grantLabel(UID, photo("p1"))).label?.id).toBe("p1");
    });

    it("Pro の期限が切れていたら無料の上限", async () => {
        setProfile({ userId: UID, supporter: { active: true, expiresAt: "2020-01-01T00:00:00.000Z" } });
        setTrunk({ pocket: Array.from({ length: 30 }, (_, i) => label(`a${i}`)), stuck: [] });
        expect((await grantLabel(UID, photo("p1"))).labelSkipped).toBe("full");
    });

    it("束（groupId）で上げた投稿は1投稿に1枚", async () => {
        setProfile(FREE);
        await grantLabel(UID, photo("p1", { groupId: "g-1" }));
        const second = await grantLabel(UID, photo("p2", { groupId: "g-1" }));
        expect(second).toEqual({ label: null, labelSkipped: "samePost", coin: 0 });
        expect(pocketIds()).toEqual(["p1"]);
        // 応答には束の印を出さない
        const got = await call("GET /user/trunk");
        expect((got.json.pocket as Item[])[0].groupId).toBeUndefined();
    });

    it("他の項目（型・作り直しの回数）を消さない", async () => {
        setProfile(FREE);
        setTrunk({ model: "canvas", lastFreeModel: "canvas", pocket: [], stuck: [], rerolls: { month: "2026-10", used: 2 } });
        await grantLabel(UID, photo("p1"));
        expect(trunkRow()?.model).toBe("canvas");
        expect(trunkRow()?.rerolls).toEqual({ month: "2026-10", used: 2 });
    });
});

describe("kind の決め方（buildLabel）", () => {
    const now = new Date("2026-10-17T00:00:00Z");
    const rand = (a: number) => a + 5;  // foil にならない（5 < 200 は foil になるので下で別に見る）
    const noFoil = (a: number, b: number) => (b === 10_000 ? 9_999 : a + 5);
    const others = (n: number) => Array.from({ length: n }, (_, i) => photo(`o${i}`, { location: "京都" }));

    it("節目 ＞ 時刻 ＞ 季節 ＞ 土地", () => {
        const full = photo("p", { location: "京都", date: "2026-04-10", exif: { dateTimeOriginal: "2026:04:10 21:00:00" } });
        expect(buildLabel(full, [], now, noFoil).kind).toBe("milestone");
        expect(buildLabel(full, others(3), now, noFoil).kind).toBe("timeslot");
        const noHour = photo("p", { location: "京都", date: "2026-04-10" });
        expect(buildLabel(noHour, others(3), now, noFoil).kind).toBe("season");
        const placeOnly = photo("p", { location: "京都" });
        expect(buildLabel(placeOnly, others(3), now, noFoil).kind).toBe("place");
        // 時刻・季節は kind が別でも載る
        const l = buildLabel(full, [], now, noFoil);
        expect(l.timeslot).toBe("night");
        expect(l.season).toBe("spring");
        expect(l.milestone).toBe("first");
        void rand;
    });

    it("節目: はじめて・10・50・100 投稿目・はじめての国", () => {
        const p = photo("p", { location: "京都" });
        expect(buildLabel(p, [], now, noFoil).milestone).toBe("first");
        expect(buildLabel(p, others(9), now, noFoil).milestone).toBe("posts10");
        expect(buildLabel(p, others(49), now, noFoil).milestone).toBe("posts50");
        expect(buildLabel(p, others(99), now, noFoil).milestone).toBe("posts100");
        expect(buildLabel(p, others(10), now, noFoil).milestone).toBeUndefined();
        const paris = photo("p", { location: "パリ, フランス" });
        expect(buildLabel(paris, others(3), now, noFoil).milestone).toBe("firstCountry");
        expect(buildLabel(paris, [...others(3), photo("x", { location: "フランス" })], now, noFoil).milestone).toBeUndefined();
        // 下書きは数に入らない
        expect(buildLabel(p, [photo("d", { published: false })], now, noFoil).milestone).toBe("first");
    });

    it("節目は束を1投稿に数える", () => {
        const grouped = Array.from({ length: 9 }, (_, i) => photo(`g${i}`, { groupId: "trip-1" }));
        // 束9枚＝1投稿 → この投稿は2件目
        expect(buildLabel(photo("p"), grouped, now, noFoil).milestone).toBeUndefined();
        expect(T.countPosts(grouped)).toBe(1);
    });

    it("時刻の区切り（夜明け 4–6・夕方 16–18・夜 20–3）", () => {
        const at = (h: number) => T.timeslotOf(h);
        expect([3, 4, 6, 7, 15, 16, 18, 19, 20, 0].map(at)).toEqual(
            ["night", "dawn", "dawn", undefined, undefined, "dusk", "dusk", undefined, "night", "night"]);
        expect(T.shotHour(photo("p", { exif: { dateTimeOriginal: "2026:01:02 05:30:00" } }))).toBe(5);
        expect(T.shotHour(photo("p", { exif: { dateTimeOriginal: "2026-01-02T17:30:00" } }))).toBe(17);
        expect(T.shotHour(photo("p", { date: "2026-01-02" }))).toBeNull();
    });

    it("季節は南半球で反転（座標の緯度）", () => {
        const north = photo("p", { date: "2026-01-10", coords: { lat: 35, lng: 135 } });
        const south = photo("p", { date: "2026-01-10", coords: { lat: -33, lng: 151 } });
        expect(buildLabel(north, others(3), now, noFoil).season).toBe("winter");
        expect(buildLabel(south, others(3), now, noFoil).season).toBe("summer");
    });

    it("土地: 撮影地 → 国、ラテン文字の区切りは latin", () => {
        expect(T.placeOf(photo("p", { location: "Helsinki, フィンランド" }))).toEqual({ name: "Helsinki", latin: "Helsinki", country: "フィンランド" });
        expect(T.placeOf(photo("p", { location: "京都府 嵐山" })).country).toBe("日本");
        expect(T.placeOf(photo("p"))).toEqual({ name: "" });
    });

    it("foil はまれ（定数の確率）・seed は整数", () => {
        const foil = buildLabel(photo("p"), [], now, (a, b) => (b === 10_000 ? 0 : 7));
        expect(foil.foil).toBe(true);
        expect(foil.seed).toBe(7);
        expect(buildLabel(photo("p"), [], now, noFoil).foil).toBeUndefined();
        expect(T.FOIL_PER_10000).toBe(200);
    });
});

describe("貼る・削除", () => {
    beforeEach(() => { setProfile(FREE); setTrunk({ pocket: [label("a"), label("b")], stuck: [] }); });

    it("手持ち → 貼った", async () => {
        const r = await call("POST /user/trunk/labels/{id}/stick", { id: "a" });
        expect(r.status).toBe(200);
        expect((r.json.pocket as Item[]).map((l) => l.id)).toEqual(["b"]);
        expect((r.json.stuck as Item[]).map((l) => l.id)).toEqual(["a"]);
        // 再送は 200 のまま（もう貼ってある）
        expect((await call("POST /user/trunk/labels/{id}/stick", { id: "a" })).status).toBe(200);
    });

    it("無いラベルは 404", async () => {
        expect((await call("POST /user/trunk/labels/{id}/stick", { id: "zz" })).status).toBe(404);
        expect((await call("DELETE /user/trunk/labels/{id}", { id: "zz" })).status).toBe(404);
    });

    it("貼った一覧は1200まで", async () => {
        setTrunk({ pocket: [label("a")], stuck: Array.from({ length: 1200 }, (_, i) => label(`s${i}`)) });
        const r = await call("POST /user/trunk/labels/{id}/stick", { id: "a" });
        expect(r.status).toBe(409);
        expect(r.json.code).toBe("full");
    });

    it("手持ちから削除。貼ったものは消せない", async () => {
        const r = await call("DELETE /user/trunk/labels/{id}", { id: "b" });
        expect(r.status).toBe(200);
        expect(pocketIds()).toEqual(["a"]);
        await call("POST /user/trunk/labels/{id}/stick", { id: "a" });
        expect((await call("DELETE /user/trunk/labels/{id}", { id: "a" })).status).toBe(404);
    });

    it("他人の行は触れない（行は JWT の sub からだけ作る）", async () => {
        const r = await call("POST /user/trunk/labels/{id}/stick", { id: "a", sub: "someone-else" });
        expect(r.status).toBe(404);
        expect(pocketIds()).toEqual(["a", "b"]);
    });
});

describe("作り直し（Pro・月3回）", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-10-17T03:00:00Z"));
        setTrunk({ pocket: [label("a"), label("b", { foil: true })], stuck: [] });
    });

    it("Pro 以外は 403", async () => {
        setProfile(FREE);
        const r = await call("POST /user/trunk/labels/{id}/reroll", { id: "a" });
        expect(r.status).toBe(403);
        expect(r.json.code).toBe("proOnly");
        expect(trunkRow()?.pendingReroll).toBeUndefined();
    });

    it("候補3つ → 選ぶ。月に3回まで・4回目は断る・回数は戻らない", async () => {
        setProfile(PRO);
        for (let i = 0; i < 3; i++) {
            const r = await call("POST /user/trunk/labels/{id}/reroll", { id: "a" });
            expect(r.status).toBe(200);
            const pending = r.json.pendingReroll as { labelId: string; seeds: number[] };
            expect(pending.labelId).toBe("a");
            expect(pending.seeds).toHaveLength(3);
            expect((r.json.rerolls as { left: number }).left).toBe(2 - i);
            // 1回目は候補から、2回目は今の図柄のまま（それでも回数は戻らない）
            const current = (r.json.pocket as Item[])[0].seed as number;
            const seed = i === 1 ? current : pending.seeds[0];
            const c = await call("POST /user/trunk/labels/{id}/reroll/choose", { id: "a", body: { seed } });
            expect(c.status).toBe(200);
            expect(c.json.pendingReroll).toBeUndefined();
            expect((c.json.pocket as Item[])[0].seed).toBe(seed);
        }
        const fourth = await call("POST /user/trunk/labels/{id}/reroll", { id: "a" });
        expect(fourth.status).toBe(409);
        expect(fourth.json.code).toBe("noRerollsLeft");
    });

    it("同じラベルの選びかけは回数を使わずに返す・別のラベルは 409", async () => {
        setProfile(PRO);
        const a1 = await call("POST /user/trunk/labels/{id}/reroll", { id: "a" });
        const a2 = await call("POST /user/trunk/labels/{id}/reroll", { id: "a" });
        expect(a2.json.pendingReroll).toEqual(a1.json.pendingReroll);
        expect((a2.json.rerolls as { left: number }).left).toBe(2);
        const b = await call("POST /user/trunk/labels/{id}/reroll", { id: "b" });
        expect(b.status).toBe(409);
        expect(b.json.code).toBe("pendingReroll");
    });

    it("候補にない seed は 400", async () => {
        setProfile(PRO);
        await call("POST /user/trunk/labels/{id}/reroll", { id: "a" });
        const r = await call("POST /user/trunk/labels/{id}/reroll/choose", { id: "a", body: { seed: 999_999 } });
        expect(r.status).toBe(400);
        expect(r.json.code).toBe("badSeed");
    });

    it("月が替わったら3回に戻る（繰り越しなし）", async () => {
        setProfile(PRO);
        setTrunk({ pocket: [label("a")], stuck: [], rerolls: { month: "2026-10", used: 3 } });
        expect((await call("POST /user/trunk/labels/{id}/reroll", { id: "a" })).status).toBe(409);
        // 日本時間の 11/1 0:30（UTC ではまだ 10/31）
        vi.setSystemTime(new Date("2026-10-31T15:30:00Z"));
        const r = await call("POST /user/trunk/labels/{id}/reroll", { id: "a" });
        expect(r.status).toBe(200);
        expect(r.json.rerolls).toEqual({ left: 2, month: "2026-11" });
        // 使い残しは繰り越さない（前の月が0回でも、今月は3回）
        expect(trunkRow()?.rerolls).toEqual({ month: "2026-11", used: 1 });
    });

    it("foil は作り直しても保つ", async () => {
        setProfile(PRO);
        const r = await call("POST /user/trunk/labels/{id}/reroll", { id: "b" });
        const seed = (r.json.pendingReroll as { seeds: number[] }).seeds[1];
        const c = await call("POST /user/trunk/labels/{id}/reroll/choose", { id: "b", body: { seed } });
        const b = (c.json.pocket as Item[]).find((l) => l.id === "b")!;
        expect(b.foil).toBe(true);
        expect(b.seed).toBe(seed);
    });

    it("貼ったラベルは作り直せない", async () => {
        setProfile(PRO);
        await call("POST /user/trunk/labels/{id}/stick", { id: "a" });
        expect((await call("POST /user/trunk/labels/{id}/reroll", { id: "a" })).status).toBe(404);
    });
});

describe("型（PUT /user/trunk/model）と Pro をやめたとき", () => {
    it("無料の型は誰でも・Pro の型は Pro だけ", async () => {
        setProfile(FREE);
        expect((await call("PUT /user/trunk/model", { body: { model: "canvas" } })).status).toBe(200);
        const pro = await call("PUT /user/trunk/model", { body: { model: "urushi" } });
        expect(pro.status).toBe(403);
        expect((await call("PUT /user/trunk/model", { body: { model: "plastic" } })).status).toBe(400);
    });

    it("Pro をやめたら effectiveModel は最後の無料の型・保存は残す・再開で戻る", async () => {
        setProfile(PRO);
        await call("PUT /user/trunk/model", { body: { model: "canvas" } });
        const set = await call("PUT /user/trunk/model", { body: { model: "starchart" } });
        expect(set.json.effectiveModel).toBe("starchart");
        setProfile(FREE);
        const lapsed = await call("GET /user/trunk");
        expect(lapsed.json.model).toBe("starchart");
        expect(lapsed.json.effectiveModel).toBe("canvas");
        expect(lapsed.json.isPro).toBe(false);
        expect(lapsed.json.limit).toBe(30);
        expect(lapsed.json.rerolls).toMatchObject({ left: 0 });
        setProfile(PRO);
        expect((await call("GET /user/trunk")).json.effectiveModel).toBe("starchart");
    });

    it("無料の型を選んだことが無ければ leather", async () => {
        setProfile(FREE);
        setTrunk({ model: "kori", pocket: [], stuck: [] });
        expect((await call("GET /user/trunk")).json.effectiveModel).toBe("leather");
    });

    it("Pro をやめて手持ちが30を超えていても消さない（配らないだけ）", async () => {
        setProfile(FREE);
        setTrunk({ pocket: Array.from({ length: 40 }, (_, i) => label(`a${i}`)), stuck: [] });
        expect((await grantLabel(UID, photo("p1"))).labelSkipped).toBe("full");
        const r = await call("GET /user/trunk");
        expect((r.json.pocket as Item[])).toHaveLength(40);
        // 減らせば（貼れば）また動く
        expect((await call("POST /user/trunk/labels/{id}/stick", { id: "a0" })).status).toBe(200);
    });
});

describe("GET /user/trunk", () => {
    it("行が無くても既定の形で返す・posts は公開している投稿（束は1つ）", async () => {
        setProfile(FREE);
        mockListMyPhotos.mockResolvedValue([
            photo("a"), photo("b", { groupId: "g" }), photo("c", { groupId: "g" }), photo("d", { published: false }),
        ]);
        const r = await call("GET /user/trunk");
        expect(r.status).toBe(200);
        expect(r.json).toMatchObject({
            model: "leather", effectiveModel: "leather", pocket: [], stuck: [], limit: 30, isPro: false, posts: 2,
        });
        expect(mockListMyPhotos).toHaveBeenCalledWith(UID);
    });

    it("認証が無ければ 401・知らない道は 404・形の壊れたラベルは落とす", async () => {
        expect((await call("GET /user/trunk", { sub: "" })).status).toBe(401);
        setProfile(FREE);
        expect((await call("POST /user/trunk/labels/{id}/nope", { id: "a" })).status).toBe(404);
        const doc = parseTrunk({ pocket: [label("a"), { id: "b" }, "x"], stuck: "x" });
        expect(doc.pocket.map((l) => l.id)).toEqual(["a"]);
        expect(doc.stuck).toEqual([]);
    });
});

describe("dealInto（純関数）", () => {
    it("配り済みの id は変えない（doc: null）", () => {
        const doc = parseTrunk({ pocket: [label("a")], stuck: [] });
        const r = dealInto(doc, label("a", { seed: 1 }) as never, 30, "i:x", new Date());
        expect(r.doc).toBeNull();
        expect(r.outcome.label?.seed).toBe(42);
    });
});

describe("集める悪用を防ぐ（2026-10-17 owner）", () => {
    const exif = (t: string) => ({ exif: { dateTimeOriginal: t, camera: "Canon EOS R5", imageSize: "8192x5464" } });

    it("消して同じ写真を上げ直しても配らない（指紋の台帳は写真を消しても残る）", async () => {
        setProfile(FREE);
        const first = photo("p1", { ...exif("2026:10:01 10:00:00"), createdAt: new Date().toISOString() });
        await grantLabel(UID, first);
        await T.revokeLabelQuietly(UID, { id: "p1", createdAt: first.createdAt }, "test");
        expect(pocketIds()).toEqual([]);
        // 上げ直すと別の id になる。中身（EXIF）は同じ
        const again = await grantLabel(UID, photo("p9", exif("2026:10:01 10:00:00")));
        expect(again).toEqual({ label: null, labelSkipped: "duplicate", coin: 0 });
        expect(pocketIds()).toEqual([]);
        // 別の写真は配る
        expect((await grantLabel(UID, photo("p2", exif("2026:10:01 10:00:01")))).label?.id).toBe("p2");
    });

    it("手持ちから削除したあとの再送でも戻らない（EXIF の無い写真は id で見る）", async () => {
        setProfile(FREE);
        await grantLabel(UID, photo("p1"));
        await call("DELETE /user/trunk/labels/{id}", { id: "p1" });
        expect((await grantLabel(UID, photo("p1"))).labelSkipped).toBe("duplicate");
        expect(T.fingerprintOf(photo("p1"))).not.toBe(T.fingerprintOf(photo("p2")));
        expect(T.fingerprintOf(photo("a", exif("x")))).toBe(T.fingerprintOf(photo("b", exif("x"))));
    });

    it("1日（日本時間）に3枚まで。翌日はまた配る", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-10-17T14:00:00Z"));   // 日本時間 23:00
        setProfile(PRO);
        for (const id of ["a", "b", "c"]) expect((await grantLabel(UID, photo(id))).label?.id).toBe(id);
        expect((await grantLabel(UID, photo("d"))).labelSkipped).toBe("daily");
        expect(T.DAILY_DEAL_MAX).toBe(3);
        vi.setSystemTime(new Date("2026-10-17T15:30:00Z"));   // 日本時間 翌 0:30
        expect((await grantLabel(UID, photo("d"))).label?.id).toBe("d");
        expect(ledgerRow()?.daily).toEqual({ day: "2026-10-18", count: 1 });
    });

    it("取り消しても日の枠は戻らない", async () => {
        setProfile(FREE);
        const now = new Date().toISOString();
        for (const id of ["a", "b", "c"]) await grantLabel(UID, photo(id));
        await T.revokeLabelQuietly(UID, { id: "c", createdAt: now }, "test");
        expect((await grantLabel(UID, photo("d"))).labelSkipped).toBe("daily");
    });

    it("投稿から24時間以内の削除で、手持ちからも貼った方からも消える。24時間を過ぎたものは残る", async () => {
        setProfile(FREE);
        const now = Date.now();
        const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();
        setTrunk({ pocket: [label("new"), label("old")], stuck: [label("st"), label("st-old")], pendingReroll: { labelId: "new", seeds: [1, 2, 3], at: "" } });
        await T.revokeLabelQuietly(UID, { id: "new", createdAt: ago(23) }, "test");
        await T.revokeLabelQuietly(UID, { id: "old", createdAt: ago(25) }, "test");
        await T.revokeLabelQuietly(UID, { id: "st", createdAt: ago(1) }, "test");
        await T.revokeLabelQuietly(UID, { id: "st-old", createdAt: ago(30) }, "test");
        expect(pocketIds()).toEqual(["old"]);
        expect((trunkRow()?.stuck as Item[]).map((l) => l.i ?? l.id)).toEqual(["st-old"]);
        expect(trunkRow()?.pendingReroll).toBeUndefined();
        expect(T.REVOKE_WINDOW_MS).toBe(24 * 3_600_000);
    });

    it("時刻は初めての公開（firstPublishedAt）を先に見る（下書きを何日もあとで公開した写真）", async () => {
        setProfile(FREE);
        const now = Date.now();
        setTrunk({ pocket: [label("d1")], stuck: [] });
        await T.revokeLabelQuietly(UID, {
            id: "d1", createdAt: new Date(now - 72 * 3_600_000).toISOString(), firstPublishedAt: new Date(now - 3_600_000).toISOString(),
        }, "test");
        expect(pocketIds()).toEqual([]);
    });

    it("束は、束の写真がまだ公開で残っていれば取り消さない。全部消えたら取り消す", async () => {
        setProfile(FREE);
        const g = "trip-abc";
        await grantLabel(UID, photo("p1", { groupId: g }));
        // 表紙（p1）を消した。p2 はまだ公開で残っている（行を強い読みで確かめる）
        store.set("photos-test|p2", photo("p2", { groupId: g }) as Item);
        mockListMyPhotos.mockResolvedValue([photo("p1", { groupId: g }), photo("p2", { groupId: g })]);
        await T.revokeLabelQuietly(UID, { id: "p1", groupId: g, createdAt: new Date().toISOString() }, "test");
        expect(pocketIds()).toEqual(["p1"]);
        const reads = fakeSend.mock.calls.map((c) => c[0].input).filter((i) => i.Key?.id === "p2");
        expect(reads.at(-1)?.ConsistentRead).toBe(true);
        // 残りの p2 も消した（索引にはまだ p2 が見えていても、id で除く）
        store.delete("photos-test|p2");
        await T.revokeLabelQuietly(UID, { id: "p2", groupId: g, createdAt: new Date().toISOString() }, "test");
        expect(pocketIds()).toEqual([]);
        // 束の台帳は残る＝上げ直しても配らない
        expect((await grantLabel(UID, photo("p3", { groupId: g }))).labelSkipped).toBe("samePost");
    });

    it("束: 非公開にした兄弟は「残っている」に数えない（索引が古い姿でも、行を強い読みで見る）", async () => {
        setProfile(FREE);
        const g = "trip-x";
        await grantLabel(UID, photo("p1", { groupId: g }));
        // 索引ではまだ公開に見えるが、行はもう非公開
        mockListMyPhotos.mockResolvedValue([photo("p2", { groupId: g })]);
        store.set("photos-test|p2", photo("p2", { groupId: g, published: false }) as Item);
        await T.revokeLabelQuietly(UID, { id: "p1", groupId: g, createdAt: new Date().toISOString() }, "test");
        expect(pocketIds()).toEqual([]);
    });

    it("取り消しは投げない（行が無い・読めない）", async () => {
        await expect(T.revokeLabelQuietly(UID, { id: "x" }, "test")).resolves.toBeUndefined();
        fakeSend.mockRejectedValue(new Error("down"));
        const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
        await expect(T.revokeLabelQuietly(UID, { id: "x" }, "test")).resolves.toBeUndefined();
        err.mockRestore();
    });

    it("台帳は最新3000件（古い順に落とす）", async () => {
        setProfile(FREE);
        setTrunk({ pocket: [], stuck: [], dealt: Array.from({ length: 3000 }, (_, i) => `x:old${i}`) });
        await grantLabel(UID, photo("p1"));
        const dealt = ledgerRow()?.dealt as string[];
        expect(dealt).toHaveLength(3000);
        expect(dealt[0]).toBe(T.fingerprintOf(photo("p1")));
        expect(dealt).not.toContain("x:old2999");
        expect(T.DEALT_LEDGER_MAX).toBe(3000);
    });

    it("非公開→公開で二重にならない（id は写真の id のまま）", async () => {
        setProfile(FREE);
        await grantLabel(UID, photo("p1", { published: false }));
        await grantLabel(UID, photo("p1"));
        await grantLabel(UID, photo("p1"));
        expect(pocketIds()).toEqual(["p1"]);
    });
});

describe("受け取らない設定（PUT /user/trunk/settings）", () => {
    it("false の間は配らない（off）。戻してもさかのぼらない", async () => {
        setProfile(FREE);
        expect((await call("GET /user/trunk")).json.receiveLabels).toBe(true);
        const off = await call("PUT /user/trunk/settings", { body: { receiveLabels: false } });
        expect(off.status).toBe(200);
        expect(off.json.receiveLabels).toBe(false);
        expect(await grantLabel(UID, photo("p1"))).toEqual({ label: null, labelSkipped: "off", coin: 1 });
        await call("PUT /user/trunk/settings", { body: { receiveLabels: true } });
        const on = await call("GET /user/trunk");
        expect(on.json.receiveLabels).toBe(true);
        expect(on.json.pocket).toEqual([]);
        // 戻したあとの投稿は配る
        expect((await grantLabel(UID, photo("p2"))).label?.id).toBe("p2");
    });

    it("止めている間も、型や手持ちは残る・真偽でなければ 400", async () => {
        setProfile(FREE);
        setTrunk({ model: "canvas", lastFreeModel: "canvas", pocket: [label("a")], stuck: [] });
        await call("PUT /user/trunk/settings", { body: { receiveLabels: false } });
        expect(trunkRow()?.model).toBe("canvas");
        expect(pocketIds()).toEqual(["a"]);
        expect((await call("PUT /user/trunk/settings", { body: { receiveLabels: "no" } })).status).toBe(400);
    });
});

describe("節目は一度きり・束の台帳・下書きをあとで公開（2026-10-17 追加）", () => {
    it("写真を全部消して投稿し直しても「はじめて」は二度と配らない（kind は次の順で決め直す）", async () => {
        setProfile(FREE);
        const first = await grantLabel(UID, photo("p1", { date: "2026-04-10" }));
        expect(first.label?.milestone).toBe("first");
        await call("DELETE /user/trunk/labels/{id}", { id: "p1" });
        // 写真も全部消えた（others が空）＝計算上はまた「はじめて」
        const again = await grantLabel(UID, photo("p2", { date: "2026-04-11" }));
        expect(again.label?.milestone).toBeUndefined();
        expect(again.label?.kind).toBe("season");
        expect(ledgerRow()?.milestones).toEqual(["first"]);
    });

    it("「はじめての国」は国ごとに一度", async () => {
        setProfile(PRO);
        mockListMyPhotos.mockResolvedValue([photo("o1", { location: "京都" })]);
        expect((await grantLabel(UID, photo("p1", { location: "パリ, フランス" }))).label?.milestone).toBe("firstCountry");
        await call("DELETE /user/trunk/labels/{id}", { id: "p1" });
        expect((await grantLabel(UID, photo("p2", { location: "リヨン, フランス" }))).label?.milestone).toBeUndefined();
        expect((await grantLabel(UID, photo("p3", { location: "ローマ, イタリア" }))).label?.milestone).toBe("firstCountry");
        expect(ledgerRow()?.milestones).toEqual(["firstCountry:イタリア", "firstCountry:フランス"]);
    });

    it("束: 手持ちから消しても、同じ groupId の別の写真には配らない", async () => {
        setProfile(FREE);
        await grantLabel(UID, photo("p1", { groupId: "g-1" }));
        await call("DELETE /user/trunk/labels/{id}", { id: "p1" });
        expect(await grantLabel(UID, photo("p2", { groupId: "g-1" }))).toEqual({ label: null, labelSkipped: "samePost", coin: 0 });
        expect(ledgerRow()?.groups).toEqual([T.groupKey("g-1")]);
    });

    it("束の台帳は3000件（古い順に落とす）", async () => {
        setProfile(FREE);
        setTrunk({ pocket: [], stuck: [], groups: Array.from({ length: 3000 }, (_, i) => `old-${i}`) });
        await grantLabel(UID, photo("p1", { groupId: "new-1" }));
        const groups = ledgerRow()?.groups as string[];
        expect(groups).toHaveLength(3000);
        expect(groups[0]).toBe(T.groupKey("new-1"));
        expect(groups).not.toContain("old-2999");
    });

    it("下書きをあとで公開: 行を読み直して同じ判定で配る・二重にしない・他人の行は配らない", async () => {
        setProfile(FREE);
        const fresh = new Date().toISOString();
        store.set("photos-test|p1", photo("p1", { location: "京都", createdAt: fresh }) as Item);
        const a = await T.grantLabelForPhotoQuietly(UID, "p1", "test");
        expect(a.label?.id).toBe("p1");
        expect(a.label?.place.name).toBe("京都");
        // 非公開 → 公開をもう一度
        expect((await T.grantLabelForPhotoQuietly(UID, "p1", "test")).label?.id).toBe("p1");
        expect(pocketIds()).toEqual(["p1"]);
        store.set("photos-test|q1", photo("q1", { userId: "someone-else", createdAt: fresh }) as Item);
        // 機能を出した日より前に作られた写真は配らない（昔の写真を非公開 → 公開で集めさせない）
        store.set("photos-test|old", photo("old", { createdAt: "2026-10-01T00:00:00.000Z" }) as Item);
        expect((await T.grantLabelForPhotoQuietly(UID, "old", "test")).labelSkipped).toBe("notNew");
        store.set("photos-test|nodate", photo("nodate") as Item);
        expect((await T.grantLabelForPhotoQuietly(UID, "nodate", "test")).labelSkipped).toBe("notNew");
        expect((await T.grantLabelForPhotoQuietly(UID, "q1", "test")).labelSkipped).toBe("draft");
        // 受け取らない設定も同じく効く
        await call("PUT /user/trunk/settings", { body: { receiveLabels: false } });
        store.set("photos-test|p2", photo("p2", { createdAt: fresh }) as Item);
        expect((await T.grantLabelForPhotoQuietly(UID, "p2", "test")).labelSkipped).toBe("off");
    });
});

describe("確かめの指摘（2026-10-17）", () => {
    it("指紋: 撮影日時が無ければ写真 id（機種と大きさだけで同じ指紋にしない）", () => {
        const noTime = (id: string) => photo(id, { exif: { camera: "Canon EOS R5", imageSize: "8192x5464" } });
        expect(T.fingerprintOf(noTime("a"))).not.toBe(T.fingerprintOf(noTime("b")));
        expect(T.fingerprintOf(noTime("a"))).toBe(T.fingerprintOf(photo("a")));
    });

    it("配る処理が止まっても時間切れで戻る（投稿を待たせない）", async () => {
        vi.useFakeTimers();
        setProfile(FREE);
        mockListMyPhotos.mockReturnValue(new Promise(() => undefined));
        const p = T.grantLabelQuietly(UID, photo("p1"), "test");
        await vi.advanceTimersByTimeAsync(T.TRUNK_QUIET_LIMIT_MS + 10);
        await expect(p).resolves.toEqual({ label: null, labelSkipped: "timeout", coin: 0 });
    });

    it("編集の経路（grantLabelForPhotoQuietly）も時間切れで戻る・読み直しは強い読み", async () => {
        vi.useFakeTimers();
        setProfile(FREE);
        fakeSend.mockImplementation((cmd: { constructor: { name: string }; input: Item }) =>
            cmd.input.TableName === "photos-test" && (cmd.input.Key as Item)?.id === "p1" ? new Promise(() => undefined) : send(cmd as never));
        const p = T.grantLabelForPhotoQuietly(UID, "p1", "test");
        await vi.advanceTimersByTimeAsync(T.TRUNK_QUIET_LIMIT_MS + 10);
        await expect(p).resolves.toEqual({ label: null, labelSkipped: "timeout", coin: 0 });
        const read = fakeSend.mock.calls.map((c) => c[0].input).find((i) => i.Key?.id === "p1");
        expect(read?.ConsistentRead).toBe(true);
    });

    it("配る処理が投げても投げない（error）", async () => {
        setProfile(FREE);
        mockListMyPhotos.mockRejectedValue(new Error("down"));
        const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
        await expect(T.grantLabelQuietly(UID, photo("p1"), "test")).resolves.toEqual({ label: null, labelSkipped: "error", coin: 0 });
        err.mockRestore();
    });

    it("再送の経路（requireNew）は、機能を出す前に作られた写真に配らない", async () => {
        setProfile(FREE);
        expect((await T.grantLabelQuietly(UID, photo("p1", { createdAt: "2026-09-01T00:00:00.000Z" }), "t", { requireNew: true })).labelSkipped).toBe("notNew");
        expect((await T.grantLabelQuietly(UID, photo("p2", { createdAt: new Date().toISOString() }), "t", { requireNew: true })).label?.id).toBe("p2");
    });

    it("渡された写真の一覧を使う（もう一度読まない）", async () => {
        setProfile(FREE);
        const out = await T.grantLabelQuietly(UID, photo("p1"), "t", { photos: Promise.resolve([photo("o1"), photo("o2")]) });
        expect(mockListMyPhotos).not.toHaveBeenCalled();
        expect(out.label?.milestone).toBeUndefined();   // 3件目＝節目でない
    });

    it("1行の大きさ: 越えるなら配らない（storage・full と分ける）・貼らない（409 storage）", async () => {
        setProfile(PRO);
        const big = Array.from({ length: 160 }, (_, i) => label(`s${i}`, { place: { name: "あ".repeat(900) } }));
        setTrunk({ pocket: [label("a")], stuck: big });
        expect((await grantLabel(UID, photo("p1"))).labelSkipped).toBe("storage");
        const r = await call("POST /user/trunk/labels/{id}/stick", { id: "a" });
        expect(r.status).toBe(409);
        expect(r.json.code).toBe("storage");
    });

    it("いちばん大きい行（手持ち149＋貼った1200（置き場つき）＋台帳3000×2＋部品108・かけら・硬貨）でも、もう1枚配れる", () => {
        const real = (id: string) => ({
            ...label(id, { place: { name: "高屋神社・天空の鳥居", latin: "Takaya Shrine", country: "日本" } }),
            season: "autumn", timeslot: "dawn", foil: true, groupId: T.groupKey(`trip-${id}-0000-0000-0000-000000000000`),
            id: `${id}`.padEnd(36, "0"), seed: 2_147_000_000,
        });
        const doc = parseTrunk({
            pocket: Array.from({ length: 149 }, (_, i) => real(`p${i}`)),
            // 置き場はいちばん長い桁（0.999・-30 度＝保存の形で [999, 999, -300]）にする
            stuck: Array.from({ length: 1200 }, (_, i) => ({ ...real(`s${i}`), pos: { x: 0.999, y: 0.999, rot: -30 } })),
            dealt: Array.from({ length: 3000 }, (_, i) => `x:${String(i).padStart(12, "0")}`),
            coins: 98,
            coinLog: Array.from({ length: 20 }, (_, i) => ({ k: `g:${String(i).padStart(12, "0")}`, a: 1_800_000_000 })),
            parts: TRUNK_PARTS.map((p) => p.id),
            fragments: 99_999,
            equipped: {
                handle: "handle.12", corner: "corner.12", lock: "lock.12", lining: "lining.12", tag: "tag.12", charm: "charm.12",
                key: "key.12", pins: ["pin.10", "pin.11", "pin.12"], patches: ["patch.11", "patch.12"],
            },
            groups: Array.from({ length: 3000 }, (_, i) => `g:${String(i).padStart(12, "0")}`),
            milestones: ["first", "posts10", "posts50", "posts100", ...Array.from({ length: 50 }, (_, i) => `firstCountry:国${i}`)],
        });
        expect(doc.stuck[0].pos).toEqual({ x: 0.999, y: 0.999, rot: -30 });
        expect(doc.parts).toHaveLength(108);
        expect(doc.equipped.pins).toHaveLength(3);
        const r = dealInto(doc, { ...real("new"), groupId: undefined } as never, 150, "x:new000000000", new Date());
        expect(r.outcome.labelSkipped).toBeUndefined();
        expect(r.outcome.coin).toBe(1);
        expect(r.doc).not.toBeNull();
        // 2行に分けたあとの大きさ（2026-10-17 実測: 持ち物 283,408B・台帳 103,949B。予算はどちらも 389,120B）
        const z = T.rowSizes(r.doc!);
        expect(z.main).toBeLessThan(T.TRUNK_BUDGET_BYTES - 100 * 1024);
        expect(z.ledger).toBeLessThan(T.TRUNK_BUDGET_BYTES - 250 * 1024);
    });

    it("台帳の行のいちばん大きい形（指紋3000・束3000・節目300・控え20）でも予算の内", () => {
        const doc = parseTrunk(undefined, {
            dealt: Array.from({ length: 3000 }, (_, i) => `x:${String(i).padStart(12, "0")}`),
            groups: Array.from({ length: 3000 }, (_, i) => `g:${String(i).padStart(12, "0")}`),
            milestones: Array.from({ length: 300 }, (_, i) => `firstCountry:${"ボスニア・ヘルツェゴビナ"}${i}`),
            coinLog: Array.from({ length: 20 }, (_, i) => ({ k: `${"p".repeat(64)}${i}`, a: 1_800_000_000 })),
            daily: { day: "2026-10-17", count: 3 },
        });
        expect(doc.dealt).toHaveLength(3000);
        expect(T.rowSizes(doc).ledger).toBeLessThan(T.TRUNK_BUDGET_BYTES - 250 * 1024);
    });

    it("photoId は保存しない（応答では id から埋める）", async () => {
        setProfile(FREE);
        await grantLabel(UID, photo("p1"));
        expect((trunkRow()?.pocket as Item[])[0].photoId).toBeUndefined();
        const got = await call("GET /user/trunk");
        expect((got.json.pocket as Item[])[0].photoId).toBe("p1");
    });

    it("配った1枚（応答の label）に束の鍵を出さない", async () => {
        setProfile(FREE);
        const out = await grantLabel(UID, photo("p1", { groupId: "g-9" }));
        expect(out.label?.id).toBe("p1");
        expect((out.label as Item).groupId).toBeUndefined();
        // 配り済みを返す経路も同じ
        expect(((await grantLabel(UID, photo("p1", { groupId: "g-9" }))).label as Item).groupId).toBeUndefined();
    });

    it("貼ったら、そのラベルの選びかけの作り直しを外す", async () => {
        setProfile(PRO);
        setTrunk({ pocket: [label("a"), label("b")], stuck: [], pendingReroll: { labelId: "a", seeds: [1, 2, 3], at: "" } });
        await call("POST /user/trunk/labels/{id}/stick", { id: "b" });
        expect(trunkRow()?.pendingReroll).toEqual({ labelId: "a", seeds: [1, 2, 3], at: "" });
        const r = await call("POST /user/trunk/labels/{id}/stick", { id: "a" });
        expect(r.json.pendingReroll).toBeUndefined();
        expect(trunkRow()?.pendingReroll).toBeUndefined();
    });
});

describe("保存の形（短い鍵）", () => {
    it("書いて読むと元の形に戻る", async () => {
        setProfile(FREE);
        const p1 = photo("p1", {
            location: "Helsinki, フィンランド", date: "2026-01-10", exif: { dateTimeOriginal: "2026:01:10 05:00:00" }, groupId: "g-1",
        });
        // 写真の行も置く（印を付けたあとに読み直して確かめる・GET の突き合わせが一覧で見る）
        store.set(`photos-test|p1`, p1 as unknown as Item);
        mockListMyPhotos.mockResolvedValue([p1]);
        const out = await grantLabel(UID, p1, new Date("2026-10-17T00:00:00.123Z"), (a, b) => (b === 10_000 ? 0 : 77));
        const raw = (trunkRow()?.pocket as Item[])[0];
        expect(raw.i).toBe("p1");
        expect(raw.id).toBeUndefined();
        const back = ((await call("GET /user/trunk")).json.pocket as Item[])[0];
        expect(back).toEqual(out.label);
        expect(back).toMatchObject({ id: "p1", photoId: "p1", seed: 77, foil: true, at: "2026-10-17T00:00:00.000Z" });
    });
});

// ─── 次の版（2026-10-17 owner「いいよ」）: 自分の手で貼る・硬貨とカプセル・部品を付ける ───

const stuckRaw = () => (trunkRow()?.stuck ?? []) as Item[];

describe("置き場（貼る・置き直す）", () => {
    it("貼るときに { x, y, rot } を渡すと置き場を持つ。無ければ置き場なし（おまかせ）", async () => {
        setProfile(FREE);
        setTrunk({ pocket: [label("a"), label("b")], stuck: [] });
        const r = await call("POST /user/trunk/labels/{id}/stick", { id: "a", body: { x: 0.25, y: 0.5, rot: -12.5 } });
        expect(r.status).toBe(200);
        expect((r.json.stuck as Item[])[0]).toMatchObject({ id: "a", pos: { x: 0.25, y: 0.5, rot: -12.5 } });
        // 保存は整数3つ（x×1000・y×1000・rot×10）
        expect(stuckRaw()[0].p).toEqual([250, 500, -125]);
        const r2 = await call("POST /user/trunk/labels/{id}/stick", { id: "b" });
        expect((r2.json.stuck as Item[])[0].pos).toBeUndefined();
        expect(stuckRaw()[0].p).toBeUndefined();
        // 読み直しても同じ
        expect(((await call("GET /user/trunk")).json.stuck as Item[])[1].pos).toEqual({ x: 0.25, y: 0.5, rot: -12.5 });
    });

    it("範囲の両端（0・1・±30）は通る。外れ・数でない・3つそろわないは 400 badPlace", async () => {
        setProfile(FREE);
        setTrunk({ pocket: [label("a")], stuck: [label("s")] });
        for (const ok of [{ x: 0, y: 0, rot: -30 }, { x: 1, y: 1, rot: 30 }]) {
            expect((await call("PUT /user/trunk/labels/{id}/place", { id: "s", body: ok })).status).toBe(200);
        }
        const bad = [
            { x: 1.001, y: 0.5, rot: 0 }, { x: -0.001, y: 0.5, rot: 0 }, { x: 0.5, y: 1.5, rot: 0 }, { x: 0.5, y: -1, rot: 0 },
            { x: 0.5, y: 0.5, rot: 30.1 }, { x: 0.5, y: 0.5, rot: -31 }, { x: 0.5, y: 0.5 }, { x: "0.5", y: 0.5, rot: 0 },
            { x: 0.5, y: 0.5, rot: null },
        ];
        for (const b of bad) {
            const r = await call("PUT /user/trunk/labels/{id}/place", { id: "s", body: b });
            expect([r.status, r.json.code, b]).toEqual([400, "badPlace", b]);
            const st = await call("POST /user/trunk/labels/{id}/stick", { id: "a", body: b });
            expect([st.status, st.json.code]).toEqual([400, "badPlace"]);
        }
        // 外れた回は何も変わっていない（手持ちのまま）
        expect(pocketIds()).toEqual(["a"]);
        expect((await call("PUT /user/trunk/labels/{id}/place", { id: "s" })).json.code).toBe("badPlace");
    });

    it("置き直し: 貼ったものだけ。手持ちは 409 notStuck・無いものは 404", async () => {
        setProfile(FREE);
        setTrunk({ pocket: [label("a")], stuck: [label("s"), label("t")] });
        const r = await call("PUT /user/trunk/labels/{id}/place", { id: "t", body: { x: 0.1234, y: 0.9, rot: 5.55 } });
        expect(r.status).toBe(200);
        // 保存の細かさに丸める（x・y は3桁・rot は1桁）
        expect((r.json.stuck as Item[]).find((l) => l.id === "t")?.pos).toEqual({ x: 0.123, y: 0.9, rot: 5.6 });
        expect((r.json.stuck as Item[]).find((l) => l.id === "s")?.pos).toBeUndefined();
        const p = await call("PUT /user/trunk/labels/{id}/place", { id: "a", body: { x: 0.5, y: 0.5, rot: 0 } });
        expect([p.status, p.json.code]).toEqual([409, "notStuck"]);
        expect((await call("PUT /user/trunk/labels/{id}/place", { id: "zz", body: { x: 0.5, y: 0.5, rot: 0 } })).status).toBe(404);
    });
});

describe("はがす（POST /user/trunk/labels/{id}/unstick）", () => {
    it("貼った方から手持ちのいちばん上へ戻す。置き場は消える。手持ちに在れば何もしない", async () => {
        setProfile(FREE);
        setTrunk({ pocket: [label("a")], stuck: [label("s", { pos: { x: 0.5, y: 0.5, rot: 3 } })] });
        const r = await call("POST /user/trunk/labels/{id}/unstick", { id: "s" });
        expect(r.status).toBe(200);
        expect((r.json.pocket as Item[]).map((l) => l.id)).toEqual(["s", "a"]);
        expect((r.json.pocket as Item[])[0].pos).toBeUndefined();
        expect(r.json.stuck).toEqual([]);
        const again = await call("POST /user/trunk/labels/{id}/unstick", { id: "s" });
        expect(again.status).toBe(200);
        expect(pocketIds()).toEqual(["s", "a"]);
        expect((await call("POST /user/trunk/labels/{id}/unstick", { id: "zz" })).status).toBe(404);
    });

    it("手持ちが上限なら 409 full（無料 30・Pro は 150）", async () => {
        setProfile(FREE);
        setTrunk({ pocket: Array.from({ length: 30 }, (_, i) => label(`a${i}`)), stuck: [label("s")] });
        const r = await call("POST /user/trunk/labels/{id}/unstick", { id: "s" });
        expect([r.status, r.json.code]).toEqual([409, "full"]);
        expect(stuckRaw()).toHaveLength(1);
        setTrunk({ pocket: Array.from({ length: 29 }, (_, i) => label(`a${i}`)), stuck: [label("s")] });
        expect((await call("POST /user/trunk/labels/{id}/unstick", { id: "s" })).status).toBe(200);
        setProfile(PRO);
        setTrunk({ pocket: Array.from({ length: 30 }, (_, i) => label(`a${i}`)), stuck: [label("s")] });
        expect((await call("POST /user/trunk/labels/{id}/unstick", { id: "s" })).status).toBe(200);
    });

    it("はがしたあとも24時間の取り消しは今までどおり", async () => {
        setProfile(FREE);
        await grantLabel(UID, photo("p1"));
        await call("POST /user/trunk/labels/{id}/stick", { id: "p1", body: { x: 0.5, y: 0.5, rot: 0 } });
        await call("POST /user/trunk/labels/{id}/unstick", { id: "p1" });
        await T.revokeLabelQuietly(UID, { id: "p1", createdAt: new Date().toISOString() }, "test");
        expect(pocketIds()).toEqual([]);
    });
});

describe("硬貨（公開の投稿1件につき1枚）", () => {
    const exif = (t: string) => ({ exif: { dateTimeOriginal: t, camera: "X", imageSize: "1x1" } });
    const coins = () => trunkRow()?.coins;

    it("公開の投稿で1枚。GET に coins が出る。下書きには配らない", async () => {
        setProfile(FREE);
        expect((await grantLabel(UID, photo("p1"))).coin).toBe(1);
        expect((await grantLabel(UID, photo("d1", { published: false }))).coin).toBe(0);
        const got = await call("GET /user/trunk");
        expect(got.json.coins).toBe(1);
    });

    it("歯止めはラベルと同じ: 再送・指紋・束・1日3件では配らない", async () => {
        setProfile(FREE);
        expect((await grantLabel(UID, photo("p1", exif("2026:01:01 00:00:00")))).coin).toBe(1);
        expect((await grantLabel(UID, photo("p1", exif("2026:01:01 00:00:00")))).coin).toBe(0);   // 再送
        expect((await grantLabel(UID, photo("p9", exif("2026:01:01 00:00:00")))).coin).toBe(0);   // 同じ写真の上げ直し
        expect((await grantLabel(UID, photo("g1", { groupId: "trip" }))).coin).toBe(1);
        expect((await grantLabel(UID, photo("g2", { groupId: "trip" }))).coin).toBe(0);           // 同じ束
        expect((await grantLabel(UID, photo("p2"))).coin).toBe(1);
        expect((await grantLabel(UID, photo("p3"))).coin).toBe(0);                                // 4件目
        expect(coins()).toBe(3);
    });

    it("機能を出す前に作った写真（notNew）には配らない", async () => {
        setProfile(FREE);
        const out = await T.grantLabelQuietly(UID, photo("p1", { createdAt: "2026-09-01T00:00:00.000Z" }), "t", { requireNew: true });
        expect(out).toEqual({ label: null, labelSkipped: "notNew", coin: 0 });
        expect(trunkRow()).toBeUndefined();
    });

    it("手持ちがいっぱいでも配る（ラベルは full）", async () => {
        setProfile(FREE);
        setTrunk({ pocket: Array.from({ length: 30 }, (_, i) => label(`a${i}`)), stuck: [] });
        expect(await grantLabel(UID, photo("p1"))).toEqual({ label: null, labelSkipped: "full", coin: 1 });
        expect(coins()).toBe(1);
        expect(pocketIds()).toHaveLength(30);
        // 硬貨を配った投稿は台帳に載る（同じ写真の再送でもう1枚にならない）
        expect((await grantLabel(UID, photo("p1"))).coin).toBe(0);
    });

    it("受け取らない設定でも配る（受け取らない設定はラベルのこと）。上げ直しでは配らない", async () => {
        setProfile(FREE);
        await call("PUT /user/trunk/settings", { body: { receiveLabels: false } });
        expect(await grantLabel(UID, photo("p1", exif("2026:02:02 00:00:00")))).toEqual({ label: null, labelSkipped: "off", coin: 1 });
        expect(await grantLabel(UID, photo("p2", exif("2026:02:02 00:00:00")))).toEqual({ label: null, labelSkipped: "off", coin: 0 });
        expect(pocketIds()).toEqual([]);
        expect(coins()).toBe(1);
    });

    it("99 枚が上限（超えたら配らない・ラベルは配る）。99 枚で手持ちもいっぱいなら何も書かない", async () => {
        setProfile(FREE);
        setTrunk({ pocket: [], stuck: [], coins: 98 });
        expect((await grantLabel(UID, photo("p1"))).coin).toBe(1);
        expect(coins()).toBe(99);
        const out = await grantLabel(UID, photo("p2"));
        expect(out.coin).toBe(0);
        expect(out.label?.id).toBe("p2");
        expect(coins()).toBe(99);
        expect(T.COINS_MAX).toBe(99);
        store.delete(`photos-test|${T.trunkLedgerId(UID)}`);
        setTrunk({ pocket: Array.from({ length: 30 }, (_, i) => label(`a${i}`)), stuck: [], coins: 99, dealt: [] });
        expect(await grantLabel(UID, photo("p3"))).toEqual({ label: null, labelSkipped: "full", coin: 0 });
        // 何も書かない（古い形の1行のまま・台帳の行も作らない）
        expect(trunkRow()?.rev).toBe(1);
        expect(ledgerRow()).toBeUndefined();
        // 保存された値が上限より大きくても 99 に読む
        expect(parseTrunk({ coins: 500 }).coins).toBe(99);
    });

    it("24時間以内の削除で1枚戻す（ラベルも取り消す）。使っていたら（0 枚）何もしない。24時間を過ぎたら戻さない", async () => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-10-20T00:00:00Z"));
        setProfile(FREE);
        const at = new Date().toISOString();
        await grantLabel(UID, photo("p1", { createdAt: at }));
        await grantLabel(UID, photo("p2", { createdAt: at }));
        expect(coins()).toBe(2);
        await T.revokeLabelQuietly(UID, { id: "p1", createdAt: at }, "test");
        expect(coins()).toBe(1);
        expect(pocketIds()).toEqual(["p2"]);
        // 同じ写真の取り消しが二度来ても、二度は減らさない
        await T.revokeLabelQuietly(UID, { id: "p1", createdAt: at }, "test");
        expect(coins()).toBe(1);
        // 使った（0 枚）→ 取り消しても 0 のまま
        await call("POST /user/trunk/gacha");
        expect(coins()).toBe(0);
        await T.revokeLabelQuietly(UID, { id: "p2", createdAt: at }, "test");
        expect(coins()).toBe(0);
        expect(pocketIds()).toEqual([]);
        expect(ledgerRow()?.coinLog).toEqual([]);
        // 24時間を過ぎた投稿は戻さない
        vi.setSystemTime(new Date("2026-10-21T00:00:00Z"));
        const at2 = new Date().toISOString();
        await grantLabel(UID, photo("p3", { createdAt: at2 }));
        vi.setSystemTime(new Date("2026-10-22T00:00:01Z"));
        await T.revokeLabelQuietly(UID, { id: "p3", createdAt: at2 }, "test");
        expect(coins()).toBe(1);
        expect(pocketIds()).toEqual(["p3"]);
    });

    it("ラベルの無い投稿（受け取らない設定・手持ちいっぱい）でも、24時間以内の削除で硬貨を戻す。束は束の鍵で見る", async () => {
        setProfile(FREE);
        await call("PUT /user/trunk/settings", { body: { receiveLabels: false } });
        await grantLabel(UID, photo("p1", { groupId: "trip" }));
        expect(coins()).toBe(1);
        // 束の写真がまだ公開で残っている → 戻さない
        store.set("photos-test|p2", photo("p2", { groupId: "trip" }) as Item);
        mockListMyPhotos.mockResolvedValue([photo("p2", { groupId: "trip" })]);
        await T.revokeLabelQuietly(UID, { id: "p1", groupId: "trip", createdAt: new Date().toISOString() }, "test");
        expect(coins()).toBe(1);
        store.delete("photos-test|p2");
        await T.revokeLabelQuietly(UID, { id: "p2", groupId: "trip", createdAt: new Date().toISOString() }, "test");
        expect(coins()).toBe(0);
    });

    it("お金で買う口は無い（ガチャ・交換・付けるだけ）", () => {
        // handler は知らない口を 404 にする（硬貨を足す口は投稿の配りだけ）
        return call("POST /user/trunk/coins/buy", { id: "x" }).then((r) => expect(r.status).toBe(404));
    });
});

describe("ガチャ（POST /user/trunk/gacha）", () => {
    it("段の境目: 0〜69 ふつう・70〜94 めずらしい・95〜99 とてもめずらしい（70/25/5）", async () => {
        const { rarityOfRoll, RARITY_WEIGHTS } = await import("../trunkParts");
        expect([0, 69, 70, 94, 95, 99].map(rarityOfRoll)).toEqual([0, 0, 1, 1, 2, 2]);
        const n = [0, 0, 0];
        for (let i = 0; i < 100; i++) n[rarityOfRoll(i)]++;
        expect(n).toEqual([70, 25, 5]);
        expect(RARITY_WEIGHTS).toEqual([70, 25, 5]);
    });

    it("段を引いてから、その段の部品を等確率で（乱数を差し替えて）", async () => {
        const { PARTS_BY_RARITY } = await import("../trunkParts");
        const seq = (tierRoll: number, pick: number): import("../trunk").Rand => (a, b) => (b === 100 ? tierRoll : Math.min(pick, b - 1));
        expect(T.rollGacha(seq(69, 0))).toEqual({ tier: 0, pick: 0 });
        expect(T.rollGacha(seq(70, 3))).toEqual({ tier: 1, pick: 3 });
        expect(T.rollGacha(seq(95, 99))).toEqual({ tier: 2, pick: PARTS_BY_RARITY[2].length - 1 });
        // 部品を引く乱数の幅は、その段の部品の数（等確率）
        const widths: number[] = [];
        T.rollGacha((a, b) => { widths.push(b); return b === 100 ? 96 : 0; });
        expect(widths).toEqual([100, PARTS_BY_RARITY[2].length]);
        expect(PARTS_BY_RARITY.map((l) => l.length)).toEqual([54, 42, 12]);
    });

    it("持っていない部品は部品箱へ・硬貨を1枚使う", async () => {
        setProfile(FREE);
        setTrunk({ pocket: [], stuck: [], coins: 2 });
        const r = await call("POST /user/trunk/gacha");
        expect(r.status).toBe(200);
        expect(r.json).toMatchObject({ duplicate: false, fragments: 0, coins: 1 });
        const part = r.json.part as { id: string; kind: string; rarity: number; name: string };
        expect(typeof part.name).toBe("string");
        expect(trunkRow()?.parts).toEqual([part.id]);
        expect((await call("GET /user/trunk")).json).toMatchObject({ coins: 1, parts: [part.id], fragments: 0 });
    });

    it("持っている部品が出たら「かけら」+1（部品箱は増えない）", async () => {
        setProfile(FREE);
        const all = TRUNK_PARTS.map((p) => p.id);
        setTrunk({ pocket: [], stuck: [], coins: 1, parts: all, fragments: 2 });
        const r = await call("POST /user/trunk/gacha");
        expect(r.json).toMatchObject({ duplicate: true, fragments: 3, coins: 0 });
        expect(trunkRow()?.parts).toHaveLength(108);
    });

    it("硬貨が 0 なら 409 noCoins（何も変えない）", async () => {
        setProfile(FREE);
        setTrunk({ pocket: [], stuck: [], coins: 0, fragments: 1 });
        const r = await call("POST /user/trunk/gacha");
        expect([r.status, r.json.code]).toEqual([409, "noCoins"]);
        expect(trunkRow()?.fragments).toBe(1);
        expect((await call("POST /user/trunk/gacha", { sub: "nobody" })).status).toBe(409);
    });
});

describe("部品の台帳（data/trunkParts.json）", () => {
    it("9種類×12点・id は <kind>.<1〜12>・板の並びどおり", () => {
        expect(TRUNK_PARTS).toHaveLength(108);
        const kinds = ["handle", "corner", "lock", "lining", "tag", "pin", "patch", "charm", "key"];
        for (const k of kinds) {
            expect(TRUNK_PARTS.filter((p) => p.kind === k).map((p) => p.id)).toEqual(Array.from({ length: 12 }, (_, i) => `${k}.${i + 1}`));
        }
        expect(new Set(TRUNK_PARTS.map((p) => p.id)).size).toBe(108);
        // 板（Parts.dc.html）の行を幾つか写して見る
        const at = (id: string) => TRUNK_PARTS.find((p) => p.id === id);
        expect(at("handle.1")).toEqual({ id: "handle.1", kind: "handle", rarity: 0, name: "茶の革" });
        expect(at("handle.11")).toMatchObject({ rarity: 2, name: "黒檀の握り" });
        expect(at("lock.2")).toMatchObject({ rarity: 1, name: "菊" });
        expect(at("lining.12")).toMatchObject({ rarity: 2, name: "金襴" });
        expect(at("key.12")).toMatchObject({ rarity: 2, name: "金の鍵" });
        expect(TRUNK_PARTS.every((p) => [0, 1, 2].includes(p.rarity) && p.name.length > 0)).toBe(true);
    });
});

describe("交換（POST /user/trunk/parts/exchange）", () => {
    it("かけら5つで持っていない部品1つ", async () => {
        setProfile(FREE);
        setTrunk({ pocket: [], stuck: [], fragments: 6 });
        const r = await call("POST /user/trunk/parts/exchange", { body: { partId: "charm.12" } });
        expect(r.status).toBe(200);
        expect(r.json).toMatchObject({ fragments: 1, parts: ["charm.12"], part: { id: "charm.12", kind: "charm", rarity: 2 } });
        expect(T.FRAGMENTS_PER_EXCHANGE).toBe(5);
    });

    it("4つでは 409 notEnoughFragments・持っていれば 409 owned・知らない id は 400 badPart", async () => {
        setProfile(FREE);
        setTrunk({ pocket: [], stuck: [], fragments: 4, parts: ["pin.1"] });
        const few = await call("POST /user/trunk/parts/exchange", { body: { partId: "pin.2" } });
        expect([few.status, few.json.code]).toEqual([409, "notEnoughFragments"]);
        setTrunk({ pocket: [], stuck: [], fragments: 10, parts: ["pin.1"] });
        const owned = await call("POST /user/trunk/parts/exchange", { body: { partId: "pin.1" } });
        expect([owned.status, owned.json.code]).toEqual([409, "owned"]);
        for (const partId of ["pin.13", "pin.0", "", 3, undefined]) {
            const bad = await call("POST /user/trunk/parts/exchange", { body: { partId } });
            expect([bad.status, bad.json.code]).toEqual([400, "badPart"]);
        }
        expect(trunkRow()?.fragments).toBe(10);
    });
});

describe("部品を付ける（PUT /user/trunk/equip）", () => {
    const own = ["handle.1", "handle.2", "corner.3", "pin.1", "pin.2", "pin.3", "pin.4", "patch.1", "patch.2", "patch.3", "key.5"];

    it("持っている部品を付ける。本文に無い場所はそのまま・null で外す。GET は全部の場所を並べる", async () => {
        setProfile(FREE);
        setTrunk({ pocket: [], stuck: [], parts: own });
        expect((await call("GET /user/trunk")).json.equipped).toEqual({
            handle: null, corner: null, lock: null, lining: null, tag: null, charm: null, key: null, pins: [], patches: [],
        });
        const r = await call("PUT /user/trunk/equip", { body: { handle: "handle.1", pins: ["pin.1", "pin.2", "pin.3"], patches: ["patch.1", "patch.2"] } });
        expect(r.status).toBe(200);
        expect(r.json.equipped).toMatchObject({ handle: "handle.1", corner: null, pins: ["pin.1", "pin.2", "pin.3"], patches: ["patch.1", "patch.2"] });
        const r2 = await call("PUT /user/trunk/equip", { body: { corner: "corner.3", handle: null, pins: null } });
        expect(r2.json.equipped).toMatchObject({ handle: null, corner: "corner.3", pins: [], patches: ["patch.1", "patch.2"] });
        // 型（model）とは別
        expect(r2.json.model).toBe("leather");
    });

    it("持っていない 409 notOwned・知らない id 400 badPart・場所と kind が違う 400 badKind", async () => {
        setProfile(FREE);
        setTrunk({ pocket: [], stuck: [], parts: own });
        const no = await call("PUT /user/trunk/equip", { body: { lock: "lock.1" } });
        expect([no.status, no.json.code]).toEqual([409, "notOwned"]);
        const unknown = await call("PUT /user/trunk/equip", { body: { handle: "handle.99" } });
        expect([unknown.status, unknown.json.code]).toEqual([400, "badPart"]);
        const kind = await call("PUT /user/trunk/equip", { body: { handle: "corner.3" } });
        expect([kind.status, kind.json.code]).toEqual([400, "badKind"]);
        const pinKind = await call("PUT /user/trunk/equip", { body: { pins: ["patch.1"] } });
        expect([pinKind.status, pinKind.json.code]).toEqual([400, "badKind"]);
        const notOwnedPin = await call("PUT /user/trunk/equip", { body: { pins: ["pin.9"] } });
        expect([notOwnedPin.status, notOwnedPin.json.code]).toEqual([409, "notOwned"]);
        expect(trunkRow()?.equipped).toBeUndefined();
    });

    it("pins は3つまで・patches は2つまで・同じ id を二度は 400", async () => {
        setProfile(PRO);   // Pro でも同じ（Pro 限定の部品は無い）
        setTrunk({ pocket: [], stuck: [], parts: own });
        expect((await call("PUT /user/trunk/equip", { body: { pins: ["pin.1", "pin.2", "pin.3", "pin.4"] } })).status).toBe(400);
        expect((await call("PUT /user/trunk/equip", { body: { patches: ["patch.1", "patch.2", "patch.3"] } })).status).toBe(400);
        expect((await call("PUT /user/trunk/equip", { body: { pins: ["pin.1", "pin.1"] } })).status).toBe(400);
        expect((await call("PUT /user/trunk/equip", { body: { pins: "pin.1" } })).status).toBe(400);
        expect((await call("PUT /user/trunk/equip", { body: { pins: ["pin.1", "pin.2", "pin.3"] } })).status).toBe(200);
        expect(T.PINS_MAX).toBe(3);
        expect(T.PATCHES_MAX).toBe(2);
    });

    it("保存の値が壊れていても、持っていない・kind 違いは読むときに落とす", () => {
        const doc = parseTrunk({ parts: ["handle.1", "pin.1", "nope.1"], equipped: { handle: "handle.2", corner: "handle.1", pins: ["pin.1", "pin.1", "handle.1"] } });
        expect(doc.parts).toEqual(["handle.1", "pin.1"]);
        expect(doc.equipped).toEqual({ pins: ["pin.1"], patches: [] });
    });

    it("退会の掃除は trunk# の行ごと消す（部品・硬貨・かけらも同じ1行にある）", () => {
        // 新しい行・新しい鍵を作っていない＝`account.ts` の `trunk#<uid>` の削除で足りる（`account.test.ts` が trunk#me を見る）
        const doc = parseTrunk({ coins: 3, parts: ["pin.1"], fragments: 2, equipped: { pins: ["pin.1"] } });
        expect(trunkId(UID)).toBe(`trunk#${UID}`);
        expect([doc.coins, doc.parts, doc.fragments]).toEqual([3, ["pin.1"], 2]);
    });
});

describe("口（serverless.yml の trunk 関数）", () => {
    it("handler が分ける口が全部 trunk 関数の道筋にある（新しい関数は作らない）", async () => {
        const fs = await import("fs");
        const path = await import("path");
        const yml = fs.readFileSync(path.join(__dirname, "..", "..", "serverless.yml"), "utf8");
        const block = yml.slice(yml.indexOf("\n  trunk:\n"), yml.indexOf("\n  getComments:\n"));
        const routes = [...block.matchAll(/path: (\S+)\n\s+method: (\w+)/g)].map((m) => `${m[2]} ${m[1]}`);
        for (const r of [
            "GET /user/trunk", "PUT /user/trunk/model", "PUT /user/trunk/settings",
            "POST /user/trunk/labels/{id}/stick", "DELETE /user/trunk/labels/{id}",
            "POST /user/trunk/labels/{id}/reroll", "POST /user/trunk/labels/{id}/reroll/choose",
            "PUT /user/trunk/labels/{id}/place", "POST /user/trunk/labels/{id}/unstick",
            "POST /user/trunk/gacha", "POST /user/trunk/parts/exchange", "PUT /user/trunk/equip",
            "GET /users/{uid}/trunk", "POST /user/trunk/welcome", "POST /user/trunk/reward",
        ]) expect(routes).toContain(r);
        expect(routes).toHaveLength(15);
        expect(block).toContain("handler: src/trunk.handler");
    });
});

describe("2行に分ける（trunk# と trunkledger#・2026-10-17）", () => {
    const txs = () => fakeSend.mock.calls.map((c) => c[0]).filter((c) => c.constructor.name === "TransactWriteCommand")
        .map((c) => (c.input as { TransactItems: Record<string, { Item?: Item; Key?: Item }>[] }).TransactItems);

    it("配ると、持ち物は trunk#・台帳は trunkledger# に、1つの TransactWriteItems で書く", async () => {
        setProfile(FREE);
        // 写真の行も置く（印を付けたあとの確かめで外さない＝書き込みは1回のまま）
        store.set(`photos-test|p1`, photo("p1") as unknown as Item);
        await grantLabel(UID, photo("p1"));
        expect(trunkRow()?.dealt).toBeUndefined();
        expect(trunkRow()?.coins).toBe(1);
        expect(pocketIds()).toEqual(["p1"]);
        expect(ledgerRow()?.dealt).toEqual([T.fingerprintOf(photo("p1"))]);
        expect(ledgerRow()?.pocket).toBeUndefined();
        expect(ledgerRow()?.uid).toBe(UID);
        const tx = txs();
        expect(tx).toHaveLength(1);
        expect(tx[0].map((t) => Object.keys(t)[0])).toEqual(["Put", "Put"]);
        // 単独の Put は使わない（片方だけ書ける隙を作らない）
        expect(fakeSend.mock.calls.some((c) => c[0].constructor.name === "PutCommand")).toBe(false);
    });

    it("持ち物だけ変わる口（貼る）は、台帳の行を ConditionCheck（rev 条件）にして Put しない", async () => {
        setProfile(FREE);
        await grantLabel(UID, photo("p1"));
        const ledgerRev = ledgerRow()?.rev;
        fakeSend.mockClear();
        await call("POST /user/trunk/labels/{id}/stick", { id: "p1" });
        const tx = txs();
        expect(tx[0].map((t) => Object.keys(t)[0])).toEqual(["Put", "ConditionCheck"]);
        expect(tx[0][1].ConditionCheck.Key).toEqual({ id: T.trunkLedgerId(UID) });
        expect(ledgerRow()?.rev).toBe(ledgerRev);
    });

    it("ConditionCheck も rev を見る（読んでから台帳の行が書き換わったら、やり直す）", async () => {
        setProfile(FREE);
        await grantLabel(UID, photo("p1"));
        let raced = false;
        fakeSend.mockClear();
        fakeSend.mockImplementation(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "TransactWriteCommand" && !raced) {
                raced = true;
                const k = `photos-test|${T.trunkLedgerId(UID)}`;
                store.set(k, { ...store.get(k)!, rev: (store.get(k)!.rev as number) + 1 });
            }
            return send(cmd as never);
        });
        await call("POST /user/trunk/labels/{id}/stick", { id: "p1" });
        expect(txs()).toHaveLength(2);
        expect(stuckRaw().map((l) => l.i)).toEqual(["p1"]);
    });

    it("古い形（台帳が trunk# の中）も読める。次に書くときに2行へ分ける", async () => {
        setProfile(FREE);
        const fp = T.fingerprintOf(photo("old"));
        setTrunk({ pocket: [label("a")], stuck: [], dealt: [fp], groups: ["g:abc"], milestones: ["first"], daily: { day: "2000-01-01", count: 3 } });
        // 読む: 古い台帳の指紋で止まる
        expect((await grantLabel(UID, photo("old"))).labelSkipped).toBe("duplicate");
        expect(ledgerRow()).toBeUndefined();
        // 書く（貼る）→ 分かれる。台帳の中身はそのまま移る
        await call("POST /user/trunk/labels/{id}/stick", { id: "a" });
        expect(trunkRow()?.dealt).toBeUndefined();
        expect(trunkRow()?.milestones).toBeUndefined();
        expect(ledgerRow()).toMatchObject({ dealt: [fp], groups: ["g:abc"], milestones: ["first"], daily: { day: "2000-01-01", count: 3 } });
        expect(txs().at(-1)!.map((t) => Object.keys(t)[0])).toEqual(["Put", "Put"]);
        // 分けたあとも同じ判定
        expect((await grantLabel(UID, photo("old"))).labelSkipped).toBe("duplicate");
    });

    it("台帳の行だけが先に書き換わっていたら、読み直してやり直す（日の数を取りこぼさない）", async () => {
        setProfile(FREE);
        await grantLabel(UID, photo("p1"));
        let raced = false;
        fakeSend.mockImplementation(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "TransactWriteCommand" && !raced) {
                raced = true;
                // 別の要求が先に台帳を書いた（rev が進む・日の数が増える）
                const k = `photos-test|${T.trunkLedgerId(UID)}`;
                const cur = store.get(k)!;
                store.set(k, { ...cur, rev: (cur.rev as number) + 1, daily: { ...(cur.daily as Item), count: 2 } });
            }
            return send(cmd as never);
        });
        await grantLabel(UID, photo("p2"));
        expect(raced).toBe(true);
        expect(pocketIds()).toEqual(["p2", "p1"]);
        expect((ledgerRow()?.daily as Item).count).toBe(3);
        expect(txs().length).toBeGreaterThanOrEqual(3);
    });

    it("競合が続いたら投げる（口は 503 busy）", async () => {
        setProfile(FREE);
        setTrunk({ pocket: [label("a")], stuck: [] });
        fakeSend.mockImplementation(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
            if (cmd.constructor.name === "TransactWriteCommand") throw Object.assign(new Error("tx"), { name: "TransactionCanceledException" });
            return send(cmd as never);
        });
        const r = await call("POST /user/trunk/labels/{id}/stick", { id: "a" });
        expect([r.status, r.json.code]).toEqual([503, "busy"]);
    });

    it("GET は2行を並べて読む（BatchGet は使わない）", async () => {
        setProfile(FREE);
        await grantLabel(UID, photo("p1"));
        fakeSend.mockClear();
        const got = await call("GET /user/trunk");
        expect(got.json.coins).toBe(1);
        const ids = fakeSend.mock.calls.map((c) => c[0]).filter((c) => c.constructor.name === "GetCommand").map((c) => (c.input as { Key: Item }).Key.id);
        expect(ids).toEqual(expect.arrayContaining([trunkId(UID), T.trunkLedgerId(UID)]));
        expect(fakeSend.mock.calls.some((c) => c[0].constructor.name === "BatchGetCommand")).toBe(false);
    });

    it("書く前の2行の読みは強い読み（ConsistentRead）", async () => {
        setProfile(FREE);
        await grantLabel(UID, photo("p1"));
        const reads = fakeSend.mock.calls.map((c) => c[0]).filter((c) => c.constructor.name === "GetCommand")
            .map((c) => c.input as { Key: Item; ConsistentRead?: boolean })
            .filter((i) => i.Key.id === trunkId(UID) || i.Key.id === T.trunkLedgerId(UID));
        expect(reads.length).toBeGreaterThanOrEqual(2);
        expect(reads.every((i) => i.ConsistentRead === true)).toBe(true);
    });
});

describe("配り始める線（TRUNK_LAUNCHED_AT）", () => {
    it("本番と同じ日本時間 2026-10-17 0:00。10/17 に作った写真は配る側", () => {
        expect(T.TRUNK_LAUNCHED_AT).toBe("2026-10-16T15:00:00.000Z");
        expect(T.createdAfterLaunch({ createdAt: "2026-10-16T16:00:00.000Z" })).toBe(true);   // 10/17 1:00 JST
        expect(T.createdAfterLaunch({ createdAt: "2026-10-16T14:59:59.000Z" })).toBe(false);
    });
});

describe("見直しで守りの無かった2か所（2026-10-17）", () => {
    it("古い形の行は、持ち物が変わらない書き込み（台帳だけの変化）でも trunk# を Put して台帳の項目を抜く", async () => {
        setProfile(FREE);
        const now = Math.floor(Date.now() / 1000);
        // 古い形: 台帳が trunk# の中。硬貨は使い切り（0 枚）＝取り消しで変わるのは台帳（coinLog）だけ
        setTrunk({ pocket: [], stuck: [], coins: 0, dealt: ["i:x"], coinLog: [{ k: "p1", a: now }], daily: { day: "2000-01-01", count: 1 } });
        fakeSend.mockClear();
        await T.revokeLabelQuietly(UID, { id: "p1", createdAt: new Date().toISOString() }, "test");
        const tx = fakeSend.mock.calls.map((c) => c[0]).filter((c) => c.constructor.name === "TransactWriteCommand")
            .map((c) => (c.input as { TransactItems: Record<string, unknown>[] }).TransactItems);
        expect(tx).toHaveLength(1);
        expect(tx[0].map((t) => Object.keys(t)[0])).toEqual(["Put", "Put"]);
        for (const k of ["dealt", "coinLog", "daily", "groups", "milestones"]) expect(trunkRow()?.[k]).toBeUndefined();
        expect(ledgerRow()).toMatchObject({ dealt: ["i:x"], coinLog: [], daily: { day: "2000-01-01", count: 1 } });
    });

    it("1行の大きさは台帳の行でも見る（台帳が予算を越えるなら配らない・書かない）", () => {
        const doc = parseTrunk({ pocket: [], stuck: [] }, {
            milestones: Array.from({ length: 300 }, (_, i) => `firstCountry:${"あ".repeat(500)}${i}`),
        });
        const z = T.rowSizes(doc);
        expect(z.main).toBeLessThan(10_000);
        expect(z.ledger).toBeGreaterThan(T.TRUNK_BUDGET_BYTES);
        const r = dealInto(doc, label("new") as never, 30, "i:new", new Date());
        expect(r.doc).toBeNull();
        expect(r.outcome).toEqual({ label: null, labelSkipped: "storage", coin: 0 });
    });
});

describe("とおまわり号の欄を落とさない（段1・2026-10-18）", () => {
    // 段2 の Lambda が書いた形（部品・旅の数・旅の日・贈り物／台帳の訪問・薪・贈った・同じ日の友達・数え直しの日・旅の控え）
    const CAMPER_MAIN = {
        parts: [{ id: "wheel.brass_spoke", at: "2026-10-20T00:00:00.000Z" }, { id: "sticker_edge.signed", at: "2026-10-21T00:00:00.000Z", by: "friend-1" }],
        trips: 7,
        tripDays: ["2026-10-20", "2026-10-19"],
        gifts: [{ from: "friend-1", part: "sticker_edge.signed", at: "2026-10-21T00:00:00.000Z" }],
    };
    const CAMPER_LEDGER = {
        camperVisits: [{ u: "friend-1", d: "2026-10-21" }],
        camperWood: [{ u: "friend-1", d: "2026-10-21" }, { u: "friend-2", d: "2026-10-21" }],
        camperGiven: [{ u: "friend-2", d: "2026-10-20" }],
        camperTripFriends: ["friend-1"],
        camperRecountDay: "2026-10-21",
        camperTripLog: [{ k: "g:abcdefabcdef", a: 1_800_000_000 }],
    };
    function setBoth() {
        setTrunk({ pocket: [label("a")], stuck: [], camper: structuredClone(CAMPER_MAIN) });
        store.set(`photos-test|${T.trunkLedgerId(UID)}`, { id: T.trunkLedgerId(UID), uid: UID, rev: 1, dealt: [], ...structuredClone(CAMPER_LEDGER) });
    }

    it("配る（2行とも Put）を通っても、trunk# の camper と台帳の camper* がそのまま残る", async () => {
        setProfile(FREE);
        setBoth();
        await grantLabel(UID, photo("p1"));
        expect(pocketIds()).toEqual(["p1", "a"]);
        expect(trunkRow()?.camper).toEqual(CAMPER_MAIN);
        expect(ledgerRow()).toMatchObject(CAMPER_LEDGER);
    });

    it("持ち物だけ変わる口（貼る）・設定・取り消しでも残る", async () => {
        setProfile(FREE);
        setBoth();
        await call("POST /user/trunk/labels/{id}/stick", { id: "a" });
        await call("PUT /user/trunk/settings", { body: { receiveLabels: false } });
        await T.revokeLabelQuietly(UID, { id: "a", createdAt: new Date().toISOString() }, "test");
        expect(trunkRow()?.receiveLabels).toBe(false);
        expect(trunkRow()?.camper).toEqual(CAMPER_MAIN);
        expect(ledgerRow()).toMatchObject(CAMPER_LEDGER);
    });

    it("古い形（台帳が trunk# の中）を2行に分けるときも残る", async () => {
        setProfile(FREE);
        setTrunk({ pocket: [label("a")], stuck: [], dealt: ["i:x"], camper: structuredClone(CAMPER_MAIN) });
        await call("POST /user/trunk/labels/{id}/stick", { id: "a" });
        expect(trunkRow()?.camper).toEqual(CAMPER_MAIN);
        expect(ledgerRow()?.dealt).toEqual(["i:x"]);
    });

    it("段2 で足しうる部品の id（図鑑にまだ無い）も形が合えば落とさない。形の違う要素は落とす", () => {
        const doc = parseTrunk({
            camper: {
                parts: [{ id: "future_kind.new_part", at: "x" }, { id: "BAD ID", at: "x" }, { id: "wheel.brass_spoke" }, "x",
                    { id: "future_kind.new_part", at: "dup" }],
                trips: -3,
                tripDays: ["2026-10-20", "10/20", "2026-10-20"],
                gifts: [{ from: "f#1", part: "", at: "x" }, { from: "f1", part: "", at: "x" }],
            },
        }, { camperVisits: [{ u: "f1", d: "bad" }, { u: "f1", d: "2026-10-20" }], camperRecountDay: 3 });
        expect(doc.camper?.parts).toEqual([{ id: "future_kind.new_part", at: "x" }]);
        expect(doc.camper?.trips).toBe(0);
        expect(doc.camper?.tripDays).toEqual(["2026-10-20"]);
        expect(doc.camper?.gifts).toEqual([{ from: "f1", part: "", at: "x" }]);
        expect(doc.camper?.visits).toEqual([{ u: "f1", d: "2026-10-20" }]);
        expect(doc.camper?.recountDay).toBeUndefined();
    });

    it("キャンピングカーに触れていない人の行は、書き戻しても camper の欄を作らない（今までと同じ形）", async () => {
        setProfile(FREE);
        await grantLabel(UID, photo("p1"));
        expect(trunkRow()?.camper).toBeUndefined();
        expect(Object.keys(ledgerRow()!).filter((k) => k.startsWith("camper"))).toEqual([]);
        expect(parseTrunk(trunkRow(), ledgerRow()).camper).toBeUndefined();
    });

    it("人のトランクの口（GET /users/{uid}/trunk）には出さない", async () => {
        store.set(`users-test|${UID}`, FREE);
        setBoth();
        const got = await T.readTheirTrunk("viewer-1", UID);
        expect(JSON.stringify(got)).not.toContain("camper");
        expect(JSON.stringify(got)).not.toContain("brass_spoke");
    });

    it("いちばん大きい行に camper の上限ぶんを足しても予算の内（持ち物・台帳とも）", () => {
        const real = (id: string) => ({
            ...label(id, { place: { name: "高屋神社・天空の鳥居", latin: "Takaya Shrine", country: "日本" } }),
            season: "autumn", timeslot: "dawn", foil: true, groupId: T.groupKey(`trip-${id}-0000-0000-0000-000000000000`),
            id: `${id}`.padEnd(36, "0"), seed: 2_147_000_000,
        });
        const uid = "00000000-0000-0000-0000-000000000000";
        const day = "2026-10-20";
        const doc = parseTrunk({
            pocket: Array.from({ length: 150 }, (_, i) => real(`p${i}`)),
            stuck: Array.from({ length: 1200 }, (_, i) => ({ ...real(`s${i}`), pos: { x: 0.999, y: 0.999, rot: -30 } })),
            coins: 99,
            parts: TRUNK_PARTS.map((p) => p.id),
            fragments: 99_999,
            camper: {
                parts: Array.from({ length: 64 }, (_, i) => ({ id: `sticker_edge.part_${String(i).padStart(30, "x")}`, at: "2026-10-20T00:00:00.000Z", by: uid })),
                trips: 99_999,
                tripDays: Array.from({ length: 60 }, (_, i) => `2026-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`),
                gifts: Array.from({ length: 40 }, () => ({ from: uid, part: "awning.rust_stripe", at: "2026-10-20T00:00:00.000Z" })),
            },
        }, {
            dealt: Array.from({ length: 3000 }, (_, i) => `x:${String(i).padStart(12, "0")}`),
            groups: Array.from({ length: 3000 }, (_, i) => `g:${String(i).padStart(12, "0")}`),
            milestones: Array.from({ length: 300 }, (_, i) => `firstCountry:${"ボスニア・ヘルツェゴビナ"}${i}`),
            coinLog: Array.from({ length: 20 }, (_, i) => ({ k: `${"p".repeat(64)}${i}`, a: 1_800_000_000 })),
            camperVisits: Array.from({ length: 300 }, () => ({ u: uid, d: day })),
            camperWood: Array.from({ length: 300 }, () => ({ u: uid, d: day })),
            camperGiven: Array.from({ length: 300 }, () => ({ u: uid, d: day })),
            camperTripFriends: Array.from({ length: 50 }, (_, i) => `${uid.slice(0, -2)}${String(i).padStart(2, "0")}`),
            camperRecountDay: day,
            camperTripLog: Array.from({ length: 20 }, (_, i) => ({ k: `${"p".repeat(64)}${i}`, a: 1_800_000_000 })),
        });
        expect(doc.camper?.parts).toHaveLength(64);
        expect(doc.camper?.visits).toHaveLength(300);
        const z = T.rowSizes(doc);
        // 2026-10-18 実測: 持ち物 296,982B・台帳 179,918B（予算はどちらも 389,120B。camper なしの最大は持ち物 283KB）
        expect(z.main).toBeLessThan(T.TRUNK_BUDGET_BYTES - 80 * 1024);
        expect(z.ledger).toBeLessThan(T.TRUNK_BUDGET_BYTES - 200 * 1024);
    });
});

/**
 * **退会した人（墓石）には配らない・書かせない**（2026-10-18）。
 *
 * 退会しても配ったトークンは期限まで通る。保存の口（`savePhoto`）が通ってしまうと
 * `grantLabelQuietly` → `grantLabel` → `updateTrunk` で、退会の掃除が消した `trunk#`・
 * `trunkledger#` が作り直される（掃除はもう走らない）。保存の口が 410 で止めるのに加えて、
 * 配る側でも墓石を見る（二重の守り）。
 */
describe("退会した人（墓石）", () => {
    const TOMB = { userId: UID, deletedAt: "2026-10-18T00:00:00.000Z" };
    const writes = () => fakeSend.mock.calls.filter(([c]) => c.constructor.name !== "GetCommand");

    it("grantLabel は配らない（trunk# も trunkledger# も作り直さない）", async () => {
        setProfile(TOMB);
        const out = await grantLabel(UID, photo("p1"));
        expect(out).toEqual({ label: null, labelSkipped: "deleted", coin: 0 });
        expect(writes()).toEqual([]);
        expect(trunkRow()).toBeUndefined();
        expect(ledgerRow()).toBeUndefined();
    });

    it("本人の行の射影に deletedAt が入る（入らないと墓石が見えず、上の守りが黙って死ぬ）", async () => {
        // 作り物の GetCommand は射影を無視して行を丸ごと返すので、上のテストだけでは
        // 射影から deletedAt が落ちても緑のまま。読みに渡した射影そのものを見る
        setProfile(FREE);
        await grantLabel(UID, photo("p1"));
        await call("GET /user/trunk");
        const userReads = fakeSend.mock.calls
            .map(([c]) => c.input as { TableName?: string; ProjectionExpression?: string })
            .filter((i) => i.TableName === "users-test");
        expect(userReads.length).toBeGreaterThanOrEqual(2);
        for (const r of userReads) expect(r.ProjectionExpression ?? "").toMatch(/\bdeletedAt\b/);
    });

    it("口は 410（書く口も、控えを書き直す GET /user/trunk も）。何も書かない", async () => {
        setProfile(TOMB);
        setTrunk({ pocket: [label("a")], stuck: [] });
        fakeSend.mockClear();
        for (const [route, id, body] of [
            ["GET /user/trunk", undefined, undefined],
            ["POST /user/trunk/labels/{id}/stick", "a", undefined],
            ["PUT /user/trunk/model", undefined, { model: "classic" }],
            ["POST /user/trunk/gacha", undefined, undefined],
        ] as const) {
            const r = await call(route, { id, body });
            expect(r.status, route).toBe(410);
        }
        expect(writes()).toEqual([]);
    });

    it("ラベルを外す（DELETE）は削除の系統として止めない", async () => {
        setProfile(TOMB);
        setTrunk({ pocket: [label("a")], stuck: [] });
        expect((await call("DELETE /user/trunk/labels/{id}", { id: "a" })).status).toBe(200);
    });

    it("生きている人はこれまでどおり", async () => {
        setProfile(FREE);
        setTrunk({ pocket: [label("a")], stuck: [] });
        expect((await call("POST /user/trunk/labels/{id}/stick", { id: "a" })).status).toBe(200);
    });
});
