/**
 * App Store の署名（JWS）をテストで作る。
 *
 * このフォルダの証明書は**テスト専用に自分で作った鎖**（2026-10-09・openssl）:
 *
 *     root.der            Test Root CA（自己署名・2020〜2120）
 *     intermediate.pem    Test Intermediate（Apple の中間の印 OID 1.2.840.113635.100.6.2.1 を付けた）
 *     leaf.pem            Test Signing（Apple の末端の印 OID 1.2.840.113635.100.6.11.1 を付けた）
 *     leaf-key.pem        末端の秘密鍵（P-256）。**テストの署名専用で、どこにも登録していない**
 *     rogue-*             別の根から作った同じ形の鎖（信用していない根で署名されたもの）
 *
 * 本物の Apple の鎖と同じ検査（`SignedDataVerifier`）を通る形にしてある。本番の確かめ役は
 * `appleRootCerts.ts` の Apple のルートだけを信じるので、この鎖は本番では通らない。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { X509Certificate } from "node:crypto";
import jsonwebtoken from "jsonwebtoken";

const DIR = __dirname;
const read = (f: string) => readFileSync(join(DIR, f));
const derB64 = (pemFile: string) => new X509Certificate(read(pemFile)).raw.toString("base64");

export const TEST_ROOT_DER = read("root.der");

type Chain = "good" | "rogue";

function chain(kind: Chain): { key: Buffer; x5c: string[] } {
    const p = kind === "good" ? "" : "rogue-";
    return {
        key: read(`${p}leaf-key.pem`),
        x5c: [derB64(`${p}leaf.pem`), derB64(`${p}intermediate.pem`), read(`${p}root.der`).toString("base64")],
    };
}

/** 署名した JWS を作る（Apple と同じ ES256・x5c 3枚） */
export function signJws(payload: Record<string, unknown>, kind: Chain = "good"): string {
    const { key, x5c } = chain(kind);
    return jsonwebtoken.sign(payload, key, { algorithm: "ES256", header: { alg: "ES256", x5c } as never, noTimestamp: true });
}

export const BUNDLE = "com.journeyphoto.JourneyPhoto";
export const MONTHLY = `${BUNDLE}.pro.monthly`;
export const YEARLY = `${BUNDLE}.pro.yearly`;
export const APP_APPLE_ID = 6814335283;

const DAY = 86_400_000;

/** 取引の中身（JWSTransactionDecodedPayload の形） */
export function txPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
    const purchaseDate = (over.purchaseDate as number) ?? Date.UTC(2026, 9, 10, 3, 0, 0);
    return {
        transactionId: "2000000000000001",
        originalTransactionId: "2000000000000001",
        bundleId: BUNDLE,
        productId: MONTHLY,
        purchaseDate,
        originalPurchaseDate: purchaseDate,
        expiresDate: purchaseDate + 31 * DAY,
        type: "Auto-Renewable Subscription",
        inAppOwnershipType: "PURCHASED",
        environment: "Sandbox",
        signedDate: purchaseDate + 1000,
        ...over,
    };
}

/** App Store Server Notifications V2 の中身を作って署名する */
export function notificationJws(opts: {
    type: string;
    subtype?: string;
    uuid?: string;
    tx: Record<string, unknown>;
    renewal?: Record<string, unknown>;
    environment?: "Sandbox" | "Production";
    signedDate?: number;
    bundleId?: string;
    appAppleId?: number;
    kind?: Chain;
}): string {
    const environment = opts.environment ?? "Sandbox";
    return signJws({
        notificationType: opts.type,
        ...(opts.subtype ? { subtype: opts.subtype } : {}),
        notificationUUID: opts.uuid ?? `uuid-${Math.random().toString(36).slice(2)}`,
        version: "2.0",
        signedDate: opts.signedDate ?? (opts.tx.signedDate as number),
        data: {
            environment,
            bundleId: opts.bundleId ?? BUNDLE,
            ...(environment === "Production" ? { appAppleId: opts.appAppleId ?? APP_APPLE_ID } : {}),
            signedTransactionInfo: signJws({ ...opts.tx, environment }, opts.kind),
            ...(opts.renewal ? { signedRenewalInfo: signJws({ ...opts.renewal, environment }, opts.kind) } : {}),
        },
    }, opts.kind);
}
