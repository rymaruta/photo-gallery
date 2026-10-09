import { describe, it, expect, vi, beforeEach } from "vitest";

// App Store の署名の確かめ（`appStore.ts`）。
//
// 本物の Apple の鎖は手元で作れないので、同じ形（x5c 3枚・Apple の OID 付き）の
// テスト用の鎖を作り（`fixtures/appstore/`）、**信じる根だけ差し替えて**公式ライブラリの
// 確かめ役をそのまま通す。差し替えたのは根だけなので、鎖・OID・署名・Bundle ID・
// 環境・アプリの Apple ID の検査は本番と同じ。

const fx = vi.hoisted(() => ({ roots: [] as Buffer[] }));
vi.mock("../appleRootCerts", () => ({ appleRootCertificates: () => fx.roots }));

import {
    APP_ACCOUNT_TOKEN_NAMESPACE, AppStoreSignatureError, appAccountTokenFor, proProductIds, readAppStoreConfig,
    renewalFacts, resetAppStoreVerifiers, transactionFacts, verifyNotificationPayload, verifySignedTransaction,
} from "../appStore";
import type { AppStoreConfig } from "../appStore";
import { APP_APPLE_ID, BUNDLE, MONTHLY, TEST_ROOT_DER, notificationJws, signJws, signingKey, txPayload } from "./fixtures/appstore/signing";

const SANDBOX: AppStoreConfig = { bundleId: BUNDLE, environments: ["Sandbox"] };
const PROD: AppStoreConfig = { bundleId: BUNDLE, environments: ["Production", "Sandbox"], appAppleId: APP_APPLE_ID };

beforeEach(() => {
    fx.roots = [TEST_ROOT_DER];
    resetAppStoreVerifiers();
});

describe("appAccountToken（userId の UUIDv5）", () => {
    it("決まった名前空間で、iOS に渡した例と同じ値になる", () => {
        expect(APP_ACCOUNT_TOKEN_NAMESPACE).toBe("5bbfc476-7442-4f3d-8d7e-4f55931ae30f");
        expect(appAccountTokenFor("7b1c2d3e-0000-4000-8000-000000000001")).toBe("6d109146-376e-5175-8e4c-2439a6bc3c3b");
    });

    it("版 5・RFC 4122 の変種・小文字", () => {
        const t = appAccountTokenFor("ap-northeast-1:abc");
        expect(t).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(appAccountTokenFor("u1")).not.toBe(appAccountTokenFor("u2"));
    });
});

describe("設定（環境変数）", () => {
    it("本番の形: Production と Sandbox・Apple ID つき", () => {
        expect(readAppStoreConfig({ APPSTORE_BUNDLE_ID: BUNDLE, APPSTORE_ENVIRONMENTS: "Production,Sandbox", APPSTORE_APP_APPLE_ID: "6814335283" }))
            .toEqual({ bundleId: BUNDLE, environments: ["Production", "Sandbox"], appAppleId: 6814335283 });
    });

    it("Apple ID が無ければ Production は受けない（Sandbox だけ残る）", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(readAppStoreConfig({ APPSTORE_BUNDLE_ID: BUNDLE, APPSTORE_ENVIRONMENTS: "Production,Sandbox" }))
            .toEqual({ bundleId: BUNDLE, environments: ["Sandbox"] });
        warn.mockRestore();
    });

    it("Bundle ID か環境が無ければ受け付けない（null）。知らない環境名は無視", () => {
        expect(readAppStoreConfig({ APPSTORE_ENVIRONMENTS: "Sandbox" })).toBeNull();
        expect(readAppStoreConfig({ APPSTORE_BUNDLE_ID: BUNDLE })).toBeNull();
        expect(readAppStoreConfig({ APPSTORE_BUNDLE_ID: BUNDLE, APPSTORE_ENVIRONMENTS: "Xcode,LocalTesting" })).toBeNull();
    });

    it("売る商品は2つだけ（Bundle ID から作る）", () => {
        expect(proProductIds(BUNDLE)).toEqual([`${BUNDLE}.pro.monthly`, `${BUNDLE}.pro.yearly`]);
    });
});

describe("取引の署名", () => {
    it("正しい鎖で署名された Sandbox の取引を開く", async () => {
        const { transaction, environment } = await verifySignedTransaction(signJws(txPayload()), SANDBOX);
        expect(environment).toBe("Sandbox");
        expect(transaction.productId).toBe(MONTHLY);
        const f = transactionFacts(transaction, environment);
        expect(typeof f).toBe("object");
        expect(f).toMatchObject({ transactionId: "2000000000000001", environment: "Sandbox", productId: MONTHLY });
    });

    it("本番の設定は Production を先に試し、Sandbox の取引も受ける（TestFlight・審査）", async () => {
        const r = await verifySignedTransaction(signJws(txPayload({ environment: "Sandbox" })), PROD);
        expect(r.environment).toBe("Sandbox");
        const p = await verifySignedTransaction(signJws(txPayload({ environment: "Production" })), PROD);
        expect(p.environment).toBe("Production");
    });

    it("staging（Sandbox だけ）は Production の取引を断る", async () => {
        await expect(verifySignedTransaction(signJws(txPayload({ environment: "Production" })), SANDBOX))
            .rejects.toBeInstanceOf(AppStoreSignatureError);
    });

    it("Xcode の取引（Apple の署名が無い）は受けない", async () => {
        await expect(verifySignedTransaction(signJws(txPayload({ environment: "Xcode" })), PROD))
            .rejects.toBeInstanceOf(AppStoreSignatureError);
    });

    it("信じていない根の鎖は断る", async () => {
        await expect(verifySignedTransaction(signJws(txPayload(), "rogue"), SANDBOX))
            .rejects.toBeInstanceOf(AppStoreSignatureError);
    });

    it("中身を書き換えたら断る（署名が合わない）", async () => {
        const [h, , s] = signJws(txPayload()).split(".");
        const forged = Buffer.from(JSON.stringify(txPayload({ productId: `${BUNDLE}.pro.yearly` }))).toString("base64url");
        await expect(verifySignedTransaction(`${h}.${forged}.${s}`, SANDBOX)).rejects.toBeInstanceOf(AppStoreSignatureError);
    });

    it("別のアプリ（Bundle ID 違い）の取引は断る", async () => {
        await expect(verifySignedTransaction(signJws(txPayload({ bundleId: "com.example.other" })), SANDBOX))
            .rejects.toBeInstanceOf(AppStoreSignatureError);
    });

    it("x5c が無い・3枚でない JWS は断る", async () => {
        const jsonwebtoken = (await import("jsonwebtoken")).default;
        const bare = jsonwebtoken.sign(txPayload(), signingKey(), { algorithm: "ES256", noTimestamp: true });
        await expect(verifySignedTransaction(bare, SANDBOX)).rejects.toBeInstanceOf(AppStoreSignatureError);
    });

    it("本物の Apple の根だけを信じているとき、テストの鎖は通らない", async () => {
        const { appleRootCertificates } = await vi.importActual<typeof import("../appleRootCerts")>("../appleRootCerts");
        fx.roots = appleRootCertificates();
        resetAppStoreVerifiers();
        await expect(verifySignedTransaction(signJws(txPayload()), SANDBOX)).rejects.toBeInstanceOf(AppStoreSignatureError);
    });
});

describe("App Store Server Notifications V2", () => {
    it("知らせと、中の取引・更新の情報を同じ環境で開く", async () => {
        const jws = notificationJws({
            type: "DID_RENEW", uuid: "n-1", tx: txPayload(), renewal: { autoRenewStatus: 1, originalTransactionId: "2000000000000001", signedDate: Date.UTC(2026, 9, 10) },
        });
        const r = await verifyNotificationPayload(jws, SANDBOX);
        expect(r.environment).toBe("Sandbox");
        expect(r.notification.notificationType).toBe("DID_RENEW");
        expect(r.notification.notificationUUID).toBe("n-1");
        expect(r.transaction?.productId).toBe(MONTHLY);
        expect(renewalFacts(r.renewal)).toEqual({ autoRenewStatus: 1 });
    });

    it("本番: アプリの Apple ID が違う知らせは断る", async () => {
        const jws = notificationJws({ type: "SUBSCRIBED", tx: txPayload({ environment: "Production" }), environment: "Production", appAppleId: 1 });
        await expect(verifyNotificationPayload(jws, PROD)).rejects.toBeInstanceOf(AppStoreSignatureError);
        const okJws = notificationJws({ type: "SUBSCRIBED", tx: txPayload({ environment: "Production" }), environment: "Production" });
        await expect(verifyNotificationPayload(okJws, PROD)).resolves.toMatchObject({ environment: "Production" });
    });

    it("本番の設定でも Sandbox の知らせ（TestFlight・審査）を受ける。Sandbox の知らせにはアプリの Apple ID が無い", async () => {
        // Apple の知らせの `data.appAppleId` は Sandbox では入らない。Production の確かめ役は
        // それを「アプリ違い」（INVALID_APP_IDENTIFIER）と言うので、そこで止めると Sandbox まで届かない
        const jws = notificationJws({ type: "DID_RENEW", uuid: "n-sb", tx: txPayload() });
        await expect(verifyNotificationPayload(jws, PROD)).resolves.toMatchObject({ environment: "Sandbox" });
    });

    it("本番の設定: Bundle ID 違いの Sandbox の知らせは、Sandbox を試しても断る", async () => {
        const jws = notificationJws({ type: "DID_RENEW", tx: { ...txPayload(), bundleId: "com.example.other" }, bundleId: "com.example.other" });
        await expect(verifyNotificationPayload(jws, PROD)).rejects.toBeInstanceOf(AppStoreSignatureError);
    });

    it("外側が正しくても、中の取引が信じていない鎖なら断る", async () => {
        const inner = signJws({ ...txPayload(), environment: "Sandbox" }, "rogue");
        const jws = signJws({
            notificationType: "DID_RENEW", notificationUUID: "n-2", version: "2.0", signedDate: Date.UTC(2026, 9, 10),
            data: { environment: "Sandbox", bundleId: BUNDLE, signedTransactionInfo: inner },
        });
        await expect(verifyNotificationPayload(jws, SANDBOX)).rejects.toBeInstanceOf(AppStoreSignatureError);
    });

    it("信じていない根で署名された知らせは断る", async () => {
        const jws = notificationJws({ type: "DID_RENEW", tx: txPayload(), kind: "rogue" });
        await expect(verifyNotificationPayload(jws, SANDBOX)).rejects.toBeInstanceOf(AppStoreSignatureError);
    });
});

describe("取引から使う分を取り出す", () => {
    it("期間の無い取引は使わない（理由を返す）", () => {
        expect(transactionFacts({ transactionId: "1", originalTransactionId: "1", productId: MONTHLY, purchaseDate: 1 }, "Sandbox"))
            .toBe("期間がありません");
        expect(transactionFacts({ productId: MONTHLY }, "Sandbox")).toBe("取引の番号がありません");
    });
});
