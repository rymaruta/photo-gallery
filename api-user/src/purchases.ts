/**
 * Pro の購入（iOS の StoreKit 2）と、App Store Server Notifications V2 の受け口。
 * **Web では何も売らない**（ここはアプリと Apple からだけ呼ばれる）。
 *
 * ## POST /user/purchases（認証必要）
 *
 *     要求  { "signedTransaction": "<Transaction.jwsRepresentation>" }
 *     200   公開プロフィール（`toPublicProfile`。`pro`・`supporter: { number, since, months }`・`badges` を含む）
 *     400   形が違う・署名を確かめられない・売っていない商品・自動更新でない
 *     401   認証なし
 *     403   appAccountToken がこの人のものではない（別のアカウントで買われた・退会して作り直した
 *           アカウントに古いアカウントの購入が届いた）→ `code: "linked_to_other_account"`
 *     403   ファミリー共有で受け取った権利（`inAppOwnershipType: FAMILY_SHARED`）
 *           → `code: "family_shared_not_supported"`。**Pro は買った本人だけ**（2026-10-09 owner）
 *     409   この購入は別のアカウントに結び付いている（`code: "claimed_by_other_account"`。
 *           自分の token の付いた取引でも、今の結び付けを決めた取引より古ければ移さない）／
 *           書き込みが競合し続けた（code なし・やり直せば通る）
 *     410   退会済み
 *     503   サーバーに App Store の設定が無い
 *
 * iOS は購入のあと・起動時の `Transaction.updates`・「購入を復元」のたびに、
 * **いちばん新しい取引**（`Transaction.currentEntitlement(for:)` など）を送る。
 * 古い取引を送っても状態は巻き戻らない（期間だけ記録する。`supporter.ts`）。
 * appAccountToken は `appStore.ts` の `appAccountTokenFor(userId)`（UUIDv5）を付けて買う。
 * 付いていない取引（App Store のアプリでコードを使った等）は、まだ誰にも結び付いて
 * いなければ送ってきた人に結び付ける。
 *
 * ## POST /appstore/notifications（認証なし・Apple から）
 *
 *     要求  { "signedPayload": "<JWS>" }
 *     200   確かめられた（反映した・処理済み・扱わない知らせ＝結び付いていない取引・他の商品・
 *           取引の無い知らせ・退会済みの人・**ファミリー共有の取引**）
 *     400   署名を確かめられない・形が違う
 *     500   サーバーに App Store の設定が無い／**確かめたが書き込みに失敗した**（DynamoDB の
 *           例外・競合が続いた）。どちらも Apple が時間をおいて送り直す。送り直されても
 *           結果は同じ（期間は取引の番号で置き換え・状態は署名の時刻で順番を守る・
 *           notificationUUID を覚える）ので、取りこぼすより送り直させる方に倒す
 *
 * 取引 → 人 は `appstore#<originalTransactionId>` の行で引く（`POST /user/purchases` が作る）。
 * まだ結び付いていない取引の知らせは記録だけして捨てる（アプリが送ってきたときに拾う）。
 * 同じ知らせ（notificationUUID）は二度処理しない。
 *
 * ## 結び付けの決まり（2026-10-10・`supporterStore.ts` の `claimAppStoreLink`）
 *
 * - 取引の新しさは**鍵**だけで比べる（`supporter.ts` の `transactionOrderKey`＝min(purchaseDate, signedDate, 今)）
 * - **持ち主が移るのは POST だけ**（効いている取引・本人の token・鍵が行の鍵より大きい）
 * - 知らせは持ち主を移さず、別のアカウントを Pro にもしない。持ち主ではない人の token の付いた知らせは:
 *   - 効いている、より新しい取引 → 今の持ち主の Pro を終える（`endOwnerForNewerTransaction`）。
 *     新しい側が Pro になるのは、そのアプリが POST したとき
 *   - 前の持ち主（`previousOwnerId`）の取引の返金・取り消し → 前の持ち主の期間を切る
 *   - それ以外 → 捨てる（持ち主の行に書かない）
 * - **付け替えより前の token の無い取引**（行の `transferKey` より古い・`staleTokenlessOwner`）は
 *   前の持ち主のもの。今の持ち主に重ねない（知らせも POST も）:
 *   - 返金・取り消し → 前の持ち主の期間を切る
 *   - それ以外 → 捨てる（POST は書かずに 200＝今のプロフィールを返す。アプリは取引を終える）
 * - 持ち主（か token の無い）の、効いている、より新しい取引の知らせは、行の鍵を進める
 */
import type { APIGatewayProxyHandlerV2, APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import {
    AppStoreSignatureError, appAccountTokenFor, proProductIds, readAppStoreConfig, renewalFacts,
    transactionFacts, verifyNotificationPayload, verifySignedTransaction,
} from "./appStore";
import {
    advanceAppStoreLinkKey, applyToProfile, claimAppStoreLink, endOwnerForNewerTransaction, forgetAppStoreLinks,
    readAppStoreLink, readProfileRow, rememberNotification, staleTokenlessOwner,
} from "./supporterStore";
import { isSupersededTransaction, transactionOrderKey } from "./supporter";
import type { SupporterEvent } from "./supporter";
import { toPublicProfile } from "./userProfile";
import type { UserProfile } from "./userProfile";

/** JWS の長さの上限（実物は数KB。証明書3枚ぶん） */
const MAX_JWS_LENGTH = 32_000;
const AUTO_RENEWABLE = "Auto-Renewable Subscription";

const profileResponse = (row: Record<string, unknown>) => ({
    statusCode: 200,
    headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
    body: JSON.stringify(toPublicProfile(row as unknown as UserProfile)),
});

/**
 * ファミリー共有で受け取った取引か。**Pro・サポーター番号・メダルは買った本人だけ**
 * （2026-10-09 owner の決め）。家族の取引は誰にも結び付けず、何も書かない。
 * App Store Connect でファミリー共有を切っていても、ここで止める（設定の戻し忘れ・審査の
 * 都合で入れたときにも、家族に配られない）
 */
const isFamilyShared = (t: { inAppOwnershipType?: unknown }) => t.inAppOwnershipType === "FAMILY_SHARED";

function readBody(event: { body?: string; isBase64Encoded?: boolean }): Record<string, unknown> | null {
    try {
        const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : (event.body ?? "");
        const v = JSON.parse(raw || "{}");
        return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
    } catch {
        return null;
    }
}

const isJws = (v: unknown): v is string =>
    typeof v === "string" && v.length > 0 && v.length <= MAX_JWS_LENGTH && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(v);

export const recordPurchase: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");
    const cfg = readAppStoreConfig();
    if (!cfg) {
        console.error("recordPurchase: App Store の設定がありません（APPSTORE_BUNDLE_ID / APPSTORE_ENVIRONMENTS）");
        return jsonError(503, "いまは購入を受け付けられません");
    }
    const body = readBody(event);
    if (!body || !isJws(body.signedTransaction)) return jsonError(400, "購入の情報がありません");

    let verified;
    try {
        verified = await verifySignedTransaction(body.signedTransaction, cfg);
    } catch (e) {
        if (e instanceof AppStoreSignatureError) {
            console.warn(`recordPurchase: ${e.message}（${userId}）`);
            return jsonError(400, "購入の情報を確かめられませんでした");
        }
        throw e;
    }
    const { transaction, environment } = verified;
    if (!proProductIds(cfg.bundleId).includes(transaction.productId ?? "")) {
        return jsonError(400, "この商品は扱っていません");
    }
    if (transaction.type !== AUTO_RENEWABLE) return jsonError(400, "この商品は扱っていません");
    if (isFamilyShared(transaction)) {
        console.warn(`recordPurchase: ファミリー共有の取引は受け付けません（${userId}）`);
        return jsonError(403, "ファミリー共有のサブスクリプションでは Pro になりません。ご自身で購入してください", "family_shared_not_supported");
    }
    const token = typeof transaction.appAccountToken === "string" ? transaction.appAccountToken.toLowerCase() : "";
    if (token && token !== appAccountTokenFor(userId)) {
        return jsonError(403, "別のアカウントで購入されたサブスクリプションです", "linked_to_other_account");
    }
    const facts = transactionFacts(transaction, environment);
    if (typeof facts === "string") return jsonError(400, "購入の情報が足りません");

    try {
        const claimed = await claimAppStoreLink(facts.originalTransactionId, userId, environment, {
            tokenIsMine: token !== "",
            purchaseDate: facts.purchaseDate,
            signedDate: facts.signedDate,
            superseded: isSupersededTransaction(facts),
        });
        if (claimed === "other") {
            return jsonError(409, "このサブスクリプションは別のアカウントで使われています", "claimed_by_other_account");
        }
        // 結び付けの書き込みが競合し続けた。code を付けない（アプリは取引を終えず、やり直す）
        if (claimed === "conflict") return jsonError(409, "他の変更と重なりました。もう一度お試しください");
        if (typeof claimed === "object") {
            // 付け替えより前の token の無い取引（前の持ち主のもの）。この人には書かない。
            // 返金・取り消しなら前の持ち主の期間を切る（知らせの前の持ち主の返金と同じ）
            if (facts.revocationDate !== undefined) {
                const prev = await applyToProfile(claimed.previousOwnerId, { kind: "PURCHASE", tx: facts, signedAt: facts.signedDate }, { createIfMissing: false });
                if (prev.status === "conflict") return jsonError(409, "他の変更と重なりました。もう一度お試しください");
                console.log(`recordPurchase: 付け替えより前の取引の取り消しを前の持ち主に反映しました（${prev.status}）（${userId}）`);
            } else {
                console.log(`recordPurchase: 付け替えより前の token の無い取引なので書きません（${userId}）`);
            }
            const row = await readProfileRow(userId);
            if (row === "deleted") return jsonError(410, "このアカウントは削除されています");
            return profileResponse(row ?? { userId });
        }
        const out = await applyToProfile(userId, { kind: "PURCHASE", tx: facts, signedAt: facts.signedDate }, { createIfMissing: true });
        if (out.status === "deleted") {
            // 退会済みの人（消す前に配ったトークンがまだ通る・退会と同時に来た購入）に結び付けを
            // 残さない。残すと持ち主が墓石の `appstore#…` が誰にも消されないまま残り、
            // token の無い取引はほかのアカウントから 409 で受け付けられなくなる（退会の掃除は
            // 墓石を置く前に読んだ `linked` しか消さない）
            await forgetAppStoreLinks(userId, { linked: [facts.originalTransactionId] });
            return jsonError(410, "このアカウントは削除されています");
        }
        if (out.status !== "saved") return jsonError(409, "他の変更と重なりました。もう一度お試しください");
        if (out.ignored) console.log(`recordPurchase: ${out.ignored}（${userId}）`);
        return profileResponse(out.row);
    } catch (e) {
        console.error("recordPurchase error:", e);
        return jsonError(500, "購入の記録に失敗しました");
    }
};

const ok = () => ({ statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) });

export const appStoreNotification: APIGatewayProxyHandlerV2 = async (event) => {
    const cfg = readAppStoreConfig();
    if (!cfg) {
        // 500 にして Apple に送り直させる（設定を直せば拾える）
        console.error("appStoreNotification: App Store の設定がありません");
        return jsonError(500, "not configured");
    }
    const body = readBody(event);
    if (!body || !isJws(body.signedPayload)) return jsonError(400, "bad request");

    let verified;
    try {
        verified = await verifyNotificationPayload(body.signedPayload, cfg);
    } catch (e) {
        if (e instanceof AppStoreSignatureError) {
            console.warn(`appStoreNotification: ${e.message}`);
            return jsonError(400, "bad signature");
        }
        console.error("appStoreNotification: 確かめる途中で落ちました:", e);
        return jsonError(400, "bad signature");
    }

    // ここから先は、書き込みの失敗（500・Apple が送り直す）以外は 200
    const { notification, environment, transaction, renewal } = verified;
    const type = notification.notificationType ?? "";
    const uuid = notification.notificationUUID ?? "";
    const label = `${type}${notification.subtype ? `/${notification.subtype}` : ""} ${uuid} (${environment})`;
    try {
        if (!transaction) {
            console.log(`appStoreNotification: 取引の無い知らせ ${label}`);
            return ok();
        }
        if (!proProductIds(cfg.bundleId).includes(transaction.productId ?? "")) {
            console.log(`appStoreNotification: 扱っていない商品 ${transaction.productId} ${label}`);
            return ok();
        }
        if (isFamilyShared(transaction)) {
            // 家族の取引は誰にも結び付けない。結び付いた行があっても書かない（送り直されても同じ）
            console.log(`appStoreNotification: ファミリー共有の取引は扱いません ${label}`);
            return ok();
        }
        const facts = transactionFacts(transaction, environment);
        if (typeof facts === "string") {
            console.warn(`appStoreNotification: ${facts} ${label}`);
            return ok();
        }
        const link = await readAppStoreLink(facts.originalTransactionId);
        if (!link) {
            console.log(`appStoreNotification: まだ誰にも結び付いていない取引 ${facts.originalTransactionId} ${label}`);
            return ok();
        }
        if (uuid && link.seen.includes(uuid)) {
            console.log(`appStoreNotification: 処理済み ${label}`);
            return ok();
        }
        const token = typeof transaction.appAccountToken === "string" ? transaction.appAccountToken.toLowerCase() : "";
        const key = transactionOrderKey(facts);
        const superseded = isSupersededTransaction(facts);
        const ev: SupporterEvent = {
            kind: type,
            ...(notification.subtype ? { subtype: notification.subtype } : {}),
            tx: facts,
            ...(renewalFacts(renewal) ? { renewal: renewalFacts(renewal) } : {}),
            signedAt: typeof notification.signedDate === "number" ? notification.signedDate : facts.signedDate,
        };
        const staleOwner = staleTokenlessOwner(link, token === "", key);
        if (staleOwner) {
            // 付け替えより前の token の無い取引（前の持ち主のもの）。今の持ち主には書かない
            if (facts.revocationDate !== undefined) {
                const prev = await applyToProfile(staleOwner, ev, { createIfMissing: false });
                if (prev.status === "conflict") {
                    console.error(`appStoreNotification: 競合が続いて前の持ち主に書けませんでした ${label}`);
                    return jsonError(500, "retry");
                }
                console.log(`appStoreNotification: 付け替えより前の token の無い取引の取り消しを前の持ち主に反映しました（${prev.status}）${label}`);
            } else {
                console.log(`appStoreNotification: 付け替えより前の token の無い取引なので捨てます ${label}`);
            }
            if (uuid) await rememberNotification(facts.originalTransactionId, uuid);
            return ok();
        }
        if (token && token !== appAccountTokenFor(link.ownerId)) {
            // 持ち主ではない人の取引。持ち主を移さない。持ち主の行に書くのは Pro を終えるときだけ
            if (facts.revocationDate !== undefined && link.previousOwnerId && token === appAccountTokenFor(link.previousOwnerId)) {
                // 前の持ち主の古い取引の返金・取り消し → 前の持ち主の期間を切る（付け替えのあとに届いた返金）
                const prev = await applyToProfile(link.previousOwnerId, ev, { createIfMissing: false });
                if (prev.status === "conflict") {
                    console.error(`appStoreNotification: 競合が続いて前の持ち主に書けませんでした ${label}`);
                    return jsonError(500, "retry");
                }
                console.log(`appStoreNotification: 前の持ち主の取引の取り消しを反映しました（${prev.status}）${label}`);
            } else if (!superseded) {
                // 別のアカウントの、効いている、より新しい取引 → 今の持ち主の Pro を終える。
                // 新しい側を Pro にするのは、その人のアプリが申し込んだとき（POST /user/purchases）
                const ended = await endOwnerForNewerTransaction(facts.originalTransactionId, key);
                if (ended === "conflict") {
                    console.error(`appStoreNotification: 競合が続いて今の持ち主の Pro を終えられませんでした ${label}`);
                    return jsonError(500, "retry");
                }
                console.warn(`appStoreNotification: appAccountToken が結び付けた人と違う（${ended}）${label}`);
            } else {
                console.warn(`appStoreNotification: appAccountToken が結び付けた人と違う取り消し・置き換え済みの取引なので捨てます ${label}`);
            }
            if (uuid) await rememberNotification(facts.originalTransactionId, uuid);
            return ok();
        }
        const out = await applyToProfile(link.ownerId, ev, { createIfMissing: false });
        if (out.status === "conflict") {
            console.error(`appStoreNotification: 競合が続いて書けませんでした ${label}`);
            return jsonError(500, "retry");
        }
        if (out.status !== "saved") {
            // 退会済み・行が無い → 書く先が無い。送り直されても同じなので 200
            console.warn(`appStoreNotification: 書きませんでした（${out.status}）${label}`);
            return ok();
        }
        if (out.ignored) console.log(`appStoreNotification: ${out.ignored} ${label}`);
        // 持ち主の、効いている、より新しい取引なら結び付けの鍵を進める（持ち主は変えない）
        if (!superseded && key !== undefined) await advanceAppStoreLinkKey(facts.originalTransactionId, link.ownerId, key);
        if (uuid) await rememberNotification(facts.originalTransactionId, uuid);
        console.log(`appStoreNotification: 反映しました ${label}`);
    } catch (e) {
        console.error(`appStoreNotification: 処理に失敗しました ${label}:`, e);
        return jsonError(500, "retry");
    }
    return ok();
};
