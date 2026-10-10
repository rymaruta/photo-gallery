import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Pro の取引と人の結び付け（`appstore#<originalTransactionId>`）の**順番の決まり**を、表で総当たりする。
//
// 2026-10-10: 虫探しの 3〜6 回目で毎回ここに新しい穴が見つかった（purchaseDate・今で抑えた時刻・
// signedDate・期間の始まりを、場所ごとに別々に比べていた）。決まりを1つにそろえたので
// （`supporterStore.ts` の `claimAppStoreLink` の注記）、届く順・届き方・古い行かどうかを並べ替えて、
// 次の不変条件がいつも成り立つことを確かめる:
//
//   (a) いちばん新しい効いている取引の持ち主は、その期限まで Pro
//   (b) その originalTransactionId で、ほかの人は Pro にならない
//   (c) 払った本人が恒久の 409 で弾かれない
//   (d) 知らせは持ち主に届く
//
// 偽の表・署名の仕組みは `purchases.test.ts` と同じ。

const fx = vi.hoisted(() => ({ roots: [] as Buffer[] }));
const table = vi.hoisted(() => ({ current: null as null | { send: (c: never) => Promise<unknown> } }));
const pushNotification = vi.hoisted(() => vi.fn());

vi.mock("../appleRootCerts", () => ({ appleRootCertificates: () => fx.roots }));
vi.mock("../dynamodb", () => ({
    ddb: { send: (c: never) => table.current!.send(c) },
    PHOTOS_TABLE: "photos-test",
    USER_INDEX: "userId-createdAt-index",
}));
vi.mock("../notify", () => ({ pushNotification }));

import { appStoreNotification, recordPurchase } from "../purchases";
import { appAccountTokenFor, resetAppStoreVerifiers } from "../appStore";
import { OWNERS_MAX, parseAppStoreLink, staleTokenlessOwner } from "../supporterStore";
import { isPro } from "../badgeKeys";
import { FakeUsersTable } from "./fixtures/fakeUsersTable";
import { BUNDLE, TEST_ROOT_DER, YEARLY, notificationJws, signJws, txPayload } from "./fixtures/appstore/signing";

type Result = { statusCode: number; body: string };
let db: FakeUsersTable;

const MIN = 60_000;
const H = 3_600_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 10, 3, 0, 0);
/** u1 の月ごとの最初の期間の終わり */
const E = T0 + 31 * DAY;
/** u2 が同じ Apple ID のまま年ごとへアップグレードした時刻（u1 の前倒しの更新の請求より後・E より前） */
const U = E - 6 * H;
const OTX = "appstore#2000000000000001";

beforeEach(() => {
    fx.roots = [TEST_ROOT_DER];
    resetAppStoreVerifiers();
    db = new FakeUsersTable();
    table.current = db as never;
    pushNotification.mockReset().mockResolvedValue(undefined);
    vi.stubEnv("APPSTORE_BUNDLE_ID", BUNDLE);
    vi.stubEnv("APPSTORE_ENVIRONMENTS", "Sandbox");
    vi.stubEnv("APPSTORE_APP_APPLE_ID", "");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0 + MIN);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

const purchase = (userId: string, jws: string): Promise<Result> =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (recordPurchase as any)({
        requestContext: { authorizer: { jwt: { claims: { sub: userId } } } },
        body: JSON.stringify({ signedTransaction: jws }),
    });
const notify = (jws: string): Promise<Result> =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (appStoreNotification as any)({ body: JSON.stringify({ signedPayload: jws }) });

const tokenTx = (userId: string, over: Record<string, unknown> = {}) =>
    txPayload({ appAccountToken: appAccountTokenFor(userId), ...over });
const pro = (userId: string) => isPro((db.get(userId) ?? {}) as { supporter?: unknown }, Date.now());
const supporterOf = (userId: string) => (db.get(userId)?.supporter ?? {}) as { periods?: { id: string }[]; productId?: string; expiresAt?: string };

// ─── 取引 ──────────────────────────────────────────────────────────

type Tx = Record<string, unknown>;
/** u1 の最初の購入 */
const O1 = (): Tx => tokenTx("u1");
/** u1 のふつうの更新（期限ちょうどに請求） */
const R1 = (): Tx => tokenTx("u1", { transactionId: "2000000000000002", purchaseDate: E, expiresDate: E + 30 * DAY, signedDate: E + 1000 });
/** u1 の前倒しの更新: E の 12 時間前に請求・purchaseDate は E（未来）・signedDate はそれより前 */
const R1e = (over: Tx = {}): Tx => tokenTx("u1", {
    transactionId: "2000000000000002", purchaseDate: E, expiresDate: E + 30 * DAY, signedDate: E - 12 * H, ...over,
});
/** u2 のアップグレードで置き換わったあとに署名し直された R1e（isUpgraded） */
const R1eUp = (): Tx => R1e({ isUpgraded: true, signedDate: U + 1000 });
/** u2 のアップグレード（年ごと・U に即時） */
const UP2 = (over: Tx = {}): Tx => tokenTx("u2", {
    transactionId: "2000000000000030", productId: YEARLY, purchaseDate: U, expiresDate: U + 365 * DAY, signedDate: U + 1000, ...over,
});
/** u2 の切り替え（年ごと・更新のときに効く。前倒しで E の 12 時間前に請求） */
const CG2 = (): Tx => tokenTx("u2", {
    transactionId: "2000000000000031", productId: YEARLY, purchaseDate: E, expiresDate: E + 365 * DAY, signedDate: E - 12 * H,
});
/** u1 が期限切れになったあと（E+40日）に u2 が申し込み直す */
const RS = E + 40 * DAY;
const RS2 = (): Tx => tokenTx("u2", { transactionId: "2000000000000032", purchaseDate: RS, expiresDate: RS + 31 * DAY, signedDate: RS + 1000 });

// ─── 表 ────────────────────────────────────────────────────────────

type Delivery =
    | { name: string; via: "post"; user: string; tx: () => Tx }
    | { name: string; via: "notify"; type: string; subtype?: string; tx: () => Tx; signedDate?: number; dupOf?: string };

type Setup = { name: string; steps: { at: number; d: Delivery }[] };

type Story = {
    name: string;
    /** u1 が O1 を買ったあと、並べ替える前に済ませること（候補ごとに1回ずつ回す） */
    setups: Setup[];
    /** 並べ替えて届ける出来事 */
    deliveries: Delivery[];
    /** 届け始める時刻（候補ごとに回す） */
    starts: number[];
    /** いちばん新しい効いている取引: 誰の・どの取引・期限。無ければ誰も Pro ではない */
    newest?: { user: string; tx: () => Tx; expires: number; next: () => Tx; product: string };
    /** その取引のどれかが届いたら (b) を見張る（届いた出来事の名前） */
    newestNames: string[];
};

const signedOf = (d: Delivery) => (d.via === "notify" && d.signedDate !== undefined ? d.signedDate : d.tx().signedDate as number);

const STORIES: Story[] = [
    {
        name: "u1 の前倒しの更新のあとに u2 がアップグレード",
        setups: [
            { name: "前倒しの更新は未着", steps: [] },
            { name: "前倒しの更新を U の前に POST", steps: [{ at: E - 11 * H, d: { name: "R1e:post", via: "post", user: "u1", tx: () => R1e() } }] },
            { name: "前倒しの更新を U の前に DID_RENEW", steps: [{ at: E - 11 * H, d: { name: "R1e:notify", via: "notify", type: "DID_RENEW", tx: () => R1e() } }] },
        ],
        deliveries: [
            { name: "UP2:post", via: "post", user: "u2", tx: () => UP2() },
            { name: "UP2:notify", via: "notify", type: "DID_CHANGE_RENEWAL_PREF", subtype: "UPGRADE", tx: () => UP2() },
            { name: "R1eUp:post", via: "post", user: "u1", tx: R1eUp },
            { name: "R1e:replay", via: "post", user: "u1", tx: () => R1e() },
        ],
        starts: [U + MIN, E + H],
        newest: {
            user: "u2", tx: () => UP2(), expires: U + 365 * DAY, product: YEARLY,
            next: () => UP2({ transactionId: "2000000000000039", purchaseDate: U + 365 * DAY, expiresDate: U + 730 * DAY, signedDate: U + 365 * DAY - H }),
        },
        newestNames: ["UP2:post", "UP2:notify"],
    },
    {
        name: "u2 が切り替え（更新のときに効く・前倒しの請求）",
        setups: [{ name: "なし", steps: [] }],
        deliveries: [
            { name: "CG2:post", via: "post", user: "u2", tx: CG2 },
            { name: "CG2:notify", via: "notify", type: "DID_RENEW", tx: CG2 },
            { name: "O1:restore", via: "post", user: "u1", tx: O1 },
            // u2 が切り替えを選んだときの知らせ（今の取引＝O1・token は u1）が遅れて届く
            { name: "O1:pref", via: "notify", type: "DID_CHANGE_RENEWAL_PREF", subtype: "DOWNGRADE", tx: O1, signedDate: E - 5 * DAY },
        ],
        starts: [E - 11 * H, E + H],
        newest: {
            user: "u2", tx: CG2, expires: E + 365 * DAY, product: YEARLY,
            next: () => tokenTx("u2", { transactionId: "2000000000000038", productId: YEARLY, purchaseDate: E + 365 * DAY, expiresDate: E + 730 * DAY, signedDate: E + 365 * DAY - H }),
        },
        newestNames: ["CG2:post", "CG2:notify"],
    },
    {
        name: "u1 が更新して期限切れ、そのあと u2 が申し込み直す",
        setups: [{ name: "R1 を DID_RENEW", steps: [{ at: E + MIN, d: { name: "R1:notify", via: "notify", type: "DID_RENEW", tx: R1 } }] }],
        deliveries: [
            { name: "RS2:post", via: "post", user: "u2", tx: RS2 },
            { name: "RS2:notify", via: "notify", type: "SUBSCRIBED", subtype: "RESUBSCRIBE", tx: RS2 },
            { name: "R1:expired", via: "notify", type: "EXPIRED", subtype: "VOLUNTARY", tx: R1, signedDate: E + 30 * DAY },
            { name: "R1:restore", via: "post", user: "u1", tx: R1 },
        ],
        starts: [RS + MIN],
        newest: {
            user: "u2", tx: RS2, expires: RS + 31 * DAY, product: "",
            next: () => tokenTx("u2", { transactionId: "2000000000000037", purchaseDate: RS + 31 * DAY, expiresDate: RS + 62 * DAY, signedDate: RS + 31 * DAY - H }),
        },
        newestNames: ["RS2:post", "RS2:notify"],
    },
    {
        name: "u2 がアップグレードしたあと返金（取り消し）",
        setups: [{ name: "UP2 を POST で付け替え", steps: [{ at: U + MIN, d: { name: "UP2:post", via: "post", user: "u2", tx: () => UP2() } }] }],
        deliveries: [
            { name: "UP2:refund", via: "notify", type: "REFUND", tx: () => UP2({ revocationDate: U + 2 * DAY, revocationReason: 0, signedDate: U + 2 * DAY }) },
            { name: "UP2:revoked-post", via: "post", user: "u2", tx: () => UP2({ revocationDate: U + 2 * DAY, revocationReason: 0, signedDate: U + 2 * DAY + 1000 }) },
            { name: "R1eUp:post", via: "post", user: "u1", tx: R1eUp },
            { name: "UP2:late-notify", via: "notify", type: "DID_CHANGE_RENEWAL_PREF", subtype: "UPGRADE", tx: () => UP2() },
        ],
        starts: [U + 2 * DAY + MIN],
        newestNames: [],
    },
    {
        name: "u1 だけ（更新・復元の送り直し・同じ知らせの二重）",
        setups: [{ name: "なし", steps: [] }],
        deliveries: [
            { name: "R1:notify", via: "notify", type: "DID_RENEW", tx: R1 },
            { name: "R1:post", via: "post", user: "u1", tx: R1 },
            { name: "O1:restore", via: "post", user: "u1", tx: O1 },
            { name: "R1:notify-dup", via: "notify", type: "DID_RENEW", tx: R1, dupOf: "R1:notify" },
        ],
        starts: [E + MIN],
        newest: {
            user: "u1", tx: R1, expires: E + 30 * DAY, product: "",
            next: () => tokenTx("u1", { transactionId: "2000000000000003", purchaseDate: E + 30 * DAY, expiresDate: E + 60 * DAY, signedDate: E + 30 * DAY - H }),
        },
        newestNames: ["R1:notify", "R1:post"],
    },
];

function permutations<T>(xs: T[]): T[][] {
    if (xs.length <= 1) return [xs];
    return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
}

/** 1つの出来事を届ける（同じ知らせの二重は、前に作った JWS をそのまま送る） */
async function deliver(d: Delivery, sent: Map<string, string>): Promise<Result> {
    if (d.via === "post") return purchase(d.user, signJws(d.tx()));
    const jws = (d.dupOf && sent.get(d.dupOf)) || notificationJws({
        type: d.type, subtype: d.subtype, tx: d.tx(), ...(d.signedDate !== undefined ? { signedDate: d.signedDate } : {}),
    });
    sent.set(d.name, jws);
    return notify(jws);
}

const others = (user: string) => ["u1", "u2"].filter((u) => u !== user);

type Case = [string, Story, Setup, number, boolean, Delivery[]];
const CASES: Case[] = STORIES.flatMap((story) => story.setups.flatMap((setup) => story.starts.flatMap((start) => [false, true].flatMap((legacy) =>
    permutations(story.deliveries).map((order): Case => [
        `${story.name} / ${setup.name} / ${new Date(start).toISOString().slice(5, 16)} / ${legacy ? "古い行" : "新しい行"} / ${order.map((d) => d.name).join(" → ")}`,
        story, setup, start, legacy, order,
    ])))));

describe("結び付けの順番の決まり（表で総当たり）", () => {
    it("表の大きさ", () => {
        expect(CASES.length).toBeGreaterThanOrEqual(300);
    });

    it.each(CASES)("%s", async (_name, story, setup, start, legacy, order) => {
        db.set({ userId: "u1", rev: 1 });
        db.set({ userId: "u2", rev: 1 });
        const sent = new Map<string, string>();
        expect((await purchase("u1", signJws(O1()))).statusCode).toBe(200);
        for (const s of setup.steps) {
            vi.setSystemTime(s.at);
            expect((await deliver(s.d, sent)).statusCode).toBe(200);
        }
        if (legacy) {
            // デプロイ前に作られた行（鍵を持たない）
            const row = { ...db.get(OTX)! };
            delete row.lastPurchaseDate;
            db.set(row);
        }

        const newest = story.newest;
        let newestArrived = setup.steps.some((s) => story.newestNames.includes(s.d.name));
        let t = start;
        for (const d of order) {
            t = Math.max(t, signedOf(d) + MIN);
            vi.setSystemTime(t);
            const res = await deliver(d, sent);
            const isNewestPost = newest && d.via === "post" && d.user === newest.user && story.newestNames.includes(d.name);
            if (d.via === "notify") expect(res.statusCode, `${d.name} は 200`).toBe(200);
            // (c) 払った本人の、いちばん新しい取引の POST は通る
            if (isNewestPost) expect(res.statusCode, `${d.name}: ${res.body}`).toBe(200);
            else if (d.via === "post") expect([200, 409], `${d.name}: ${res.body}`).toContain(res.statusCode);
            if (res.statusCode === 409) expect(JSON.parse(res.body).code, "409 は claimed_by_other_account").toBe("claimed_by_other_account");
            if (story.newestNames.includes(d.name)) newestArrived = true;

            if (newest && newestArrived) {
                // (b) いちばん新しい取引が届いたら、ほかの人は Pro ではない
                for (const u of others(newest.user)) expect(pro(u), `${u} は Pro ではない（${d.name} のあと）`).toBe(false);
            }
            if (newest && isNewestPost) {
                // (a) 申し込んだ持ち主は Pro
                expect(pro(newest.user), `${newest.user} は Pro（${d.name} のあと）`).toBe(true);
                expect(db.get(OTX)).toMatchObject({ ownerId: newest.user });
            }
            if (newest && newest.user === "u2") {
                // 持ち主ではない人の取引の知らせは、u1 の行に u2 の取引を書かない
                expect((supporterOf("u1").periods ?? []).map((p) => p.id)).not.toContain(newest.tx().transactionId);
                if (newest.product) expect(supporterOf("u1").productId).not.toBe(newest.product);
            }
            t += 10 * MIN;
        }

        if (!newest) {
            // 誰の取引も効いていない（返金・置き換え済み）→ 誰も Pro ではない
            for (const u of ["u1", "u2"]) expect(pro(u), `${u} は Pro ではない`).toBe(false);
            return;
        }

        // (c) 最後に本人がもう一度送っても（復元）通る。(a)(b)
        vi.setSystemTime(t);
        const again = await purchase(newest.user, signJws(newest.tx()));
        expect(again.statusCode, again.body).toBe(200);
        expect(db.get(OTX)).toMatchObject({ ownerId: newest.user });
        expect(t).toBeLessThan(newest.expires);
        expect(pro(newest.user)).toBe(true);
        for (const u of others(newest.user)) expect(pro(u)).toBe(false);
        vi.setSystemTime(newest.expires - MIN);
        expect(pro(newest.user), "期限の直前まで Pro").toBe(true);

        // (d) 次の更新の知らせは持ち主に届く
        const next = newest.next();
        vi.setSystemTime((next.signedDate as number) + MIN);
        expect((await notify(notificationJws({ type: "DID_RENEW", tx: next }))).statusCode).toBe(200);
        expect(supporterOf(newest.user).expiresAt).toBe(new Date(next.expiresDate as number).toISOString());
        vi.setSystemTime((next.purchaseDate as number) + DAY);
        expect(pro(newest.user)).toBe(true);
        for (const u of others(newest.user)) expect(pro(u)).toBe(false);
    });
});

// ─── 監査で見つかった並び（F1〜F4）と、前の持ち主の返金 ────────────────────

describe("監査の並び", () => {
    async function u1Buys() {
        db.set({ userId: "u1", rev: 1 });
        db.set({ userId: "u2", rev: 1 });
        expect((await purchase("u1", signJws(O1()))).statusCode).toBe(200);
    }

    it("F1: 付け替えのあとに、アップグレード前の R の JWS を送り直しても取り返せない", async () => {
        await u1Buys();
        vi.setSystemTime(E - 11 * H);
        expect((await purchase("u1", signJws(R1e()))).statusCode).toBe(200);
        vi.setSystemTime(U + MIN);
        expect((await purchase("u2", signJws(UP2()))).statusCode).toBe(200);
        expect(db.get(OTX)).toMatchObject({ ownerId: "u2", lastPurchaseDate: U });
        const linkBefore = db.get(OTX);
        const u2Before = db.get("u2");
        // E の前でも後でも（前は purchaseDate=E を今で抑えた値が U より新しく見えて取り返していた）
        for (const at of [U + 2 * H, E + H]) {
            vi.setSystemTime(at);
            const res = await purchase("u1", signJws(R1e()));
            expect(res.statusCode).toBe(409);
            expect(JSON.parse(res.body).code).toBe("claimed_by_other_account");
            expect(db.get(OTX)).toEqual(linkBefore);
            expect(db.get("u2")).toEqual(u2Before);
            expect(pro("u2")).toBe(true);
            expect(pro("u1")).toBe(false);
        }
    });

    it("F2: u2 のアップグレードのあとに持ち主（u1）が R を送り直しても、遅れた u2 の POST は付け替えられる", async () => {
        await u1Buys();
        // u2 は U にアップグレードしたが、アプリからの送信が遅れている。その間に u1 の端末から R
        vi.setSystemTime(U + 30 * MIN);
        expect((await purchase("u1", signJws(R1e()))).statusCode).toBe(200);
        // 鍵は R の min(purchaseDate, signedDate)＝E-12h（今＝U+30分 まで進めない）
        expect(db.get(OTX)).toMatchObject({ ownerId: "u1", lastPurchaseDate: E - 12 * H });
        vi.setSystemTime(U + H);
        const res = await purchase("u2", signJws(UP2()));
        expect(res.statusCode, res.body).toBe(200);
        expect(db.get(OTX)).toMatchObject({ ownerId: "u2", previousOwnerId: "u1", lastPurchaseDate: U });
        expect(pro("u2")).toBe(true);
        expect(pro("u1")).toBe(false);
    });

    it("F3: u2 のアップグレードの知らせだけで u1 の Pro が終わる（u2 は POST するまで Pro にならない）", async () => {
        await u1Buys();
        vi.setSystemTime(U + MIN);
        const u2Before = db.get("u2");
        const linkBefore = db.get(OTX)!;
        expect((await notify(notificationJws({ type: "DID_CHANGE_RENEWAL_PREF", subtype: "UPGRADE", uuid: "up-1", tx: UP2() }))).statusCode).toBe(200);
        expect(pro("u1")).toBe(false);
        expect(db.get("u1")).toMatchObject({ supporter: { number: 1, active: false } });
        // 知らせでは u2 を Pro にしない・持ち主も鍵も動かさない
        expect(db.get("u2")).toEqual(u2Before);
        expect(db.get(OTX)).toMatchObject({ ownerId: "u1", lastPurchaseDate: linkBefore.lastPurchaseDate, seen: ["up-1"] });
        // u2 が POST すると付け替わって Pro
        vi.setSystemTime(U + H);
        expect((await purchase("u2", signJws(UP2()))).statusCode).toBe(200);
        expect(pro("u2")).toBe(true);
        expect(pro("u1")).toBe(false);
    });

    it("F4: 古い行（鍵なし）で、u2 の POST が E のあとに届いても付け替えられる", async () => {
        await u1Buys();
        vi.setSystemTime(E - 11 * H);
        expect((await notify(notificationJws({ type: "DID_RENEW", tx: R1e() }))).statusCode).toBe(200);
        const legacy = { ...db.get(OTX)! };
        delete legacy.lastPurchaseDate;
        db.set(legacy);
        // E を過ぎると、前倒しの更新の期間（始まり E）が「始まった期間」になる
        vi.setSystemTime(E + H);
        const res = await purchase("u2", signJws(UP2()));
        expect(res.statusCode, res.body).toBe(200);
        expect(db.get(OTX)).toMatchObject({ ownerId: "u2", previousOwnerId: "u1", lastPurchaseDate: U });
        expect(pro("u2")).toBe(true);
        expect(pro("u1")).toBe(false);
    });

    it("付け替えのあとに届いた前の持ち主の古い取引の返金は、前の持ち主の期間を切る（今の持ち主には書かない）", async () => {
        await u1Buys();
        vi.setSystemTime(T0 + 10 * DAY);
        const moved = tokenTx("u2", { transactionId: "2000000000000040", purchaseDate: T0 + 10 * DAY - MIN, expiresDate: T0 + 41 * DAY, signedDate: T0 + 10 * DAY - 30_000 });
        expect((await purchase("u2", signJws(moved))).statusCode).toBe(200);
        const u2Before = db.get("u2");
        // u1 の最初の取引（T0〜T0+10日）を、付け替えのあとに返金（取り消しは T0+2日）
        vi.setSystemTime(T0 + 12 * DAY);
        const refunded = tokenTx("u1", { revocationDate: T0 + 2 * DAY, revocationReason: 0, signedDate: T0 + 12 * DAY });
        expect((await notify(notificationJws({ type: "REFUND", tx: refunded }))).statusCode).toBe(200);
        const p = (supporterOf("u1").periods ?? []) as unknown as { id: string; end: string }[];
        expect(p.find((x) => x.id === "2000000000000001")?.end).toBe(new Date(T0 + 2 * DAY).toISOString());
        expect(pro("u1")).toBe(false);
        expect(db.get("u2")).toEqual(u2Before);
        expect(pro("u2")).toBe(true);
    });

    it("付け替えの書き込みで負けたら、読み直して鍵で決め直す（古い側は other・新しい側は移す）", async () => {
        await u1Buys();
        vi.setSystemTime(U + H);
        const real = db.send;
        let injected = false;
        db.send = async (cmd) => {
            // u2 が付け替えを書く直前に、u1 の本当に新しい取引（鍵 U+30分）で鍵が進んだ
            if (!injected && cmd.constructor.name === "PutCommand" && (cmd.input.Item as { ownerId?: string })?.ownerId === "u2") {
                injected = true;
                const cur = db.get(OTX)!;
                db.set({ ...cur, lastPurchaseDate: U + 30 * MIN, rev: (cur.rev as number) + 1 });
            }
            return real(cmd);
        };
        const res = await purchase("u2", signJws(UP2()));
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body).code).toBe("claimed_by_other_account");
        expect(db.get(OTX)).toMatchObject({ ownerId: "u1" });
    });
});

// ─── 付け替えより前の、token の無い取引（オファーコード・設定からの申し込み直し） ─────────────

describe("付け替えより前の token の無い取引は、今の持ち主に重ねない", () => {
    /** u1 がオファーコードで使い始めた取引（token なし・10月） */
    const offer = (over: Tx = {}): Tx => txPayload(over);
    /** u1 の返金（取り消しは T0+2日・知らせは u2 の付け替えのあと） */
    const refunded = (): Tx => offer({ revocationDate: T0 + 2 * DAY, revocationReason: 0, signedDate: RS + DAY });

    /** u1 がコードで使い始め → 期限切れ → u2 が同じ Apple ID で自分の token で申し込み直す（付け替え） */
    async function transferAfterOffer() {
        db.set({ userId: "u1", rev: 1 });
        db.set({ userId: "u2", rev: 1 });
        expect((await purchase("u1", signJws(offer()))).statusCode).toBe(200);
        expect(db.get(OTX)).toMatchObject({ ownerId: "u1" });
        vi.setSystemTime(RS + MIN);
        expect((await purchase("u2", signJws(RS2()))).statusCode).toBe(200);
        expect(db.get(OTX)).toMatchObject({ ownerId: "u2", previousOwnerId: "u1" });
        vi.setSystemTime(RS + DAY + MIN);
        return { u2Before: db.get("u2")!, u1Before: db.get("u1")! };
    }
    const u1PeriodEnd = () => ((supporterOf("u1").periods ?? []) as unknown as { id: string; end: string }[])
        .find((x) => x.id === "2000000000000001")?.end;

    it("付け替えた取引の鍵を transferKey に覚える", async () => {
        await transferAfterOffer();
        expect(db.get(OTX)).toMatchObject({ ownerId: "u2", previousOwnerId: "u1", transferKey: RS, lastPurchaseDate: RS });
    });

    for (const type of ["REFUND", "REFUND_DECLINED", "CONSUMPTION_REQUEST"]) {
        it(`知らせ ${type}: u2 の期間・月数・メダルは変わらない`, async () => {
            const { u2Before, u1Before } = await transferAfterOffer();
            const tx = type === "REFUND" ? refunded() : offer({ signedDate: RS + DAY });
            expect((await notify(notificationJws({ type, tx, uuid: `n-${type}` }))).statusCode).toBe(200);
            expect(db.get("u2")).toEqual(u2Before);
            expect(pro("u2")).toBe(true);
            expect(db.get(OTX)).toMatchObject({ ownerId: "u2", seen: [`n-${type}`] });
            if (type === "REFUND") {
                // 返金は前の持ち主の期間を切る
                expect(u1PeriodEnd()).toBe(new Date(T0 + 2 * DAY).toISOString());
            } else {
                expect(db.get("u1")).toEqual(u1Before);
            }
        });
    }

    it("POST: u2 の端末が古い token の無い取引を送っても、書かずに 200（u2 は変わらない）", async () => {
        const { u2Before, u1Before } = await transferAfterOffer();
        const linkBefore = db.get(OTX);
        const res = await purchase("u2", signJws(offer({ signedDate: RS + DAY })));
        expect(res.statusCode, res.body).toBe(200);
        expect(JSON.parse(res.body)).toMatchObject({ userId: "u2" });
        expect(db.get("u2")).toEqual(u2Before);
        expect(db.get("u1")).toEqual(u1Before);
        expect(db.get(OTX)).toEqual(linkBefore);
    });

    it("POST: 古い token の無い取引が取り消し済みなら、前の持ち主の期間を切る（u2 は変わらない）", async () => {
        const { u2Before } = await transferAfterOffer();
        const res = await purchase("u2", signJws(refunded()));
        expect(res.statusCode, res.body).toBe(200);
        expect(db.get("u2")).toEqual(u2Before);
        expect(u1PeriodEnd()).toBe(new Date(T0 + 2 * DAY).toISOString());
        expect(db.get(OTX)).toMatchObject({ ownerId: "u2", previousOwnerId: "u1" });
    });

    it("付け替えより後の token の無い取引（u2 が設定から申し込み直した等）は u2 に重ねる", async () => {
        await transferAfterOffer();
        const later = offer({ transactionId: "2000000000000050", purchaseDate: RS + 31 * DAY, expiresDate: RS + 62 * DAY, signedDate: RS + 31 * DAY + 1000 });
        vi.setSystemTime(RS + 31 * DAY + MIN);
        expect((await purchase("u2", signJws(later))).statusCode).toBe(200);
        expect((supporterOf("u2").periods ?? []).map((p) => p.id)).toContain("2000000000000050");
        expect(pro("u2")).toBe(true);
    });
});

// ─── 持ち主の移り変わり（付け替えが2回以上あったとき） ─────────────────────────────

describe("付け替えが2回以上でも、token の無い古い取引はそのときの持ち主のもの", () => {
    /** u1 がオファーコードで使い始めた取引（token なし・T0） */
    const offer = (over: Tx = {}): Tx => txPayload(over);
    /** 2回目の付け替え（u2 が期限切れになったあと、RS3 に申し込み直す） */
    const RS3 = RS + 100 * DAY;
    const resub = (userId: string): Tx => tokenTx(userId, {
        transactionId: "2000000000000060", purchaseDate: RS3, expiresDate: RS3 + 31 * DAY, signedDate: RS3 + 1000,
    });
    /** u1 の最初の取引の返金（取り消しは T0+2日・知らせは2回目の付け替えのあと） */
    const refundedOffer = (): Tx => offer({ revocationDate: T0 + 2 * DAY, revocationReason: 0, signedDate: RS3 + DAY });
    /** u2 が持っていた間の token の無い取引（設定から申し込み直した等・RS+31日） */
    const U2_TOKENLESS = "2000000000000050";
    const u2Tokenless = (over: Tx = {}): Tx => offer({
        transactionId: U2_TOKENLESS, purchaseDate: RS + 31 * DAY, expiresDate: RS + 62 * DAY, signedDate: RS + 31 * DAY + 1000, ...over,
    });
    const periodEnd = (userId: string, id: string) => ((supporterOf(userId).periods ?? []) as unknown as { id: string; end: string }[])
        .find((x) => x.id === id)?.end;

    /** u1（コード）→ u2（token）→ third（token）。third が u1 なら u1 に戻る */
    async function twoTransfers(third: string, opts: { u2TokenlessDuringTenure?: boolean; legacyAfterFirst?: boolean } = {}) {
        for (const u of ["u1", "u2", "u3"]) db.set({ userId: u, rev: 1 });
        expect((await purchase("u1", signJws(offer()))).statusCode).toBe(200);
        vi.setSystemTime(RS + MIN);
        expect((await purchase("u2", signJws(RS2()))).statusCode).toBe(200);
        if (opts.legacyAfterFirst) {
            // 履歴の欄より前に付け替えた行（previousOwnerId と transferKey だけ）
            const legacy = { ...db.get(OTX)! };
            delete legacy.owners;
            db.set(legacy);
        }
        if (opts.u2TokenlessDuringTenure) {
            vi.setSystemTime(RS + 31 * DAY + MIN);
            expect((await purchase("u2", signJws(u2Tokenless()))).statusCode).toBe(200);
            expect((supporterOf("u2").periods ?? []).map((p) => p.id)).toContain(U2_TOKENLESS);
        }
        vi.setSystemTime(RS3 + MIN);
        const res = await purchase(third, signJws(resub(third)));
        expect(res.statusCode, res.body).toBe(200);
        expect(db.get(OTX)).toMatchObject({
            ownerId: third, previousOwnerId: "u2", transferKey: RS3,
            owners: [{ ownerId: "u1", untilKey: RS }, { ownerId: "u2", untilKey: RS3 }],
        });
        vi.setSystemTime(RS3 + DAY + MIN);
        return { u1: db.get("u1")!, u2: db.get("u2")!, u3: db.get("u3")! };
    }

    for (const via of ["notify", "post"] as const) {
        const send = (owner: string, tx: Tx, uuid: string) => (via === "notify"
            ? notify(notificationJws({ type: "REFUND", tx, uuid }))
            : purchase(owner, signJws(tx)));

        it(`${via}: u1 → u2 → u1 で u1 の最初の取引の返金は u1 の期間を切る（u2 には書かない）`, async () => {
            const before = await twoTransfers("u1");
            const res = await send("u1", refundedOffer(), "r-1");
            expect(res.statusCode, res.body).toBe(200);
            expect(periodEnd("u1", "2000000000000001")).toBe(new Date(T0 + 2 * DAY).toISOString());
            expect(db.get("u2")).toEqual(before.u2);
            expect(db.get(OTX)).toMatchObject({ ownerId: "u1" });
        });

        it(`${via}: u1 → u2 → u3 で u1 の最初の取引の返金は u1 の期間を切る（u2・u3 は変わらない）`, async () => {
            const before = await twoTransfers("u3");
            const res = await send("u3", refundedOffer(), "r-2");
            expect(res.statusCode, res.body).toBe(200);
            expect(periodEnd("u1", "2000000000000001")).toBe(new Date(T0 + 2 * DAY).toISOString());
            expect(db.get("u2")).toEqual(before.u2);
            expect(db.get("u3")).toEqual(before.u3);
            expect(pro("u3")).toBe(true);
        });

        it(`${via}: u2 が持っていた間の token の無い取引の返金は u2 の期間を切る（u1・u3 は変わらない）`, async () => {
            const before = await twoTransfers("u3", { u2TokenlessDuringTenure: true });
            const res = await send("u3", u2Tokenless({ revocationDate: RS + 33 * DAY, revocationReason: 0, signedDate: RS3 + DAY }), "r-3");
            expect(res.statusCode, res.body).toBe(200);
            expect(periodEnd("u2", U2_TOKENLESS)).toBe(new Date(RS + 33 * DAY).toISOString());
            expect(db.get("u1")).toEqual(before.u1);
            expect(db.get("u3")).toEqual(before.u3);
        });

        it(`${via}: 返金でない古い token の無い取引は誰にも書かない（200）`, async () => {
            const before = await twoTransfers("u3");
            const linkBefore = db.get(OTX)!;
            const tx = offer({ signedDate: RS3 + DAY });
            const res = via === "notify"
                ? await notify(notificationJws({ type: "CONSUMPTION_REQUEST", tx, uuid: "c-1" }))
                : await purchase("u3", signJws(tx));
            expect(res.statusCode, res.body).toBe(200);
            expect(db.get("u1")).toEqual(before.u1);
            expect(db.get("u2")).toEqual(before.u2);
            expect(db.get("u3")).toEqual(before.u3);
            expect(db.get(OTX)).toMatchObject({ ownerId: "u3", owners: linkBefore.owners });
        });

        it(`${via}: 履歴の欄より前に付け替えた行（1回ぶん）は、その1回を履歴とみなす`, async () => {
            for (const u of ["u1", "u2"]) db.set({ userId: u, rev: 1 });
            expect((await purchase("u1", signJws(offer()))).statusCode).toBe(200);
            vi.setSystemTime(RS + MIN);
            expect((await purchase("u2", signJws(RS2()))).statusCode).toBe(200);
            const legacy = { ...db.get(OTX)! };
            delete legacy.owners;
            db.set(legacy);
            vi.setSystemTime(RS + DAY + MIN);
            const u2Before = db.get("u2");
            const res = await send("u2", offer({ revocationDate: T0 + 2 * DAY, revocationReason: 0, signedDate: RS + DAY }), "r-4");
            expect(res.statusCode, res.body).toBe(200);
            expect(periodEnd("u1", "2000000000000001")).toBe(new Date(T0 + 2 * DAY).toISOString());
            expect(db.get("u2")).toEqual(u2Before);
        });

        it(`${via}: 古い行のあとにもう一度付け替えると、古い1回ぶんを履歴の先頭に入れる（u1 の返金は u1 へ）`, async () => {
            const before = await twoTransfers("u3", { legacyAfterFirst: true });
            const res = await send("u3", refundedOffer(), "r-5");
            expect(res.statusCode, res.body).toBe(200);
            expect(periodEnd("u1", "2000000000000001")).toBe(new Date(T0 + 2 * DAY).toISOString());
            expect(db.get("u2")).toEqual(before.u2);
            expect(db.get("u3")).toEqual(before.u3);
        });
    }

    it("token の付いた u1 の取引の返金も、u1 → u2 → u3 のあとなら u1 の期間を切る（u2・u3 は変わらない）", async () => {
        for (const u of ["u1", "u2", "u3"]) db.set({ userId: u, rev: 1 });
        expect((await purchase("u1", signJws(O1()))).statusCode).toBe(200);
        vi.setSystemTime(RS + MIN);
        expect((await purchase("u2", signJws(RS2()))).statusCode).toBe(200);
        vi.setSystemTime(RS3 + MIN);
        expect((await purchase("u3", signJws(resub("u3")))).statusCode).toBe(200);
        const u2Before = db.get("u2");
        const u3Before = db.get("u3");
        vi.setSystemTime(RS3 + DAY);
        const tx = tokenTx("u1", { revocationDate: T0 + 2 * DAY, revocationReason: 0, signedDate: RS3 + DAY - MIN });
        expect((await notify(notificationJws({ type: "REFUND", tx, uuid: "r-t" }))).statusCode).toBe(200);
        expect(periodEnd("u1", "2000000000000001")).toBe(new Date(T0 + 2 * DAY).toISOString());
        expect(db.get("u2")).toEqual(u2Before);
        expect(db.get("u3")).toEqual(u3Before);
    });

    it("知らせの記録・鍵を進める書き込みでも履歴は消えない", async () => {
        await twoTransfers("u3");
        const owners = db.get(OTX)!.owners;
        const renew = tokenTx("u3", {
            transactionId: "2000000000000061", purchaseDate: RS3 + 31 * DAY, expiresDate: RS3 + 62 * DAY, signedDate: RS3 + 31 * DAY - H,
        });
        vi.setSystemTime(RS3 + 31 * DAY);
        expect((await notify(notificationJws({ type: "DID_RENEW", tx: renew, uuid: "renew-1" }))).statusCode).toBe(200);
        expect(db.get(OTX)).toMatchObject({ ownerId: "u3", lastPurchaseDate: RS3 + 31 * DAY - H, seen: ["renew-1"], owners });
    });

    it(`履歴は ${OWNERS_MAX} 件まで（あふれたら古いものから落とす）`, async () => {
        db.set({ userId: "u2", rev: 1 });
        db.set({ userId: "u3", rev: 1 });
        // すでに OWNERS_MAX 回付け替えた行（持ち主は u2・鍵は RS）
        const full = Array.from({ length: OWNERS_MAX }, (_, i) => ({ ownerId: `old${i}`, untilKey: T0 + i * DAY }));
        db.set({
            userId: OTX, ownerId: "u2", environment: "Sandbox", createdAt: new Date(T0).toISOString(), seen: [], rev: 5,
            lastPurchaseDate: RS, previousOwnerId: `old${OWNERS_MAX - 1}`, transferKey: T0 + (OWNERS_MAX - 1) * DAY, owners: full,
        });
        vi.setSystemTime(RS3 + MIN);
        expect((await purchase("u3", signJws(resub("u3")))).statusCode).toBe(200);
        const owners = db.get(OTX)!.owners as { ownerId: string; untilKey: number }[];
        expect(owners).toHaveLength(OWNERS_MAX);
        expect(owners[0]).toEqual({ ownerId: "old1", untilKey: T0 + DAY });
        expect(owners[OWNERS_MAX - 1]).toEqual({ ownerId: "u2", untilKey: RS3 });
        // 残っている履歴の持ち主には、その間の取引が届く
        expect(staleTokenlessOwner(parseAppStoreLink(db.get(OTX)!), true, T0 + 5 * DAY + MIN)).toBe("old6");
        expect(staleTokenlessOwner(parseAppStoreLink(db.get(OTX)!), true, RS3 - MIN)).toBe("u2");
        expect(staleTokenlessOwner(parseAppStoreLink(db.get(OTX)!), true, RS3 + MIN)).toBeUndefined();
    });
});

describe("staleTokenlessOwner", () => {
    const base = { ownerId: "u1", seen: [], rev: 3 };
    it("いちばん古い、untilKey が鍵より大きい履歴の持ち主。今の持ち主なら undefined", () => {
        const link = { ...base, previousOwnerId: "u2", transferKey: 300, owners: [{ ownerId: "u1", untilKey: 200 }, { ownerId: "u2", untilKey: 300 }] };
        expect(staleTokenlessOwner(link, true, 100)).toBeUndefined();   // u1 のころ＝今の持ち主
        expect(staleTokenlessOwner(link, true, 200)).toBe("u2");
        expect(staleTokenlessOwner(link, true, 299)).toBe("u2");
        expect(staleTokenlessOwner(link, true, 300)).toBeUndefined();
        expect(staleTokenlessOwner(link, false, 250)).toBeUndefined();  // token の付いた取引
        expect(staleTokenlessOwner(link, true, undefined)).toBeUndefined();
    });
    it("履歴の無い行: previousOwnerId と transferKey を1件とみなす。どちらか無ければ undefined", () => {
        expect(staleTokenlessOwner({ ...base, previousOwnerId: "u2", transferKey: 300 }, true, 100)).toBe("u2");
        expect(staleTokenlessOwner({ ...base, previousOwnerId: "u2" }, true, 100)).toBeUndefined();
        expect(staleTokenlessOwner(base, true, 100)).toBeUndefined();
    });
});
