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
        const cur = store.get(k);
        const want = input.ExpressionAttributeValues?.[":rev"];
        const cond = input.ConditionExpression ?? "";
        const okCond = cond.includes("attribute_not_exists(rev)")
            ? !cur || cur.rev === undefined || cur.rev === want
            : cur?.rev === want;
        if (cond && !okCond) throw Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
        store.set(k, structuredClone(input.Item!));
        return {};
    }
    throw new Error(`想定外の命令 ${cmd.constructor.name}`);
}

const T = await import("../trunk");
const { handler, grantLabel, buildLabel, dealInto, parseTrunk, trunkId } = T;
import type { Photo } from "../types";

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
const pocketIds = () => ((trunkRow()?.pocket ?? []) as { id: string }[]).map((l) => l.id);

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
        expect(out).toEqual({ label: null, labelSkipped: "full" });
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
        expect(second).toEqual({ label: null, labelSkipped: "samePost" });
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
        await T.revokeLabelQuietly(UID, "p1", first.createdAt, "test");
        expect(pocketIds()).toEqual([]);
        // 上げ直すと別の id になる。中身（EXIF）は同じ
        const again = await grantLabel(UID, photo("p9", exif("2026:10:01 10:00:00")));
        expect(again).toEqual({ label: null, labelSkipped: "duplicate" });
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
        expect(trunkRow()?.daily).toEqual({ day: "2026-10-18", count: 1 });
    });

    it("取り消しても日の枠は戻らない", async () => {
        setProfile(FREE);
        const now = new Date().toISOString();
        for (const id of ["a", "b", "c"]) await grantLabel(UID, photo(id));
        await T.revokeLabelQuietly(UID, "c", now, "test");
        expect((await grantLabel(UID, photo("d"))).labelSkipped).toBe("daily");
    });

    it("投稿から24時間以内の削除で手持ちから消える。貼ったもの・24時間を過ぎたものは残る", async () => {
        setProfile(FREE);
        const now = Date.now();
        setTrunk({ pocket: [label("new"), label("old")], stuck: [label("st")] });
        await T.revokeLabelQuietly(UID, "new", new Date(now - 23 * 3_600_000).toISOString(), "test");
        await T.revokeLabelQuietly(UID, "old", new Date(now - 25 * 3_600_000).toISOString(), "test");
        await T.revokeLabelQuietly(UID, "st", new Date(now).toISOString(), "test");
        expect(pocketIds()).toEqual(["old"]);
        expect((trunkRow()?.stuck as Item[]).map((l) => l.id)).toEqual(["st"]);
        expect(T.REVOKE_WINDOW_MS).toBe(24 * 3_600_000);
    });

    it("取り消しは投げない（行が無い・読めない）", async () => {
        await expect(T.revokeLabelQuietly(UID, "x", undefined, "test")).resolves.toBeUndefined();
        fakeSend.mockRejectedValue(new Error("down"));
        const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
        await expect(T.revokeLabelQuietly(UID, "x", undefined, "test")).resolves.toBeUndefined();
        err.mockRestore();
    });

    it("台帳は最新3000件（古い順に落とす）", async () => {
        setProfile(FREE);
        setTrunk({ pocket: [], stuck: [], dealt: Array.from({ length: 3000 }, (_, i) => `x:old${i}`) });
        await grantLabel(UID, photo("p1"));
        const dealt = trunkRow()?.dealt as string[];
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
        expect(await grantLabel(UID, photo("p1"))).toEqual({ label: null, labelSkipped: "off" });
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
