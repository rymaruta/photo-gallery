import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * とおまわり号の要サーバーの部品（`camper.ts`・`trunk.ts` の口）。2026-10-18 owner 承認の設計案・段2。
 *
 * DynamoDB は `trunk.test.ts` と同じく**中身を持つ作り物**（読む → rev 条件で書くを本当に通す）。
 * フォロー・ブロックの印も同じ表の行として置く（`follow#<相手>#<自分>`・`block#<する人>#<される人>`）。
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
    await new Promise((r) => setTimeout(r, 0));
    const input = cmd.input as { TableName: string; Key?: Item; Item?: Item; ConditionExpression?: string; ExpressionAttributeValues?: Item };
    if (cmd.constructor.name === "GetCommand") {
        const v = store.get(keyOf(input.TableName, input.Key!));
        return { Item: v ? structuredClone(v) : undefined };
    }
    if (cmd.constructor.name === "TransactWriteCommand") {
        const items = (cmd.input as { TransactItems: { Put?: typeof input; ConditionCheck?: typeof input }[] }).TransactItems;
        const keyed = items.map((t) => {
            const op = (t.Put ?? t.ConditionCheck)!;
            return { op, put: !!t.Put, k: keyOf(op.TableName, (t.Put ? op.Item : op.Key)!) };
        });
        if (keyed.some(({ k, op }) => !condHolds(k, op))) {
            throw Object.assign(new Error("tx"), { name: "TransactionCanceledException" });
        }
        for (const { k, op, put } of keyed) if (put) store.set(k, structuredClone(op.Item!));
        return {};
    }
    if (cmd.constructor.name === "PutCommand") {
        store.set(keyOf(input.TableName, input.Item!), structuredClone(input.Item!));
        return {};
    }
    // 写真の索引（`userId-createdAt-index`）。`createdAt >= 線` の問い合わせとストーリーの絞り込みを本当に通す
    if (cmd.constructor.name === "QueryCommand") {
        const v = input.ExpressionAttributeValues!;
        return { Items: indexed.filter((p) => p.userId === v[":u"] && typeof p.createdAt === "string" && p.createdAt >= String(v[":t"])
            && !!p.src && (p as Item).story === undefined).map((p) => structuredClone(p)) };
    }
    throw new Error(`想定外の命令 ${cmd.constructor.name}`);
}
/** 索引に載っている写真（全員分） */
let indexed: Photo[] = [];
const queries = () => fakeSend.mock.calls.filter((c) => c[0].constructor.name === "QueryCommand").length;

const LAUNCH = "2026-10-20T00:00:00.000Z";

// 先頭の await は1つにまとめる（api-user の型検査の基準は「テスト1ファイルにつき TS1378 が1件」で数えている）
const [T, C] = await Promise.all([import("../trunk"), import("../camper")]);
const { handler, grantLabel, trunkId, trunkLedgerId } = T;
/** 出荷した値（試験が書き換える前） */
const SHIPPED_LAUNCH = C.CAMPER_LAUNCH.at;
import type { Photo } from "../types";

// 相手の uid は道で受けるので UUID の形（`isUserId`）
const ME = "11111111-1111-4111-8111-111111111111";
const F1 = "22222222-2222-4222-8222-222222222222";
const F2 = "33333333-3333-4333-8333-333333333333";
const F3 = "44444444-4444-4444-8444-444444444444";
const F4 = "55555555-5555-4555-8555-555555555555";
const OLD = "2026-01-01T00:00:00.000Z";
const AFTER = "2026-10-21T03:00:00.000Z";

const photo = (id: string, over: Partial<Photo> = {}, uid = ME): Photo => ({
    id, src: `https://cdn.example.com/uploads/${uid}/${id}.webp`, userId: uid, published: true, createdAt: AFTER, ...over,
} as Photo);

function user(uid: string, over: Item = {}) { store.set(`users-test|${uid}`, { userId: uid, createdAt: OLD, ...over }); }
function follow(a: string, b: string) { store.set(`photos-test|follow#${b}#${a}`, { id: `follow#${b}#${a}` }); } // a が b をフォロー
function friends(a: string, b: string) { follow(a, b); follow(b, a); }
const mainRow = (uid: string) => store.get(`photos-test|${trunkId(uid)}`) as Item | undefined;
const ledgerRow = (uid: string) => store.get(`photos-test|${trunkLedgerId(uid)}`) as Item | undefined;
const camperOf = (uid: string) => T.parseTrunk(mainRow(uid), ledgerRow(uid)).camper ?? C.emptyCamper();
const partIds = (uid: string) => camperOf(uid).parts.map((p) => p.id);

type Res = { statusCode: number; body: string };
async function call(routeKey: string, opts: { uid?: string; body?: unknown; sub?: string } = {}) {
    const ev = {
        routeKey,
        pathParameters: opts.uid ? { uid: opts.uid } : undefined,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        requestContext: { authorizer: { jwt: { claims: { sub: opts.sub ?? ME } } }, http: { method: routeKey.split(" ")[0] } },
    };
    const res = await (handler as unknown as (e: unknown) => Promise<Res>)(ev);
    return { status: res.statusCode, json: JSON.parse(res.body) as Record<string, unknown> };
}

/** 旅の投稿（`trip-` の束・撮影日つき）。束ごと・指紋ごとに別 */
let seq = 0;
const trip = (day: string, over: Partial<Photo> = {}) => {
    seq += 1;
    return photo(`t${seq}`, { groupId: `trip-${seq}`, exif: { dateTimeOriginal: `${day.replace(/-/g, ":")} 10:00:${String(seq % 60).padStart(2, "0")}`, camera: `c${seq}` }, ...over });
};

beforeEach(() => {
    store.clear();
    seq = 0;
    fakeSend.mockReset().mockImplementation(send);
    mockListMyPhotos.mockReset().mockResolvedValue([]);
    indexed = [];
    C.CAMPER_LAUNCH.at = LAUNCH;
    user(ME);
});
afterEach(() => { vi.useRealTimers(); });

describe("写真から読む部品（photoParts・純関数）", () => {
    it("森・水辺はスポットの category。港・自転車道・焼き物の町は人の選んだ一覧", () => {
        expect([...C.photoParts([photo("a", { spotId: "sp_350f9317cee7" })])]).toEqual(["window_shape.porthole"]);
        expect([...C.photoParts([photo("a", { spotId: "sp_db4f3aba96a1" })])]).toContain("bike_rack.rear_two");
        expect([...C.photoParts([photo("a", { spotId: "sp_efd4b4bd39af" })])]).toContain("mug.ceramic_glazed");
        const spots = C.camperSpotsForTest();
        const forest = spots.find(([, , , m]) => m === 1)!;
        const water = spots.find(([, , , m]) => m === 2)!;
        expect([...C.photoParts([photo("a", { spotId: forest[0] })])]).toEqual(["bumper.wood_beam"]);
        expect([...C.photoParts([photo("a", { spotId: water[0] })])]).toEqual(["roof_cargo.canoe"]);
        // 当たらないスポット・知らないスポット
        expect([...C.photoParts([photo("a", { spotId: "sp_000000000000" })])]).toEqual([]);
    });

    it("スポットを選ばなかった写真は座標が 2km 以内なら当たる（2.5km は当たらない）", () => {
        const spots = C.camperSpotsForTest();
        const [, lat, lng] = spots.find(([, la, , m]) => m === 1 && la !== 999)!;
        const near = photo("a", { coords: { lat: lat + 0.015, lng } }); // 約 1.7km
        const far = photo("b", { coords: { lat: lat + 0.0225, lng } }); // 約 2.5km
        expect(C.photoParts([near]).has("bumper.wood_beam")).toBe(true);
        expect(C.photoParts([far]).has("bumper.wood_beam")).toBe(false);
    });

    it("行事は種類で数える（1・3・6 種類）。同じ行事を何枚撮っても1種類", () => {
        const on = (id: string, d: string) => photo(id, { exif: { dateTimeOriginal: `${d} 12:00:00` } });
        expect([...C.photoParts([on("a", "2027:01:01"), on("b", "2027:01:02")])]).toEqual(["window_shape.arched"]);
        const three = [on("a", "2027:01:01"), on("b", "2027:03:03"), on("c", "2027:07:07")];
        expect(C.photoParts(three).has("curtain.beaded")).toBe(true);
        expect(C.photoParts(three).has("sticker_edge.holo")).toBe(false);
        // 年で動く日（十五夜 2027-09-15・冬至 2027-12-22・節分 2027-02-03）
        const six = [...three, on("d", "2027:09:15"), on("e", "2027:12:22"), on("f", "2027:02:03")];
        expect(C.photoParts(six).has("sticker_edge.holo")).toBe(true);
        expect(C.eventsOn("2027-09-16")).toEqual([]);
    });

    it("夏祭り（祭りの写真で 7〜8 月）と、違う祭り 5 つ（同じスポットは1つ）", () => {
        const fest = (id: string, over: Partial<Photo>) => photo(id, { title: "夏祭り", ...over });
        expect(C.photoParts([fest("a", { exif: { dateTimeOriginal: "2027:08:01 19:00:00" } })]).has("outdoor_light.paper_lantern")).toBe(true);
        expect(C.photoParts([fest("a", { exif: { dateTimeOriginal: "2027:10:01 19:00:00" } })]).has("outdoor_light.paper_lantern")).toBe(false);
        const nebuta = "sp_1326bdef665f";
        const sameSpot = Array.from({ length: 5 }, (_, i) => photo(`s${i}`, { spotId: nebuta }));
        expect(C.photoParts(sameSpot).has("flag.prayer_line")).toBe(false);
        const five = Array.from({ length: 5 }, (_, i) => fest(`f${i}`, { location: `町${i}`, exif: { dateTimeOriginal: `2027:10:0${i + 1} 19:00:00` } }));
        expect(C.photoParts(five).has("flag.prayer_line")).toBe(true);
    });

    it("天気は言葉で読む。train・rainbow には当てない。雨の投稿 5 つ（束は1つ）", () => {
        expect(C.photoParts([photo("a", { title: "雨の京都" })]).has("tire_tread.mud_block")).toBe(true);
        expect(C.photoParts([photo("a", { tags: ["rainy"] })]).has("tire_tread.mud_block")).toBe(true);
        expect(C.photoParts([photo("a", { title: "train and rainbow in Bahrain" })]).size).toBe(0);
        expect(C.photoParts([photo("a", { description: "風の強い日" })]).has("flag.windsock")).toBe(true);
        const bundle = Array.from({ length: 5 }, (_, i) => photo(`b${i}`, { title: "雨", groupId: "g-1" }));
        expect(C.photoParts(bundle).has("plant.hanging_ivy")).toBe(false);
        const posts = Array.from({ length: 5 }, (_, i) => photo(`p${i}`, { title: { ja: "雨", en: "" } as never }));
        expect(C.photoParts(posts).has("plant.hanging_ivy")).toBe(true);
    });

    it("図鑑の要サーバーの 33 個（iOS の CamperCatalog の .server と同じ id）", () => {
        expect(C.CAMPER_SERVER_PART_IDS).toHaveLength(33);
        expect(new Set(C.CAMPER_SERVER_PART_IDS).size).toBe(33);
        expect(C.CAMPER_SERVER_PART_IDS).not.toContain("fire_pit.stone_ring");
    });
});

describe("遡らない線（CAMPER_LAUNCH.at）", () => {
    it("出荷した値は null（配り始めるときは時刻を入れる小さなコミットを別に出す）。環境変数・param にはしない", async () => {
        expect(SHIPPED_LAUNCH).toBeNull();
        const fs = await import("fs");
        const path = await import("path");
        const yml = fs.readFileSync(path.join(__dirname, "..", "..", "serverless.yml"), "utf8");
        expect(yml).not.toContain("CAMPER_LAUNCHED_AT");
        expect(yml).not.toContain("camperLaunchedAt");
    });

    it("未設定なら配らない（投稿の相乗りも GET も書かない）", async () => {
        C.CAMPER_LAUNCH.at = null;
        expect(C.camperLaunchedAt()).toBeNull();
        const out = await grantLabel(ME, trip("2026-10-21", { spotId: "sp_350f9317cee7" }));
        expect(out.camper).toBeUndefined();
        expect(mainRow(ME)?.camper).toBeUndefined();
        const got = await call("GET /user/camper");
        expect(got.json).toMatchObject({ launched: false, parts: [], recounted: false });
        expect(queries()).toBe(0);
        expect(store.get(`photos-test|${T.camperDayId(ME)}`)).toBeUndefined();
        expect(C.camperLaunchedAt("あした")).toBeNull();
    });

    it("線より前に作った写真は数えない（スポットも旅の数も）", async () => {
        await grantLabel(ME, trip("2026-10-01", { createdAt: "2026-10-19T00:00:00.000Z", spotId: "sp_350f9317cee7" }));
        expect(camperOf(ME).trips).toBe(0);
        expect(partIds(ME)).toEqual([]);
    });

    it("非公開・人の写真は数えない", () => {
        const launch = Date.parse(LAUNCH);
        expect(C.isCamperPhoto(photo("a", { published: false }), ME, launch)).toBe(false);
        expect(C.isCamperPhoto(photo("a", {}, F1), ME, launch)).toBe(false);
        expect(C.isCamperPhoto(photo("a", { createdAt: undefined }), ME, launch)).toBe(false);
        expect(C.isCamperPhoto(photo("a"), ME, launch)).toBe(true);
    });
});

describe("投稿の相乗り（grantLabel）", () => {
    it("スポットの部品が配りと同じ書き込みで届き、応答に camper.added が載る", async () => {
        // 写真の行も置く（印を付けたあとの確かめで外さない＝書き込みは1回のまま・trunk.test.ts と同じ）
        store.set("photos-test|p1", photo("p1", { spotId: "sp_350f9317cee7" }) as unknown as Item);
        const out = await grantLabel(ME, photo("p1", { spotId: "sp_350f9317cee7" }));
        expect(out.label?.id).toBe("p1");
        expect(out.camper).toEqual({ added: ["window_shape.porthole"] });
        expect(partIds(ME)).toEqual(["window_shape.porthole"]);
        // 書き込みは1回（相乗り）
        expect(fakeSend.mock.calls.filter((c) => c[0].constructor.name === "TransactWriteCommand")).toHaveLength(1);
    });

    it("旅の投稿を数える。2 回で燕尾の旗。旅の日も控える", async () => {
        await grantLabel(ME, trip("2026-10-21"));
        expect(camperOf(ME).trips).toBe(1);
        expect(camperOf(ME).tripDays).toEqual(["2026-10-21"]);
        const out = await grantLabel(ME, trip("2026-10-22"));
        expect(out.camper?.added).toEqual(["flag.swallowtail"]);
        expect(camperOf(ME).tripDays).toEqual(["2026-10-22", "2026-10-21"]);
    });

    it("旅の数の歯止め: 同じ写真の再送・同じ指紋の上げ直しは一度。束でない投稿は数えない", async () => {
        const t = trip("2026-10-21");
        await grantLabel(ME, t);
        await grantLabel(ME, t);
        await grantLabel(ME, { ...t, id: "other-id", groupId: "trip-other" });
        await grantLabel(ME, photo("plain"));
        await grantLabel(ME, photo("g", { groupId: "g-not-trip" }));
        expect(camperOf(ME).trips).toBe(1);
    });

    it("旅の数の歯止め: 1日3件まで（配りの日の上限を通った分だけ）", async () => {
        for (let i = 0; i < 5; i++) await grantLabel(ME, trip("2026-10-21"));
        expect(camperOf(ME).trips).toBe(3);
    });

    it("同時に2本でも二重に届かない（rev の競合で読み直す）", async () => {
        const p = photo("p1", { spotId: "sp_350f9317cee7" });
        await Promise.all([grantLabel(ME, p), grantLabel(ME, p), grantLabel(ME, photo("p2", { spotId: "sp_350f9317cee7" }))]);
        expect(partIds(ME)).toEqual(["window_shape.porthole"]);
    });

    it("配りが止まっても（日の上限）、写真の部品は届く（その写真は線より後の公開）", async () => {
        for (let i = 0; i < 3; i++) await grantLabel(ME, photo(`d${i}`, { exif: { dateTimeOriginal: `2026:10:21 10:00:0${i}`, camera: `x${i}` } }));
        const out = await grantLabel(ME, photo("late", { spotId: "sp_350f9317cee7" }));
        expect(out.labelSkipped).toBe("daily");
        expect(out.camper?.added).toEqual(["window_shape.porthole"]);
    });

    it("退会した人（墓石）には配らない・何も書かない", async () => {
        user(ME, { deletedAt: "2026-10-21T00:00:00.000Z" });
        const out = await grantLabel(ME, trip("2026-10-21", { spotId: "sp_350f9317cee7" }));
        expect(out.labelSkipped).toBe("deleted");
        expect(mainRow(ME)).toBeUndefined();
        expect(ledgerRow(ME)).toBeUndefined();
    });

    it("24時間以内に消した旅は数を戻す（届いた部品は消さない）。24時間を過ぎたら戻さない", async () => {
        const a = trip("2026-10-21");
        const b = trip("2026-10-22");
        await grantLabel(ME, a);
        await grantLabel(ME, b);
        expect(partIds(ME)).toEqual(["flag.swallowtail"]);
        await T.revokeLabelQuietly(ME, { id: b.id, groupId: b.groupId, createdAt: new Date().toISOString() }, "test");
        expect(camperOf(ME).trips).toBe(1);
        expect(partIds(ME)).toEqual(["flag.swallowtail"]);
        // 24時間を過ぎた控えでは戻さない
        const now = Date.now();
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(now + 25 * 3_600_000);
        await T.revokeLabelQuietly(ME, { id: a.id, groupId: a.groupId, createdAt: new Date(now).toISOString() }, "test");
        expect(camperOf(ME).trips).toBe(1);
    });
});

describe("GET /user/camper（数え直しは1人1日1回）", () => {
    it("本人の写真で取りこぼしを拾い、今日はもう写真を読まない", async () => {
        indexed = [photo("a", { spotId: "sp_350f9317cee7" }), photo("b", { title: "雨" }),
            photo("old", { createdAt: OLD, spotId: "sp_db4f3aba96a1" }), photo("s", { story: true, title: "雨", spotId: "sp_db4f3aba96a1" } as never)];
        const a = await call("GET /user/camper");
        expect(a.status).toBe(200);
        expect(a.json).toMatchObject({ launched: true, recounted: true, trips: 0 });
        expect(a.json.added).toEqual(["window_shape.porthole", "tire_tread.mud_block"]);
        expect((a.json.parts as Item[]).map((p) => p.id).sort()).toEqual(["tire_tread.mud_block", "window_shape.porthole"]);
        const b = await call("GET /user/camper");
        expect(b.json).toMatchObject({ recounted: false, added: [] });
        expect(queries()).toBe(1);
        // 今日の印は小さな別の行に（台帳の行は書き直さない）
        expect(store.get(`photos-test|${T.camperDayId(ME)}`)).toMatchObject({ day: T.jstDay(new Date()), uid: ME });
        expect(ledgerRow(ME)?.camperRecountDay).toBeUndefined();
    });

    it("日が替われば数え直す", async () => {
        await call("GET /user/camper");
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(Date.now() + 86_400_000);
        await call("GET /user/camper");
        expect(queries()).toBe(2);
    });

    it("退会した本人は 410", async () => {
        user(ME, { deletedAt: "2026-10-21T00:00:00.000Z" });
        const got = await call("GET /user/camper");
        expect(got.status).toBe(410);
        expect(ledgerRow(ME)).toBeUndefined();
    });

    it("贈り物の部品は贈った人の名前を読む時に引く。退会した人は出さない", async () => {
        user(F1, { displayName: "ハナ" });
        user(F2, { displayName: "消えた人", deletedAt: "2026-10-22T00:00:00.000Z" });
        T.parseTrunk(undefined); // 形の確認だけ
        store.set(`photos-test|${trunkId(ME)}`, { id: trunkId(ME), uid: ME, rev: 1, camper: {
            parts: [{ id: "mirror.brass_oval", at: "x", by: F2 }, { id: "sticker_edge.signed", at: "x", by: F1 }],
            gifts: [{ from: F2, part: "mirror.brass_oval", at: "x" }, { from: F1, part: "sticker_edge.signed", at: "x" }],
        } });
        store.set(`photos-test|${trunkLedgerId(ME)}`, { id: trunkLedgerId(ME), uid: ME, rev: 1, camperRecountDay: T.jstDay(new Date()) });
        const got = await call("GET /user/camper");
        expect(got.json.parts).toEqual([
            { id: "mirror.brass_oval", at: "x" },
            { id: "sticker_edge.signed", at: "x", from: { userId: F1, name: "ハナ" } },
        ]);
        expect(got.json.progress).toMatchObject({ giftsFrom: 2 });
    });
});

describe("友達の車を開く（GET /users/{uid}/camper）", () => {
    it("互いにフォローしていなければ 403 notFriend（片方だけでも）。ブロックは 403 blocked。退会は 404 tombstone", async () => {
        user(F1);
        follow(ME, F1);
        expect((await call("GET /users/{uid}/camper", { uid: F1 })).json.code).toBe("notFriend");
        follow(F1, ME);
        store.set(`photos-test|block#${F1}#${ME}`, { id: `block#${F1}#${ME}` });
        expect((await call("GET /users/{uid}/camper", { uid: F1 })).json.code).toBe("blocked");
        store.delete(`photos-test|block#${F1}#${ME}`);
        user(F1, { deletedAt: "2026-10-22T00:00:00.000Z" });
        const r = await call("GET /users/{uid}/camper", { uid: F1 });
        expect([r.status, r.json.code]).toEqual([404, "tombstone"]);
        expect(ledgerRow(ME)).toBeUndefined();
        expect((await call("GET /users/{uid}/camper", { uid: "not-a-uuid" })).status).toBe(404);
        expect((await call("GET /users/{uid}/camper", { uid: ME })).json.code).toBe("self");
    });

    it("訪ねた記録は友達×日で1回。違う友達・違う日で 3 回ではしご。相手の行には書かない", async () => {
        for (const f of [F1, F2]) { user(f); friends(ME, f); }
        const a = await call("GET /users/{uid}/camper", { uid: F1 });
        expect(a.json).toMatchObject({ userId: F1, launched: true, parts: [], visit: { counted: true, added: [] } });
        expect((await call("GET /users/{uid}/camper", { uid: F1 })).json.visit).toEqual({ counted: false, added: [] });
        await call("GET /users/{uid}/camper", { uid: F2 });
        expect(camperOf(ME).visits).toHaveLength(2);
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(Date.now() + 86_400_000);
        const c = await call("GET /users/{uid}/camper", { uid: F1 });
        expect(c.json.visit).toEqual({ counted: true, added: ["ladder.wood_rungs"] });
        expect(mainRow(F1)).toBeUndefined();
        expect(ledgerRow(F1)).toBeUndefined();
    });

    it("相手と同じ日に旅をしていれば翼のタープ。同じ日の友達 10 人で長い無線の竿", async () => {
        const fs = Array.from({ length: 10 }, (_, i) => `66666666-6666-4666-8666-${String(i).padStart(12, "0")}`);
        await grantLabel(ME, trip("2026-10-21"));
        for (const f of fs) {
            user(f);
            friends(ME, f);
            store.set(`photos-test|${trunkId(f)}`, { id: trunkId(f), uid: f, rev: 1, camper: { tripDays: ["2026-10-21"], trips: 1, parts: [{ id: "flag.swallowtail", at: "x" }] } });
        }
        const first = await call("GET /users/{uid}/camper", { uid: fs[0] });
        expect(first.json.parts).toEqual(["flag.swallowtail"]);
        expect((first.json.visit as Item).added).toEqual(["roof_tent.wing"]);
        for (const f of fs.slice(1)) await call("GET /users/{uid}/camper", { uid: f });
        expect(camperOf(ME).tripFriends).toHaveLength(10);
        expect(partIds(ME)).toContain("antenna.ham_long");
    });

    it("違う日の旅は当たらない", async () => {
        user(F1); friends(ME, F1);
        await grantLabel(ME, trip("2026-10-21"));
        store.set(`photos-test|${trunkId(F1)}`, { id: trunkId(F1), uid: F1, rev: 1, camper: { tripDays: ["2026-10-22"] } });
        await call("GET /users/{uid}/camper", { uid: F1 });
        expect(camperOf(ME).tripFriends).toEqual([]);
    });
});

describe("贈る（POST /users/{uid}/camper/gift）", () => {
    const gift = (to: string, from = ME) => call("POST /users/{uid}/camper/gift", { uid: to, sub: from, body: { part: "wheel.brass_spoke", to: F4 } });
    beforeEach(() => {
        for (const f of [F1, F2, F3, F4]) { user(f); friends(ME, f); }
        indexed = [ME, F1, F2, F3, F4].map((u) => photo(`mine-${u}`, {}, u));
    });

    it("1 人目の贈り物で署名入り（贈った人を刻む）。何を贈るかはサーバーが決める（本文は読まない）", async () => {
        const r = await gift(F1);
        expect(r.json).toEqual({ given: true, part: "sticker_edge.signed" });
        expect(camperOf(F1).parts).toEqual([{ id: "sticker_edge.signed", at: expect.any(String), by: ME }]);
        expect(camperOf(F1).gifts.map((g) => g.from)).toEqual([ME]);
        expect(camperOf(ME).given.map((g) => g.u)).toEqual([F1]);
        // 本文の part・to は効かない（F4 には何も届かない・wheel は誰にも届かない）
        expect(mainRow(F4)).toBeUndefined();
        expect(partIds(ME)).toEqual([]);
    });

    it("4行を1つの TransactWriteItems（全部 rev 条件）で書く", async () => {
        fakeSend.mockClear();
        await gift(F1);
        const tx = fakeSend.mock.calls.map((c) => c[0]).filter((c) => c.constructor.name === "TransactWriteCommand");
        expect(tx).toHaveLength(1);
        const items = (tx[0].input as { TransactItems: Record<string, { ConditionExpression?: string; Key?: Item; Item?: Item }>[] }).TransactItems;
        expect(items).toHaveLength(4);
        expect(items.every((t) => (Object.values(t)[0].ConditionExpression ?? "").includes("rev"))).toBe(true);
    });

    it("同じ相手には一度きり（日が替わっても）・1日1回", async () => {
        await gift(F1);
        expect((await gift(F2)).json.code).toBe("daily");
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(Date.now() + 86_400_000);
        expect((await gift(F1)).json.code).toBe("already");
        expect((await gift(F2)).json.given).toBe(true);
    });

    it("同じ相手には一度きりを、贈る人の台帳でも見る（受け取る側の控えが上限 40 で落ちていても）", async () => {
        store.set(`photos-test|${trunkLedgerId(ME)}`, { id: trunkLedgerId(ME), uid: ME, rev: 1, camperGiven: [{ u: F1, d: "2026-10-01" }] });
        expect((await gift(F1)).json.code).toBe("already");
        expect(mainRow(F1)).toBeUndefined();
    });

    it("違う 2 人目で真鍮の楕円・3 人目は部品なし・4 人目でキリム", async () => {
        const givers = [F1, F2, F3, F4];
        for (const g of givers) if (g !== ME) friends(g, ME);
        // ME が受け取る側。贈り主はそれぞれ別の友達（互いにフォロー済み）
        const got = [];
        for (const g of givers) got.push((await gift(ME, g)).json);
        expect(got).toEqual([
            { given: true, part: "sticker_edge.signed" },
            { given: true, part: "mirror.brass_oval" },
            { given: true },
            { given: true, part: "rug.kilim" },
        ]);
        expect(camperOf(ME).parts.find((p) => p.id === "mirror.brass_oval")?.by).toBe(F2);
    });

    it("歯止め: 登録 7 日未満は newAccount・機能の後の公開の投稿が無ければ noPost", async () => {
        user(ME, { createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString() });
        expect((await gift(F1)).json.code).toBe("newAccount");
        user(ME, { createdAt: OLD });
        indexed = [photo("old", { createdAt: OLD }), photo("story", { story: true } as never)];
        expect((await gift(F1)).json.code).toBe("noPost");
        expect(mainRow(F1)).toBeUndefined();
    });

    it("友達でない・ブロック・相手が退会・自分が退会・線が無い、は贈れない（何も書かない）", async () => {
        const stranger = "77777777-7777-4777-8777-777777777777";
        user(stranger);
        expect((await gift(stranger)).json.code).toBe("notFriend");
        store.set(`photos-test|block#${ME}#${F1}`, { id: `block#${ME}#${F1}` });
        expect((await gift(F1)).json.code).toBe("blocked");
        user(F2, { deletedAt: "2026-10-22T00:00:00.000Z" });
        expect((await gift(F2)).json.code).toBe("tombstone");
        user(ME, { deletedAt: "2026-10-22T00:00:00.000Z" });
        expect((await gift(F3)).status).toBe(410);
        user(ME);
        C.CAMPER_LAUNCH.at = null;
        expect((await gift(F3)).json.code).toBe("notLaunched");
        for (const u of [stranger, F1, F2, F3]) expect(mainRow(u)).toBeUndefined();
    });

    it("同時に2本贈っても1回だけ（rev 条件の取引）", async () => {
        const rs = await Promise.all([gift(F1), gift(F1)]);
        expect(rs.filter((r) => r.json.given === true)).toHaveLength(1);
        expect(camperOf(F1).gifts).toHaveLength(1);
    });
});

describe("薪をくべる（POST /users/{uid}/camper/firewood）", () => {
    it("同じ友達に1日1回。10 回で三脚とやかん。相手の行には書かない", async () => {
        const fs = Array.from({ length: 5 }, (_, i) => `88888888-8888-4888-8888-${String(i).padStart(12, "0")}`);
        for (const f of fs) { user(f); friends(ME, f); }
        const first = await call("POST /users/{uid}/camper/firewood", { uid: fs[0] });
        expect(first.json).toEqual({ added: true, count: 1 });
        expect((await call("POST /users/{uid}/camper/firewood", { uid: fs[0] })).json).toEqual({ added: false, count: 1 });
        for (const f of fs.slice(1)) await call("POST /users/{uid}/camper/firewood", { uid: f });
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(Date.now() + 86_400_000);
        for (const f of fs.slice(0, 4)) await call("POST /users/{uid}/camper/firewood", { uid: f });
        const last = await call("POST /users/{uid}/camper/firewood", { uid: fs[4] });
        expect(last.json).toEqual({ added: true, count: 10, part: "fire_pit.tripod_kettle" });
        for (const f of fs) expect(mainRow(f)).toBeUndefined();
    });

    it("友達でなければ 403", async () => {
        user(F1);
        follow(F1, ME);
        const r = await call("POST /users/{uid}/camper/firewood", { uid: F1 });
        expect([r.status, r.json.code]).toEqual([403, "notFriend"]);
    });
});

describe("持っている印で二重に配らない（grantParts・純関数）", () => {
    it("持っている部品は足さない。図鑑に無い id も足さない", () => {
        const c = { ...C.emptyCamper(), parts: [{ id: "flag.swallowtail", at: "x" }] };
        const r = C.grantParts(c, new Set(["flag.swallowtail", "wheel.unknown", "mudflap.checker"]), new Date());
        expect(r.added).toEqual(["mudflap.checker"]);
        expect(r.camper.parts.map((p) => p.id)).toEqual(["mudflap.checker", "flag.swallowtail"]);
        expect(C.grantParts(r.camper, new Set(["mudflap.checker"]), new Date()).added).toEqual([]);
    });

    it("旅の数の段（12 個）: 20 回で全部", () => {
        const r = C.grantParts({ ...C.emptyCamper(), trips: 20 }, C.recordParts({ ...C.emptyCamper(), trips: 20 }), new Date());
        expect(r.added).toHaveLength(12);
        expect(C.recordParts({ ...C.emptyCamper(), trips: 19 }).has("wheel.brass_spoke")).toBe(false);
    });
});

describe("見直しの指摘（2026-10-18）", () => {
    it("退会した本人は4つの口すべて（GET /user/camper・GET /users/{uid}/camper・gift・firewood）で 410。何も書かない", async () => {
        user(F1);
        friends(ME, F1);
        indexed = [photo("mine")];
        user(ME, { deletedAt: "2026-10-21T00:00:00.000Z" });
        const rs = [
            await call("GET /user/camper"),
            await call("GET /users/{uid}/camper", { uid: F1 }),
            await call("POST /users/{uid}/camper/gift", { uid: F1 }),
            await call("POST /users/{uid}/camper/firewood", { uid: F1 }),
        ];
        expect(rs.map((r) => r.status)).toEqual([410, 410, 410, 410]);
        for (const u of [ME, F1]) {
            expect(mainRow(u)).toBeUndefined();
            expect(ledgerRow(u)).toBeUndefined();
        }
        expect(store.get(`photos-test|${T.camperDayId(ME)}`)).toBeUndefined();
    });

    it("天気・祭りの言葉は地名に当てない（雨晴海岸・雨滝・雨引観音・葬祭殿・祭場）。ほんとうの雨・祭りは当てる", () => {
        for (const title of ["雨晴海岸の朝", "雨滝", "雨引観音の紫陽花", "雨竜の渓谷"]) {
            expect(C.isRainPhoto(photo("a", { title })), title).toBe(false);
        }
        for (const title of ["ハトシェプスト女王葬祭殿", "三神合祭殿", "高宮祭場", "祭壇"]) {
            expect(C.isFestivalPhoto(photo("a", { title })), title).toBe(false);
        }
        expect(C.isRainPhoto(photo("a", { title: "雨晴海岸、雨の朝" }))).toBe(true);
        expect(C.isFestivalPhoto(photo("a", { title: "祇園祭" }))).toBe(true);
        expect(C.isFestivalPhoto(photo("a", { tags: ["夏祭り"] }))).toBe(true);
    });

    it("相手がトランクを見せない設定なら、友達の車の部品は空（訪ねた記録は数える）", async () => {
        user(F1);
        friends(ME, F1);
        store.set(`photos-test|${trunkId(F1)}`, { id: trunkId(F1), uid: F1, rev: 1, showTrunk: false, camper: { parts: [{ id: "flag.swallowtail", at: "x" }] } });
        const r = await call("GET /users/{uid}/camper", { uid: F1 });
        expect(r.json.parts).toEqual([]);
        expect((r.json.visit as Item).counted).toBe(true);
    });

    it("トランクを使っていない人に贈り物で trunk# が作られても、人のトランクの口は 404 のまま。トランクを使えば見える", async () => {
        user(F1);
        friends(ME, F1);
        indexed = [photo("mine")];
        expect((await call("POST /users/{uid}/camper/gift", { uid: F1 })).json.given).toBe(true);
        expect(mainRow(F1)?.camperOnly).toBe(true);
        await expect(T.readTheirTrunk(ME, F1)).rejects.toThrow();
        // 本人がトランクを使う（設定を書く）と印は外れ、贈られた部品は残る
        await call("PUT /user/trunk/settings", { sub: F1, body: { receiveLabels: false } });
        expect(mainRow(F1)?.camperOnly).toBeUndefined();
        expect(camperOf(F1).parts.map((p) => p.id)).toEqual(["sticker_edge.signed"]);
        expect((await T.readTheirTrunk(ME, F1)).userId).toBe(F1);
    });

    it("前からトランクを使っている人には印を付けない（見え方を変えない）", async () => {
        user(F1);
        friends(ME, F1);
        indexed = [photo("mine")];
        store.set(`photos-test|${trunkId(F1)}`, { id: trunkId(F1), uid: F1, rev: 1, coins: 3 });
        await call("POST /users/{uid}/camper/gift", { uid: F1 });
        expect(mainRow(F1)?.camperOnly).toBeUndefined();
        expect((await T.readTheirTrunk(ME, F1)).userId).toBe(F1);
    });

    it("訪ねて部品が届いても、自分の行が新しく作られるなら印つき（自分のトランクが人に見え始めない）", async () => {
        for (const f of [F1, F2, F3]) { user(f); friends(ME, f); }
        for (const f of [F1, F2, F3]) await call("GET /users/{uid}/camper", { uid: f });
        expect(partIds(ME)).toEqual(["ladder.wood_rungs"]);
        expect(mainRow(ME)?.camperOnly).toBe(true);
    });

    it("updateTrunks: 1人でも null を返したら、ほかの人の分も含めて何も書かない", async () => {
        store.set(`photos-test|${trunkId(F1)}`, { id: trunkId(F1), uid: F1, rev: 1, coins: 3 });
        fakeSend.mockClear();
        await T.updateTrunksForTest([
            { uid: ME, fn: (d) => ({ ...d, coins: 5 }) },
            { uid: F1, fn: () => null },
        ]);
        expect(fakeSend.mock.calls.some((c) => c[0].constructor.name === "TransactWriteCommand")).toBe(false);
        expect(mainRow(ME)).toBeUndefined();
        expect(mainRow(F1)?.coins).toBe(3);
    });

    it("受け取る側の控えでも「同じ人から一度きり」（贈る人の台帳に無くても）", async () => {
        user(F1);
        friends(ME, F1);
        indexed = [photo("mine")];
        store.set(`photos-test|${trunkId(F1)}`, { id: trunkId(F1), uid: F1, rev: 1, camper: { gifts: [{ from: ME, part: "sticker_edge.signed", at: "x" }] } });
        const r = await call("POST /users/{uid}/camper/gift", { uid: F1 });
        expect([r.status, r.json.code]).toEqual([409, "already"]);
        expect(ledgerRow(ME)).toBeUndefined();
        expect(camperOf(F1).gifts).toHaveLength(1);
    });

    it("費用: 何も届かない日の数え直しはトランクの2行を書かない（小さな印の行だけ）。2行は1回だけ読む", async () => {
        indexed = [photo("plain")];
        fakeSend.mockClear();
        await call("GET /user/camper");
        const names = fakeSend.mock.calls.map((c) => c[0].constructor.name);
        expect(names).not.toContain("TransactWriteCommand");
        expect(names.filter((n) => n === "PutCommand")).toHaveLength(1);
        // 届く日: 先に読んだ2行を書き込みの1回目に使う（trunk# の読みは1回）
        indexed = [photo("p", { spotId: "sp_350f9317cee7" })];
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(Date.now() + 86_400_000);
        fakeSend.mockClear();
        const r = await call("GET /user/camper");
        expect(r.json.added).toEqual(["window_shape.porthole"]);
        const trunkReads = fakeSend.mock.calls.map((c) => c[0])
            .filter((c) => c.constructor.name === "GetCommand" && (c.input as { Key: Item }).Key.id === trunkId(ME));
        expect(trunkReads).toHaveLength(1);
    });

    it("贈る人の「投稿あり」は線の後の写真だけを問い合わせ、見つかった所でやめる", async () => {
        user(F1);
        friends(ME, F1);
        indexed = [photo("a"), photo("b"), photo("c")];
        fakeSend.mockClear();
        await call("POST /users/{uid}/camper/gift", { uid: F1 });
        const q = fakeSend.mock.calls.map((c) => c[0]).filter((c) => c.constructor.name === "QueryCommand");
        expect(q).toHaveLength(1);
        expect((q[0].input as { KeyConditionExpression: string }).KeyConditionExpression).toContain("createdAt >= :t");
        expect(mockListMyPhotos).not.toHaveBeenCalled();
    });
});
