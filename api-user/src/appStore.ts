/**
 * App Store の署名（JWS）を**この場で**確かめる（Apple に問い合わせない）。
 *
 * 使うのは Apple の公式ライブラリ `@apple/app-store-server-library` の `SignedDataVerifier`。
 * 署名の鎖（x5c）が同梱の Apple のルート証明書（`appleRootCerts.ts`・G3）に届くこと、
 * 中間と末端の証明書に Apple の印（OID）があること、署名が合うこと、Bundle ID・
 * 環境（Production / Sandbox）・本番ならアプリの Apple ID が合うことを見る。
 *
 * - **オフライン**（`enableOnlineChecks = false`）: 失効の確認（OCSP）はしない。証明書の
 *   期限は署名の時刻（signedDate）で見る。Lambda から外へ出ない・遅くならない・Apple が
 *   落ちていても止まらない。代わりに「失効した Apple の証明書で署名されたもの」は見抜けない
 *   （Apple のライブラリが用意している形のうちの片方）
 *
 * ## 環境の設定（`serverless.yml` → `deploy-api.yml`）
 *
 *     APPSTORE_BUNDLE_ID      アプリの Bundle ID（APNs の topic と同じ値を配る）
 *     APPSTORE_ENVIRONMENTS   受け付ける環境（"Production,Sandbox" / "Sandbox"）
 *     APPSTORE_APP_APPLE_ID   アプリの Apple ID（数字）。**Production を受けるときは必須**
 *
 * - staging: `Sandbox` だけ
 * - 本番: `Production,Sandbox`。**Sandbox も受ける**のは、TestFlight と App Review の購入が
 *   Sandbox で、しかも**本番の API に届く**から（審査の人が Pro を買えないと落とされる）。
 *   Apple の勧め（本番で確かめて、だめなら Sandbox で確かめ直す）と同じ。
 *   Sandbox の購入は番号の列を分ける（`supporter.ts` の冒頭）
 * - Bundle ID が無い・環境が1つも無い → **受け付けない**（設定ミスは「動かない」に倒す）
 *
 * ## 商品
 *
 *     <bundleId>.pro.monthly   月ごと ¥500
 *     <bundleId>.pro.yearly    年ごと ¥5,000
 *
 * ## appAccountToken（iOS が購入のときに付ける UUID）
 *
 * **userId（Cognito の sub）を名前にした UUIDv5**。名前空間は下の `APP_ACCOUNT_TOKEN_NAMESPACE`。
 * iOS も同じ式で作る（RFC 4122 §4.3）:
 *
 *     data   = 名前空間の16バイト ++ userId の UTF-8
 *     h      = SHA-1(data) の先頭16バイト
 *     h[6]   = (h[6] & 0x0F) | 0x50     // 版 5
 *     h[8]   = (h[8] & 0x3F) | 0x80     // RFC 4122 の変種
 *     小文字の 8-4-4-4-12 で書く
 *
 * 例（`__tests__/appStore.test.ts` が見張る）:
 *     userId "7b1c2d3e-0000-4000-8000-000000000001" → "6d109146-376e-5175-8e4c-2439a6bc3c3b"
 */
import { v5 as uuidv5 } from "uuid";
import { SignedDataVerifier, VerificationException, VerificationStatus } from "@apple/app-store-server-library";
import type {
    JWSRenewalInfoDecodedPayload,
    JWSTransactionDecodedPayload,
    ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";
import { appleRootCertificates } from "./appleRootCerts";
import type { AppStoreEnvironment, RenewalFacts, TransactionFacts } from "./supporter";

/** appAccountToken の名前空間（UUIDv5）。**変えない**（変えると今までの購入が誰のものか分からなくなる） */
export const APP_ACCOUNT_TOKEN_NAMESPACE = "5bbfc476-7442-4f3d-8d7e-4f55931ae30f";

/** その人の appAccountToken（小文字） */
export function appAccountTokenFor(userId: string): string {
    return uuidv5(userId, APP_ACCOUNT_TOKEN_NAMESPACE).toLowerCase();
}

export type AppStoreConfig = {
    bundleId: string;
    environments: AppStoreEnvironment[];
    appAppleId?: number;
};

/**
 * 設定を読む。使えなければ null（受け付けない）。
 * Production が並んでいても Apple ID が無ければ外す（公式ライブラリが受け付けない形）
 */
export function readAppStoreConfig(env: NodeJS.ProcessEnv = process.env): AppStoreConfig | null {
    const bundleId = (env.APPSTORE_BUNDLE_ID ?? "").trim();
    if (!bundleId) return null;
    const idRaw = (env.APPSTORE_APP_APPLE_ID ?? "").trim();
    const appAppleId = /^\d{1,12}$/.test(idRaw) ? Number(idRaw) : undefined;
    const environments: AppStoreEnvironment[] = [];
    for (const part of (env.APPSTORE_ENVIRONMENTS ?? "").split(",").map((s) => s.trim())) {
        if (part === "Production") {
            if (appAppleId === undefined) {
                console.warn("appStore: APPSTORE_APP_APPLE_ID が無いので Production を受け付けません");
                continue;
            }
            if (!environments.includes("Production")) environments.push("Production");
        } else if (part === "Sandbox") {
            if (!environments.includes("Sandbox")) environments.push("Sandbox");
        }
    }
    if (environments.length === 0) return null;
    return { bundleId, environments, ...(appAppleId !== undefined ? { appAppleId } : {}) };
}

/** 売っている2つの商品 */
export function proProductIds(bundleId: string): string[] {
    return [`${bundleId}.pro.monthly`, `${bundleId}.pro.yearly`];
}

/** 署名を確かめられなかった（400 にする） */
export class AppStoreSignatureError extends Error {
    constructor(message: string, readonly status?: VerificationStatus) {
        super(message);
        this.name = "AppStoreSignatureError";
    }
}

const verifierCache = new Map<string, SignedDataVerifier>();

function verifierFor(cfg: AppStoreConfig, environment: AppStoreEnvironment): SignedDataVerifier {
    const key = `${cfg.bundleId}|${cfg.appAppleId ?? ""}|${environment}`;
    let v = verifierCache.get(key);
    if (!v) {
        v = new SignedDataVerifier(
            appleRootCertificates(),
            false,   // オフライン（上の注記）
            environment as never,
            cfg.bundleId,
            environment === "Production" ? cfg.appAppleId : undefined,
        );
        verifierCache.set(key, v);
    }
    return v;
}

/** テスト用: 作った確かめ役を捨てる（ルート証明書を差し替えたとき） */
export function resetAppStoreVerifiers(): void {
    verifierCache.clear();
}

/**
 * 受け付ける環境を順に試す。「環境が違う」だけなら次へ、それ以外の失敗はそこで止める
 * （署名が合わないものを別の環境で試しても通らないので、理由を濁さない）。
 *
 * **Production の「アプリ違い」（INVALID_APP_IDENTIFIER）も次へ回す。** 知らせの
 * `data.appAppleId` は **Sandbox では入らない**（Apple の仕様）ので、Production の確かめ役は
 * Sandbox の知らせを環境より先に「アプリの Apple ID が違う」で断る。ここで止めると、本番が
 * 受けると決めた Sandbox（TestFlight・審査）の知らせが全部 400 になっていた。
 * 回しても緩まない——Sandbox の確かめ役も Bundle ID と環境を見るので、本当に別のアプリ・
 * 別の Apple ID の Production の知らせはそこで断られる（理由は Production で出た方を返す）
 */
async function tryEnvironments<T>(
    cfg: AppStoreConfig,
    run: (v: SignedDataVerifier, env: AppStoreEnvironment) => Promise<T>,
): Promise<{ value: T; environment: AppStoreEnvironment }> {
    let lastStatus: VerificationStatus | undefined;
    let appIdStatus: VerificationStatus | undefined;
    for (const environment of cfg.environments) {
        try {
            return { value: await run(verifierFor(cfg, environment), environment), environment };
        } catch (e) {
            if (e instanceof VerificationException) {
                lastStatus = e.status;
                if (e.status === VerificationStatus.INVALID_ENVIRONMENT) continue;
                if (e.status === VerificationStatus.INVALID_APP_IDENTIFIER && environment === "Production") {
                    appIdStatus = e.status;
                    continue;
                }
                throw new AppStoreSignatureError(`署名を確かめられませんでした（${VerificationStatus[e.status]}）`, e.status);
            }
            throw new AppStoreSignatureError(`署名を確かめられませんでした（${(e as Error)?.message ?? e}）`);
        }
    }
    if (appIdStatus !== undefined) {
        throw new AppStoreSignatureError(`署名を確かめられませんでした（${VerificationStatus[appIdStatus]}）`, appIdStatus);
    }
    throw new AppStoreSignatureError(
        `受け付けていない環境の署名です（${lastStatus !== undefined ? VerificationStatus[lastStatus] : "なし"}）`, lastStatus);
}

/** アプリから送られた取引（StoreKit 2 の `jwsRepresentation`）を確かめる */
export async function verifySignedTransaction(jws: string, cfg: AppStoreConfig): Promise<{
    transaction: JWSTransactionDecodedPayload;
    environment: AppStoreEnvironment;
}> {
    const r = await tryEnvironments(cfg, (v) => v.verifyAndDecodeTransaction(jws));
    return { transaction: r.value, environment: r.environment };
}

/**
 * App Store Server Notifications V2 の `signedPayload` を確かめ、中の取引と更新の情報も
 * **同じ環境で**確かめて開く
 */
export async function verifyNotificationPayload(signedPayload: string, cfg: AppStoreConfig): Promise<{
    notification: ResponseBodyV2DecodedPayload;
    environment: AppStoreEnvironment;
    transaction?: JWSTransactionDecodedPayload;
    renewal?: JWSRenewalInfoDecodedPayload;
}> {
    const r = await tryEnvironments(cfg, (v) => v.verifyAndDecodeNotification(signedPayload));
    const notification = r.value;
    const v = verifierFor(cfg, r.environment);
    let transaction: JWSTransactionDecodedPayload | undefined;
    let renewal: JWSRenewalInfoDecodedPayload | undefined;
    try {
        if (notification.data?.signedTransactionInfo) {
            transaction = await v.verifyAndDecodeTransaction(notification.data.signedTransactionInfo);
        }
        if (notification.data?.signedRenewalInfo) {
            renewal = await v.verifyAndDecodeRenewalInfo(notification.data.signedRenewalInfo);
        }
    } catch (e) {
        const status = e instanceof VerificationException ? e.status : undefined;
        throw new AppStoreSignatureError(
            `知らせの中の署名を確かめられませんでした（${status !== undefined ? VerificationStatus[status] : (e as Error)?.message}）`, status);
    }
    return { notification, environment: r.environment, transaction, renewal };
}

/** 取引から、状態の計算に使う分を取り出す。足りなければ理由（文字）を返す */
export function transactionFacts(
    t: JWSTransactionDecodedPayload,
    environment: AppStoreEnvironment,
): TransactionFacts | string {
    if (!t.transactionId || !t.originalTransactionId) return "取引の番号がありません";
    if (!t.productId) return "商品がありません";
    if (typeof t.purchaseDate !== "number" || typeof t.expiresDate !== "number") return "期間がありません";
    return {
        transactionId: t.transactionId,
        originalTransactionId: t.originalTransactionId,
        productId: t.productId,
        purchaseDate: t.purchaseDate,
        ...(typeof t.originalPurchaseDate === "number" ? { originalPurchaseDate: t.originalPurchaseDate } : {}),
        expiresDate: t.expiresDate,
        ...(typeof t.revocationDate === "number" ? { revocationDate: t.revocationDate } : {}),
        ...(t.isUpgraded === true ? { isUpgraded: true as const } : {}),
        environment,
        signedDate: typeof t.signedDate === "number" ? t.signedDate : Date.now(),
    };
}

export function renewalFacts(r: JWSRenewalInfoDecodedPayload | undefined): RenewalFacts | undefined {
    if (!r) return undefined;
    return {
        ...(typeof r.autoRenewStatus === "number" ? { autoRenewStatus: r.autoRenewStatus } : {}),
        ...(typeof r.gracePeriodExpiresDate === "number" ? { gracePeriodExpiresDate: r.gracePeriodExpiresDate } : {}),
    };
}
