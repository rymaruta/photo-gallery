import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Pro の購入（POST /user/purchases）と App Store Server Notifications（POST /appstore/notifications）、
// その保存（`supporterStore.ts`）。
//
// 署名は本物の公式ライブラリで確かめる（信じる根だけテスト用に差し替える・`appStore.test.ts`）。
// 表は小さな偽物（`fixtures/fakeUsersTable.ts`）で、条件つきの Put を本物と同じく断る。

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
import { allocateSupporterNumber, applyToProfile, claimAppStoreLink, forgetAppStoreLinks } from "../supporterStore";
import { appAccountTokenFor, resetAppStoreVerifiers } from "../appStore";
import { FakeUsersTable } from "./fixtures/fakeUsersTable";
import {
    BUNDLE, MONTHLY, TEST_ROOT_DER, YEARLY, notificationJws, signJws, txPayload,
} from "./fixtures/appstore/signing";

type Result = { statusCode: number; body: string };
let db: FakeUsersTable;

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 10, 3, 0, 0);   // 2026-10-10 12:00 JST（秋）

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
    vi.setSystemTime(T0 + 60_000);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

const purchase = (userId: string, body: unknown): Promise<Result> =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (recordPurchase as any)({
        requestContext: { authorizer: { jwt: { claims: { sub: userId } } } },
        body: typeof body === "string" ? body : JSON.stringify(body),
    });
const notify = (body: unknown): Promise<Result> =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (appStoreNotification as any)({ body: typeof body === "string" ? body : JSON.stringify(body) });

const tokenTx = (userId: string, over: Record<string, unknown> = {}) =>
    txPayload({ appAccountToken: appAccountTokenFor(userId), ...over });

describe("POST /user/purchases", () => {
    it("確かめて有効にし、番号を振り、公開プロフィールの形で返す（取引の番号は出さない）", async () => {
        db.set({ userId: "u1", displayName: "旅人", rev: 2 });
        const res = await purchase("u1", { signedTransaction: signJws(tokenTx("u1")) });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.pro).toBe(true);
        expect(body.supporter).toEqual({ number: 1, since: new Date(T0).toISOString(), months: 0 });
        expect(body.badges.supporter.tier).toBe(1);
        expect(body.badges.proAutumn2026).toMatchObject({ tier: 1, year: 2026 });
        expect(body.displayName).toBe("旅人");
        expect(res.body).not.toContain("2000000000000001");
        expect(res.body).not.toContain(MONTHLY);
        expect(res.body).not.toContain("expiresAt");
        expect(res.body).not.toContain("periods");

        const row = db.get("u1")!;
        expect(row.rev).toBe(3);
        expect(row.supporter).toMatchObject({ number: 1, active: true, originalTransactionId: "2000000000000001", environment: "Sandbox" });
        expect(db.get("appstore#2000000000000001")).toMatchObject({ ownerId: "u1", environment: "Sandbox" });
        expect(db.get("counter#supporter#sandbox")).toMatchObject({ issued: 1 });
        // 付いたメダルを知らせる（書けてから）
        expect(pushNotification.mock.calls.map((c) => c[1].key)).toEqual(["supporter", "proAutumn2026"]);
        expect(pushNotification.mock.calls[1][1]).toMatchObject({ type: "badge", byName: "秋の章（2026）", tier: 1 });
    });

    it("同じ取引を送り直しても番号は変わらず、通知も重ねない", async () => {
        db.set({ userId: "u1" });
        const jws = signJws(tokenTx("u1"));
        await purchase("u1", { signedTransaction: jws });
        pushNotification.mockClear();
        const again = await purchase("u1", { signedTransaction: jws });
        expect(JSON.parse(again.body).supporter.number).toBe(1);
        expect(db.get("counter#supporter#sandbox")).toMatchObject({ issued: 1 });
        expect(pushNotification).not.toHaveBeenCalled();
    });

    it("行が無い人でも作って記録する（購入を落とさない）", async () => {
        const res = await purchase("u9", { signedTransaction: signJws(tokenTx("u9")) });
        expect(res.statusCode).toBe(200);
        expect(db.get("u9")).toMatchObject({ userId: "u9", rev: 1, supporter: { number: 1 } });
    });

    it("退会済みは 410（行を生き返らせない）", async () => {
        db.set({ userId: "u1", deletedAt: "2026-10-01T00:00:00Z" });
        const res = await purchase("u1", { signedTransaction: signJws(tokenTx("u1")) });
        expect(res.statusCode).toBe(410);
        expect(db.get("u1")).toEqual({ userId: "u1", deletedAt: "2026-10-01T00:00:00Z" });
    });

    it("appAccountToken が別の人のものなら 403", async () => {
        db.set({ userId: "u1" });
        const res = await purchase("u1", { signedTransaction: signJws(tokenTx("u2")) });
        expect(res.statusCode).toBe(403);
        expect(db.get("u1")).toEqual({ userId: "u1" });
        expect(db.get("appstore#2000000000000001")).toBeUndefined();
    });

    it("別の人に結び付いた取引は 409（appAccountToken の無い取引でも横取りさせない）", async () => {
        db.set({ userId: "u1" });
        db.set({ userId: "u2" });
        expect((await purchase("u1", { signedTransaction: signJws(txPayload()) })).statusCode).toBe(200);
        const res = await purchase("u2", { signedTransaction: signJws(txPayload()) });
        expect(res.statusCode).toBe(409);
        expect(db.get("u2")).toEqual({ userId: "u2" });
    });

    it("同じ Apple ID で別のアカウントが申し込み直した（新しい取引に自分の token）→ 結び付けを移す", async () => {
        db.set({ userId: "u1" });
        db.set({ userId: "u2" });
        // u1 が買って、やめた（期限切れ）
        expect((await purchase("u1", { signedTransaction: signJws(tokenTx("u1")) })).statusCode).toBe(200);
        // 同じ Apple ID のまま u2 で申し込み直す: originalTransactionId は同じ、token は u2
        const again = tokenTx("u2", {
            transactionId: "2000000000000009", purchaseDate: T0 + 40 * DAY, expiresDate: T0 + 71 * DAY, signedDate: T0 + 40 * DAY,
        });
        vi.setSystemTime(T0 + 40 * DAY + 60_000);
        const res = await purchase("u2", { signedTransaction: signJws(again) });
        expect(res.statusCode).toBe(200);
        expect(db.get("appstore#2000000000000001")).toMatchObject({ ownerId: "u2", previousOwnerId: "u1" });
        expect(db.get("u2")).toMatchObject({ supporter: { number: 2, active: true } });
        // 前の人の番号は残る
        expect(db.get("u1")).toMatchObject({ supporter: { number: 1 } });
        // 前の人の token の付いた古い取引では取り返せない（403）
        expect((await purchase("u1", { signedTransaction: signJws(again) })).statusCode).toBe(403);
        // 知らせは新しい持ち主に届く
        const renew = notificationJws({
            type: "DID_RENEW",
            tx: tokenTx("u2", { transactionId: "2000000000000010", purchaseDate: T0 + 71 * DAY, expiresDate: T0 + 102 * DAY, signedDate: T0 + 71 * DAY }),
        });
        vi.setSystemTime(T0 + 71 * DAY + 60_000);
        expect((await notify({ signedPayload: renew })).statusCode).toBe(200);
        expect(db.get("u2")).toMatchObject({ supporter: { expiresAt: new Date(T0 + 102 * DAY).toISOString() } });
    });

    it("署名を確かめられない・形が違う・売っていない商品は 400", async () => {
        db.set({ userId: "u1" });
        expect((await purchase("u1", { signedTransaction: signJws(tokenTx("u1"), "rogue") })).statusCode).toBe(400);
        expect((await purchase("u1", { signedTransaction: "abc" })).statusCode).toBe(400);
        expect((await purchase("u1", {})).statusCode).toBe(400);
        expect((await purchase("u1", "{not json")).statusCode).toBe(400);
        expect((await purchase("u1", { signedTransaction: signJws(tokenTx("u1", { productId: `${BUNDLE}.tip` })) })).statusCode).toBe(400);
        expect((await purchase("u1", { signedTransaction: signJws(tokenTx("u1", { type: "Non-Consumable" })) })).statusCode).toBe(400);
        expect(db.get("u1")).toEqual({ userId: "u1" });
    });

    it("認証が無ければ 401、設定が無ければ 503", async () => {
        expect((await purchase("", { signedTransaction: "a.b.c" })).statusCode).toBe(401);
        vi.stubEnv("APPSTORE_BUNDLE_ID", "");
        vi.spyOn(console, "error").mockImplementation(() => {});
        expect((await purchase("u1", { signedTransaction: signJws(tokenTx("u1")) })).statusCode).toBe(503);
    });
});

describe("POST /appstore/notifications", () => {
    async function subscribed(userId = "u1") {
        db.set({ userId, rev: 1 });
        const res = await purchase(userId, { signedTransaction: signJws(tokenTx(userId)) });
        expect(res.statusCode).toBe(200);
        pushNotification.mockClear();
    }

    it("署名を確かめられなければ 400・形が違っても 400", async () => {
        expect((await notify({ signedPayload: notificationJws({ type: "DID_RENEW", tx: txPayload(), kind: "rogue" }) })).statusCode).toBe(400);
        expect((await notify({})).statusCode).toBe(400);
        expect((await notify("nope")).statusCode).toBe(400);
    });

    it("DID_RENEW: 期限を延ばし、月数が進む。同じ知らせは二度処理しない", async () => {
        await subscribed();
        const renew = txPayload({
            transactionId: "2000000000000002", purchaseDate: T0 + 31 * DAY, expiresDate: T0 + 61 * DAY,
            signedDate: T0 + 31 * DAY + 1000, appAccountToken: appAccountTokenFor("u1"),
        });
        vi.setSystemTime(T0 + 32 * DAY);
        const jws = notificationJws({ type: "DID_RENEW", uuid: "renew-1", tx: renew, renewal: { autoRenewStatus: 1, signedDate: T0 + 31 * DAY } });
        expect((await notify({ signedPayload: jws })).statusCode).toBe(200);
        const row = db.get("u1")!;
        expect(row.supporter).toMatchObject({ active: true, number: 1, expiresAt: new Date(T0 + 61 * DAY).toISOString(), autoRenew: true });
        expect((row.supporter as { periods: unknown[] }).periods).toHaveLength(2);
        expect(db.get("appstore#2000000000000001")!.seen).toEqual(["renew-1"]);

        const before = db.calls.filter((c) => c.name === "PutCommand").length;
        expect((await notify({ signedPayload: jws })).statusCode).toBe(200);
        expect(db.calls.filter((c) => c.name === "PutCommand").length).toBe(before);
    });

    it("EXPIRED: Pro の印は消え、番号とメダルは残る。再開すると同じ番号で続きから", async () => {
        await subscribed();
        vi.setSystemTime(T0 + 40 * DAY);
        const t1 = tokenTx("u1");
        expect((await notify({ signedPayload: notificationJws({ type: "EXPIRED", subtype: "VOLUNTARY", tx: t1, signedDate: T0 + 40 * DAY }) })).statusCode).toBe(200);
        let row = db.get("u1")!;
        expect(row.supporter).toMatchObject({ active: false, number: 1 });
        expect(row.badges).toHaveProperty("supporter");
        expect(row.badges).toHaveProperty("proAutumn2026");

        // 冬に再開（同じ originalTransactionId で新しい取引）
        const back = T0 + 70 * DAY;   // 2026-12-19
        vi.setSystemTime(back + 1000);
        const t2 = tokenTx("u1", { transactionId: "2000000000000003", purchaseDate: back, expiresDate: back + 31 * DAY, signedDate: back + 10 });
        expect((await notify({ signedPayload: notificationJws({ type: "SUBSCRIBED", subtype: "RESUBSCRIBE", tx: t2, signedDate: back + 20 }) })).statusCode).toBe(200);
        row = db.get("u1")!;
        expect(row.supporter).toMatchObject({ active: true, number: 1 });
        expect(row.badges).toHaveProperty("proWinter2026");
        expect(db.get("counter#supporter#sandbox")).toMatchObject({ issued: 1 });
        expect(pushNotification.mock.calls.map((c) => c[1].key)).toEqual(["proWinter2026"]);
    });

    it("REFUND（今の期間）で Pro が終わる", async () => {
        await subscribed();
        vi.setSystemTime(T0 + 3 * DAY);
        const refunded = tokenTx("u1", { revocationDate: T0 + 3 * DAY, revocationReason: 0, signedDate: T0 + 3 * DAY });
        expect((await notify({ signedPayload: notificationJws({ type: "REFUND", tx: refunded }) })).statusCode).toBe(200);
        expect(db.get("u1")!.supporter).toMatchObject({ active: false, number: 1 });
    });

    it("まだ誰にも結び付いていない取引の知らせは、記録だけして 200（行を作らない）", async () => {
        const res = await notify({ signedPayload: notificationJws({ type: "SUBSCRIBED", tx: txPayload({ originalTransactionId: "999" }) }) });
        expect(res.statusCode).toBe(200);
        expect([...db.rows.keys()]).toEqual([]);
    });

    it("扱っていない商品・取引の無い知らせ（TEST）は 200 で何もしない", async () => {
        await subscribed();
        const before = db.calls.length;
        expect((await notify({ signedPayload: notificationJws({ type: "DID_RENEW", tx: tokenTx("u1", { productId: `${BUNDLE}.other` }) }) })).statusCode).toBe(200);
        const test = signJws({ notificationType: "TEST", notificationUUID: "t", version: "2.0", signedDate: T0, data: { environment: "Sandbox", bundleId: BUNDLE } });
        expect((await notify({ signedPayload: test })).statusCode).toBe(200);
        expect(db.calls.length).toBe(before);
    });

    it("書き込みで落ちたら 500（Apple に送り直させる）。送り直しは同じ結果で、二重に処理しない", async () => {
        await subscribed();
        vi.spyOn(console, "error").mockImplementation(() => {});
        const renew = notificationJws({
            type: "DID_RENEW", uuid: "retry-1",
            tx: tokenTx("u1", { transactionId: "2000000000000002", purchaseDate: T0 + 31 * DAY, expiresDate: T0 + 62 * DAY, signedDate: T0 + 31 * DAY }),
        });
        table.current = { send: async () => { throw new Error("throttled"); } } as never;
        expect((await notify({ signedPayload: renew })).statusCode).toBe(500);
        // 直ったあとの送り直し → 反映して 200。もう一度来ても書かない
        table.current = db as never;
        expect((await notify({ signedPayload: renew })).statusCode).toBe(200);
        const after = db.get("u1");
        expect(after).toMatchObject({ supporter: { number: 1, active: true, expiresAt: new Date(T0 + 62 * DAY).toISOString() } });
        const before = db.calls.length;
        expect((await notify({ signedPayload: renew })).statusCode).toBe(200);
        expect(db.calls.slice(before).some((c) => c.name !== "GetCommand")).toBe(false);
        expect(db.get("u1")).toEqual(after);
    });

    it("競合が続いて書けなかったら 500", async () => {
        await subscribed();
        vi.spyOn(console, "error").mockImplementation(() => {});
        // プロフィールの行の Put だけ毎回断る（他の人が書き続けている形）
        table.current = {
            send: async (c: { constructor: { name: string }; input: Record<string, unknown> }) => {
                if (c.constructor.name === "PutCommand" && (c.input.Item as { userId?: string }).userId === "u1") {
                    const { condFail } = await import("./fixtures/fakeUsersTable");
                    throw condFail();
                }
                return db.send(c);
            },
        } as never;
        const res = await notify({ signedPayload: notificationJws({ type: "EXPIRED", tx: tokenTx("u1") }) });
        expect(res.statusCode).toBe(500);
    });

    it("設定が無ければ 500（Apple に送り直させる）", async () => {
        vi.stubEnv("APPSTORE_ENVIRONMENTS", "");
        vi.spyOn(console, "error").mockImplementation(() => {});
        expect((await notify({ signedPayload: "a.b.c" })).statusCode).toBe(500);
    });

    it("年ごとの切り替え（DID_CHANGE_RENEWAL_PREF のあとの DID_RENEW）も同じ番号で続く", async () => {
        await subscribed();
        const at = T0 + 31 * DAY;
        vi.setSystemTime(at + 1000);
        const yearly = tokenTx("u1", { transactionId: "2000000000000009", productId: YEARLY, purchaseDate: at, expiresDate: at + 365 * DAY, signedDate: at });
        await notify({ signedPayload: notificationJws({ type: "DID_RENEW", tx: yearly }) });
        expect(db.get("u1")!.supporter).toMatchObject({ active: true, number: 1, productId: YEARLY });
    });
});

describe("番号の列（二度と同じ番号を出さない）", () => {
    it("同時に20人が取っても 1〜20 が1つずつ", async () => {
        const got = await Promise.all(Array.from({ length: 20 }, () => allocateSupporterNumber("Production")));
        expect([...got].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
        expect(db.get("counter#supporter")).toMatchObject({ issued: 20 });
        expect(db.get("counter#supporter#sandbox")).toBeUndefined();
    });

    it("同時に3人が初めて買っても、番号はばらばら・欠けない", async () => {
        for (const u of ["a", "b", "c"]) db.set({ userId: u });
        const results = await Promise.all(["a", "b", "c"].map((u) => purchase(u, {
            signedTransaction: signJws(tokenTx(u, { transactionId: `t-${u}`, originalTransactionId: `o-${u}` })),
        })));
        expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200]);
        const numbers = ["a", "b", "c"].map((u) => (db.get(u)!.supporter as { number: number }).number).sort();
        expect(numbers).toEqual([1, 2, 3]);
    });

    it("同じ人のプロフィールの書き込みが競合しても、取った番号を取り直さない", async () => {
        db.set({ userId: "u1", rev: 1 });
        const realSend = db.send;
        let raced = false;
        db.send = async (cmd) => {
            // 1回目のプロフィールの Put の直前に、別の書き込み（プロフィール編集）が割り込む
            if (!raced && cmd.constructor.name === "PutCommand" && (cmd.input.Item as { userId?: string })?.userId === "u1") {
                raced = true;
                db.set({ ...db.get("u1")!, bio: "編集", rev: 2 });
            }
            return realSend(cmd);
        };
        const tx = { transactionId: "t1", originalTransactionId: "o1", productId: MONTHLY, purchaseDate: T0, expiresDate: T0 + 31 * DAY, environment: "Sandbox" as const, signedDate: T0 };
        const out = await applyToProfile("u1", { kind: "PURCHASE", tx, signedAt: T0 }, { createIfMissing: false });
        expect(out.status).toBe("saved");
        expect(db.get("u1")).toMatchObject({ bio: "編集", rev: 3, supporter: { number: 1 } });
        expect(db.get("counter#supporter#sandbox")).toMatchObject({ issued: 1 });
    });
});

describe("取引と人の結び付け", () => {
    it("先に結び付けた人が持ち主（後から来た人は other）", async () => {
        expect(await claimAppStoreLink("o1", "u1", "Sandbox")).toBe("ok");
        expect(await claimAppStoreLink("o1", "u1", "Sandbox")).toBe("ok");
        expect(await claimAppStoreLink("o1", "u2", "Sandbox")).toBe("other");
        // token が本人のものなら移す（同時に2人が移そうとしても、持ち主は1人）
        expect(await claimAppStoreLink("o1", "u2", "Sandbox", { tokenIsMine: true })).toBe("ok");
        expect(db.get("appstore#o1")).toMatchObject({ ownerId: "u2", previousOwnerId: "u1" });
        const both = await Promise.all([
            claimAppStoreLink("o1", "u3", "Sandbox", { tokenIsMine: true }),
            claimAppStoreLink("o1", "u4", "Sandbox", { tokenIsMine: true }),
        ]);
        expect(both.filter((r) => r === "ok")).toHaveLength(1);
        expect(["u3", "u4"]).toContain(db.get("appstore#o1")!.ownerId);
    });

    it("退会で自分の結び付けだけ消す", async () => {
        await claimAppStoreLink("o1", "u1", "Sandbox");
        await claimAppStoreLink("o2", "u2", "Sandbox");
        await forgetAppStoreLinks("u1", { linked: ["o1", "o2"], originalTransactionId: "o1", months: 0, active: false, periods: [] });
        expect(db.get("appstore#o1")).toBeUndefined();
        expect(db.get("appstore#o2")).toMatchObject({ ownerId: "u2" });
    });
});
