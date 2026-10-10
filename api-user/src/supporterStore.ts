/**
 * Pro の**保存**（プロフィールの行の `supporter`・番号の列・取引と人の結び付け）。
 * 状態の移り方は `supporter.ts`（純関数）、Pro のメダルは `proBadges.ts`。
 *
 * ## 表（新しい表・索引は作らない。`USERS_TABLE` に小さな行を足す）
 *
 *     userId = <sub>                       プロフィールの行。`supporter` と `badges` を置き直す
 *     userId = counter#supporter           本物（Production）の番号の列 { issued: 最後に振った番号 }
 *     userId = counter#supporter#sandbox   Sandbox の番号の列（TestFlight・審査・staging）
 *     userId = appstore#<originalTransactionId>
 *                                          { ownerId, environment, createdAt, seen: [notificationUUID…], rev,
 *                                            lastPurchaseDate?（結び付けを最後に決めた取引の鍵・ms。
 *                                              `supporter.ts` の `transactionOrderKey`＝min(purchaseDate, signedDate, 今)。
 *                                              名前は前のまま＝古い行もそのまま読める）,
 *                                            previousOwnerId?（付け替えたときだけ。前の持ち主の Pro はその場で終える） }
 *
 * `#` を含む行は人ではない（検索・台本・公開プロフィールは `#` を弾く）。
 *
 * ## 書き方
 *
 * この表に対する Lambda の権限は GetItem / PutItem / DeleteItem / Scan だけ（UpdateItem は無い）。
 * だから全部「読む → rev（番号の列は issued）を条件に置き直す」。競合したら読み直して重ね直す
 * （`badgeStore.ts`・`userProfile.ts` と同じ）。
 *
 * - **番号は二度と出さない**: 列を `issued = 読んだ値` を条件に +1 して置く。取った番号は
 *   その呼び出しの中で使い回す（プロフィールの書き込みが競合しても、新しい番号を取り直さない）。
 *   プロフィールの書き込みが最後まで落ちたら、その番号は欠番になる（再利用はしない）
 * - **書けてから知らせる**（メダルの通知）
 */
import { DeleteCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./dynamodb";
import { requireEnv } from "./env";
import { isDeletedProfile } from "./types";
import { pushNotification } from "./notify";
import { badgeDisplayNameJa } from "./badgeKeys";
import { mergeProBadges } from "./proBadges";
import { applySupporterEvent, endTransferredSupporter, readSupporter, supporterCounterKey, transactionOrderKey } from "./supporter";
import type { AppStoreEnvironment, SupporterEvent } from "./supporter";

const USERS_TABLE = requireEnv("USERS_TABLE");

/** 競合したときに読み直す回数 */
const WRITE_RETRIES = 4;
/** 番号の列の競合で読み直す回数（同時に買う人が重なったとき）。間に少し揺らした待ちを挟む */
const COUNTER_RETRIES = 30;
const COUNTER_BACKOFF_MS = 15;
/** 結び付けの行に覚えておく知らせの数（同じ知らせの二重処理を止める） */
export const SEEN_MAX = 50;

const isCondFail = (e: unknown) => (e as { name?: string })?.name === "ConditionalCheckFailedException";

export const appStoreLinkKey = (originalTransactionId: string) => `appstore#${originalTransactionId}`;

/** 番号を1つ取る（列を +1 して置く）。取れなければ投げる */
export async function allocateSupporterNumber(environment: AppStoreEnvironment): Promise<number> {
    const key = supporterCounterKey(environment);
    for (let attempt = 0; attempt <= COUNTER_RETRIES; attempt++) {
        const res = await ddb.send(new GetCommand({ TableName: USERS_TABLE, Key: { userId: key }, ConsistentRead: true }));
        const cur = typeof res.Item?.issued === "number" && Number.isInteger(res.Item.issued) ? res.Item.issued : 0;
        const next = cur + 1;
        try {
            await ddb.send(new PutCommand({
                TableName: USERS_TABLE,
                Item: { userId: key, issued: next, updatedAt: new Date().toISOString() },
                ConditionExpression: res.Item ? "#issued = :cur" : "attribute_not_exists(userId)",
                ...(res.Item
                    ? { ExpressionAttributeNames: { "#issued": "issued" }, ExpressionAttributeValues: { ":cur": cur } }
                    : {}),
            }));
            return next;
        } catch (e) {
            if (!isCondFail(e)) throw e;
            // 誰かが先に取った。少し待って読み直す（同時に来た人どうしで足並みをずらす）
            await new Promise((r) => setTimeout(r, Math.random() * COUNTER_BACKOFF_MS * Math.min(attempt + 1, 8)));
        }
    }
    throw new Error("サポーター番号の列が混み合って取れませんでした");
}

export type AppStoreLink = {
    ownerId: string;
    environment?: string;
    seen: string[];
    rev: number;
    /** 結び付けを最後に決めた（作った・移した・進めた）取引の鍵（`transactionOrderKey`・ms）。無いのは古い行 */
    lastPurchaseDate?: number;
    /** 付け替えたときの前の持ち主 */
    previousOwnerId?: string;
};

function parseLink(it: Record<string, unknown> | undefined): AppStoreLink | null {
    if (!it || typeof it.ownerId !== "string" || !it.ownerId) return null;
    return {
        ownerId: it.ownerId,
        ...(typeof it.environment === "string" ? { environment: it.environment } : {}),
        seen: Array.isArray(it.seen) ? it.seen.filter((x: unknown): x is string => typeof x === "string") : [],
        rev: typeof it.rev === "number" ? it.rev : 0,
        ...(typeof it.lastPurchaseDate === "number" && Number.isFinite(it.lastPurchaseDate) ? { lastPurchaseDate: it.lastPurchaseDate } : {}),
        ...(typeof it.previousOwnerId === "string" && it.previousOwnerId ? { previousOwnerId: it.previousOwnerId } : {}),
    };
}

/** 結び付けの行を、置き直すための生の行といっしょに読む */
async function readLinkRow(originalTransactionId: string): Promise<{ link: AppStoreLink; row: Record<string, unknown> } | null> {
    const res = await ddb.send(new GetCommand({
        TableName: USERS_TABLE, Key: { userId: appStoreLinkKey(originalTransactionId) }, ConsistentRead: true,
    }));
    const row = res.Item as Record<string, unknown> | undefined;
    const link = parseLink(row);
    return link && row ? { link, row } : null;
}

export async function readAppStoreLink(originalTransactionId: string): Promise<AppStoreLink | null> {
    return (await readLinkRow(originalTransactionId))?.link ?? null;
}

/**
 * 鍵（`lastPurchaseDate`）を持たない古い結び付けの行のときの代わり:
 * 今の持ち主の今の購読がこの取引なら、**記録した期間のいちばん新しい始まり**と
 * **状態を決めた時刻（`lastEventAt`）**の小さい方（ms）。分からなければ undefined。
 *
 * - まだ始まっていない期間（前倒しの更新で記録した未来の期間）は使わない
 * - 始まったあとでも、前倒しの更新の期間の始まり（purchaseDate）はその取引の鍵より後になる。
 *   `lastEventAt`（その更新の署名時刻）と小さい方を取ると、鍵の決め方（min(purchaseDate, signedDate)）に
 *   そろう（期限のあとに届いた別のアカウントの申し込み直しを 409 にしない）
 * - 期間（`periods`）は originalTransactionId を持たないので、今の購読がこの取引のときだけ使う
 */
async function legacyLatestPurchase(ownerId: string, originalTransactionId: string): Promise<number | undefined> {
    const res = await ddb.send(new GetCommand({ TableName: USERS_TABLE, Key: { userId: ownerId }, ConsistentRead: true }));
    const row = res.Item as Record<string, unknown> | undefined;
    if (!row || isDeletedProfile(row)) return undefined;
    const s = readSupporter(row.supporter);
    if (!s || s.originalTransactionId !== originalTransactionId) return undefined;
    const now = Date.now();
    const latestStart = s.periods.reduce((m, p) => {
        const start = Date.parse(p.start);
        return start <= now ? Math.max(m, start) : m;
    }, -Infinity);
    const lastEventAt = s.lastEventAt !== undefined ? Date.parse(s.lastEventAt) : NaN;
    const known = [latestStart, Number.isFinite(lastEventAt) ? Math.min(lastEventAt, now) : NaN].filter(Number.isFinite);
    return known.length > 0 ? Math.min(...known) : undefined;
}

/** 比べる相手の鍵: 行の鍵。無い古い行は `legacyLatestPurchase`。どちらも分からなければ undefined */
async function referenceKey(link: AppStoreLink, originalTransactionId: string): Promise<number | undefined> {
    return link.lastPurchaseDate ?? await legacyLatestPurchase(link.ownerId, originalTransactionId);
}

/** 結び付けの行の rev を条件にする（rev の無い古い行は「rev が無いまま」を条件に） */
const linkRevCondition = (rev: number) => (rev === 0
    ? { ConditionExpression: "attribute_exists(userId) AND attribute_not_exists(rev)" }
    : { ConditionExpression: "rev = :rev", ExpressionAttributeValues: { ":rev": rev } });

/**
 * 今の持ち主の、効いている（取り消し・置き換え済みでない）**より新しい取引**で、行の鍵を進める。
 * 持ち主は変えない。持ち主が変わっていた・鍵が新しくない・競合が続いたら何もしない（投げるのは DynamoDB の例外だけ）
 */
export async function advanceAppStoreLinkKey(originalTransactionId: string, ownerId: string, key: number): Promise<void> {
    for (let attempt = 0; attempt <= WRITE_RETRIES; attempt++) {
        const cur = await readLinkRow(originalTransactionId);
        if (!cur || cur.link.ownerId !== ownerId) return;
        const ref = await referenceKey(cur.link, originalTransactionId);
        if (ref !== undefined && !(key > ref)) return;
        try {
            await ddb.send(new PutCommand({
                TableName: USERS_TABLE,
                Item: { ...cur.row, lastPurchaseDate: key, rev: cur.link.rev + 1 },
                ...linkRevCondition(cur.link.rev),
            }));
            return;
        } catch (e) {
            if (isCondFail(e)) continue;   // 読み直して決め直す
            throw e;
        }
    }
    console.warn(`advanceAppStoreLinkKey: 競合が続いたので ${originalTransactionId} の鍵を進められませんでした`);
}

/**
 * 取引をこの人に結び付ける（`POST /user/purchases` から）。
 *
 * ## 決まり（2026-10-10。時刻の比べ方を1つにそろえた）
 *
 * 1. **新しさは取引の鍵だけで比べる**（`supporter.ts` の `transactionOrderKey`。
 *    min(purchaseDate, signedDate, 今)）。ほかの時刻で比べない
 * 2. 行の `lastPurchaseDate` は**結び付けを最後に決めた取引の鍵**。効いている取引で、より大きい鍵の
 *    ときだけ進む（戻らない）。取り消し・置き換え済みの取引（`superseded`）では進めない
 * 3. **持ち主が移るのは、次の全部を満たす申し込み（POST）だけ**:
 *    取り消し・置き換え済みでない／送ってきた人の appAccountToken が付いている（`tokenIsMine`）／
 *    鍵が行の鍵より大きい。移したら前の持ち主の Pro をその場で終える（`endPreviousOwnerAccess`）
 * 4. 同じ持ち主の送り直しは鍵を戻さない。置き換え済みの取引は鍵を進めない
 * 5. 鍵の無い古い行は `legacyLatestPurchase` と比べる。それも分からなければ今までどおり移す
 * 6. **付け替えの書き込みで負けたら読み直して決め直す**（相手の鍵の方が新しければ "other"、
 *    この人の方が新しければ移す）。競合が続いて決めきれなければ "conflict"（code の無い 409・やり直せば通る）
 *
 * 知らせ（App Store Server Notifications）では持ち主を移さない（`endOwnerForNewerTransaction`）。
 *
 * 同じ Apple ID で別のアカウントが申し込み直すと、自動更新のサブスクリプションは
 * **同じ originalTransactionId のまま**続く（Apple の仕様）。token の無い取引では移さない
 * （誰が買ったか分からないものを横取りさせない）。
 *
 * 書き込みは行の rev を条件にする（間に入った `rememberNotification`・別の付け替えを消さない）。
 */
export async function claimAppStoreLink(
    originalTransactionId: string, userId: string, environment: AppStoreEnvironment,
    opts: { tokenIsMine?: boolean; purchaseDate?: number; signedDate?: number; superseded?: boolean } = {},
): Promise<"ok" | "other" | "conflict"> {
    const key = transactionOrderKey(opts);
    /** 行に覚える鍵。取り消し・置き換え済みの取引では覚えない */
    const claimKey = opts.superseded ? undefined : key;
    for (let attempt = 0; attempt <= WRITE_RETRIES; attempt++) {
        const cur = await readLinkRow(originalTransactionId);
        if (!cur) {
            try {
                await ddb.send(new PutCommand({
                    TableName: USERS_TABLE,
                    Item: {
                        userId: appStoreLinkKey(originalTransactionId),
                        ownerId: userId,
                        environment,
                        createdAt: new Date().toISOString(),
                        seen: [],
                        rev: 1,
                        ...(claimKey !== undefined ? { lastPurchaseDate: claimKey } : {}),
                    },
                    ConditionExpression: "attribute_not_exists(userId)",
                }));
                return "ok";
            } catch (e) {
                if (!isCondFail(e)) throw e;
                continue;   // 同時に誰かが結び付けた。読み直して決め直す
            }
        }
        const existing = cur.link;

        if (existing.ownerId === userId) {
            // 同じ人: より新しい効いている取引なら鍵を進める（落ちても結び付けはこの人のまま）
            if (claimKey !== undefined) {
                try {
                    await advanceAppStoreLinkKey(originalTransactionId, userId, claimKey);
                } catch (e) {
                    console.error(`claimAppStoreLink: ${originalTransactionId} の鍵を進められませんでした:`, e);
                }
            }
            return "ok";
        }

        if (!opts.tokenIsMine) return "other";
        if (opts.superseded) {
            console.warn(`claimAppStoreLink: ${originalTransactionId} の ${userId} の取引は取り消し・置き換え済みなので移しません`);
            return "other";
        }
        const reference = await referenceKey(existing, originalTransactionId);
        if (reference !== undefined && !(key !== undefined && key > reference)) {
            console.warn(`claimAppStoreLink: ${originalTransactionId} は ${existing.ownerId} がより新しい取引で持っているので ${userId} には移しません`);
            return "other";
        }
        try {
            await ddb.send(new PutCommand({
                TableName: USERS_TABLE,
                Item: {
                    userId: appStoreLinkKey(originalTransactionId),
                    ownerId: userId,
                    environment,
                    createdAt: new Date().toISOString(),
                    previousOwnerId: existing.ownerId,
                    seen: existing.seen,
                    rev: existing.rev + 1,
                    ...(key !== undefined ? { lastPurchaseDate: key } : {}),
                },
                // 読んだときの行のままなら移す（同時に別の付け替え・知らせの記録が来たら読み直す）
                ...linkRevCondition(existing.rev),
            }));
        } catch (e) {
            if (!isCondFail(e)) throw e;
            continue;   // 読み直して、新しい持ち主・鍵と比べて決め直す
        }
        console.log(`claimAppStoreLink: ${originalTransactionId} を ${existing.ownerId} から ${userId} へ付け替えました`);
        try {
            await endPreviousOwnerAccess(existing.ownerId, originalTransactionId);
        } catch (e) {
            // 付け替えそのものは済んでいる（新しい持ち主の購入は落とさない）。記録だけ残す
            console.error(`claimAppStoreLink: 前の持ち主 ${existing.ownerId} の Pro を終えられませんでした:`, e);
        }
        return "ok";
    }
    // 競合が続いた。この人のものになっていれば "ok"、決めきれなければ "conflict"
    // （"other" にすると 409 claimed_by_other_account になり、アプリが最終の答えとして取引を終えてしまう）
    const again = await readAppStoreLink(originalTransactionId);
    return again?.ownerId === userId ? "ok" : "conflict";
}

/**
 * 知らせ（App Store Server Notifications）で、**別のアカウントの token の付いた、効いている、
 * より新しい取引**が来たとき: 今の持ち主の Pro を終える（持ち主は移さない・鍵も進めない）。
 *
 * 同じ Apple ID で別のアカウントがアップグレードした知らせが先に届き、そのアカウントのアプリからの
 * 申し込み（POST）が遅れる・来ないと、前の持ち主の Pro が元の期限まで残っていた。
 * 新しい側を Pro にするのは、その人が申し込んだとき（`claimAppStoreLink`）。鍵を進めないのは、
 * 進めるとその申し込みが「新しくない」で 409 になるから。
 *
 * 比べる相手が分からない古い行（`legacyLatestPurchase` も undefined）では今までどおり何もしない。
 *
 * **鍵の無い古い行は、終える前に比べた相手を行に書いておく**。終えると持ち主の `lastEventAt` が今になり
 * （Sandbox は終わっていない期間も落ちる）、あとから `legacyLatestPurchase` で比べ直すと
 * 新しい側の申し込みが「古い」と見なされて 409 になる
 */
export async function endOwnerForNewerTransaction(
    originalTransactionId: string, key: number | undefined,
): Promise<"ended" | "skipped" | "older" | "conflict"> {
    for (let attempt = 0; attempt <= WRITE_RETRIES; attempt++) {
        const cur = await readLinkRow(originalTransactionId);
        if (!cur || key === undefined) return "skipped";
        const reference = await referenceKey(cur.link, originalTransactionId);
        if (reference === undefined) return "skipped";
        if (!(key > reference)) return "older";
        if (cur.link.lastPurchaseDate === undefined) {
            try {
                await ddb.send(new PutCommand({
                    TableName: USERS_TABLE,
                    Item: { ...cur.row, lastPurchaseDate: reference, rev: cur.link.rev + 1 },
                    ...linkRevCondition(cur.link.rev),
                }));
            } catch (e) {
                if (isCondFail(e)) continue;
                throw e;
            }
        }
        return endPreviousOwnerAccess(cur.link.ownerId, originalTransactionId);
    }
    return "conflict";
}

/**
 * 付け替えた取引の**前の持ち主の Pro を終える**（`supporter.ts` の `endTransferredSupporter`）。
 * 前の持ち主の今の購読がその取引のときだけ。行が無い・墓石・別の取引なら何もしない。
 * rev を条件に置き直す（競合したら読み直す）。メダル（`badges`）は触らない
 */
export async function endPreviousOwnerAccess(
    previousOwnerId: string, originalTransactionId: string, now: () => number = () => Date.now(),
): Promise<"ended" | "skipped" | "conflict"> {
    for (let attempt = 0; attempt <= WRITE_RETRIES; attempt++) {
        const res = await ddb.send(new GetCommand({ TableName: USERS_TABLE, Key: { userId: previousOwnerId }, ConsistentRead: true }));
        const row = res.Item as Record<string, unknown> | undefined;
        if (!row || isDeletedProfile(row)) return "skipped";
        const supporter = endTransferredSupporter(row.supporter, originalTransactionId, now());
        if (!supporter) return "skipped";
        const rev = typeof row.rev === "number" ? row.rev : 0;
        try {
            await ddb.send(new PutCommand({
                TableName: USERS_TABLE,
                Item: { ...row, supporter, rev: rev + 1 },
                ConditionExpression: rev === 0
                    ? "attribute_exists(userId) AND attribute_not_exists(deletedAt) AND (attribute_not_exists(rev) OR rev = :rev)"
                    : "attribute_exists(userId) AND attribute_not_exists(deletedAt) AND rev = :rev",
                ExpressionAttributeValues: { ":rev": rev },
            }));
            console.log(`endPreviousOwnerAccess: ${previousOwnerId} の Pro を終えました（${originalTransactionId} を付け替えた）`);
            return "ended";
        } catch (e) {
            if (isCondFail(e)) continue;   // 読み直して重ね直す
            throw e;
        }
    }
    console.error(`endPreviousOwnerAccess: 競合が続いて ${previousOwnerId} の Pro を終えられませんでした（${originalTransactionId}）`);
    return "conflict";
}

/** 処理した知らせを覚える（落ちても本流は止めない・次に同じ知らせが来ても結果は同じ） */
export async function rememberNotification(originalTransactionId: string, notificationUUID: string): Promise<void> {
    for (let attempt = 0; attempt <= WRITE_RETRIES; attempt++) {
        const res = await ddb.send(new GetCommand({
            TableName: USERS_TABLE, Key: { userId: appStoreLinkKey(originalTransactionId) }, ConsistentRead: true,
        }));
        const row = res.Item as Record<string, unknown> | undefined;
        if (!row) return;
        const seen = Array.isArray(row.seen) ? row.seen.filter((x): x is string => typeof x === "string") : [];
        if (seen.includes(notificationUUID)) return;
        const rev = typeof row.rev === "number" ? row.rev : 0;
        try {
            await ddb.send(new PutCommand({
                TableName: USERS_TABLE,
                Item: { ...row, seen: [...seen, notificationUUID].slice(-SEEN_MAX), rev: rev + 1 },
                ConditionExpression: rev === 0 ? "attribute_exists(userId) AND attribute_not_exists(rev)" : "rev = :rev",
                ...(rev === 0 ? {} : { ExpressionAttributeValues: { ":rev": rev } }),
            }));
            return;
        } catch (e) {
            if (isCondFail(e)) continue;
            throw e;
        }
    }
    console.warn(`rememberNotification: 競合が続いたので覚えられませんでした（${originalTransactionId}）`);
}

export type ApplyOutcome =
    | { status: "saved"; row: Record<string, unknown>; ignored?: string }
    | { status: "deleted" }
    | { status: "missing" }
    | { status: "conflict" };

/**
 * 取引・知らせを、その人のプロフィールの行に重ねて置き直す（Pro のメダルも重ねる）。
 *
 * @param createIfMissing 行が無ければ作る（アプリからの購入。知らせでは作らない）
 */
export async function applyToProfile(
    userId: string,
    ev: SupporterEvent,
    opts: { createIfMissing: boolean; now?: () => number },
): Promise<ApplyOutcome> {
    const now = opts.now ?? (() => Date.now());
    /** この呼び出しで取った番号（競合して読み直しても取り直さない） */
    let reserved: number | undefined;
    for (let attempt = 0; attempt <= WRITE_RETRIES; attempt++) {
        const res = await ddb.send(new GetCommand({ TableName: USERS_TABLE, Key: { userId }, ConsistentRead: true }));
        const row = res.Item as Record<string, unknown> | undefined;
        if (isDeletedProfile(row)) return { status: "deleted" };
        if (!row && !opts.createIfMissing) return { status: "missing" };

        const t = now();
        const applied = applySupporterEvent(row?.supporter, ev, t);
        const supporter = applied.supporter;
        if (applied.needsNumber) {
            reserved ??= await allocateSupporterNumber(supporter.environment ?? ev.tx.environment);
            supporter.number = reserved;
        }
        const { badges, upgraded } = mergeProBadges(row?.badges, supporter, t);
        const rev = typeof row?.rev === "number" ? row.rev : 0;
        const item: Record<string, unknown> = row
            ? { ...row, userId, supporter, badges, rev: rev + 1 }
            : { userId, createdAt: new Date(t).toISOString(), supporter, badges, rev: 1 };
        if (Object.keys(badges).length === 0) delete item.badges;
        try {
            await ddb.send(new PutCommand({
                TableName: USERS_TABLE,
                Item: item,
                ConditionExpression: !row
                    ? "attribute_not_exists(userId)"
                    : rev === 0
                        ? "attribute_exists(userId) AND attribute_not_exists(deletedAt) AND (attribute_not_exists(rev) OR rev = :rev)"
                        : "attribute_exists(userId) AND attribute_not_exists(deletedAt) AND rev = :rev",
                ...(row ? { ExpressionAttributeValues: { ":rev": rev } } : {}),
            }));
        } catch (e) {
            if (isCondFail(e)) continue;   // 読み直して重ね直す
            throw e;
        }
        if (reserved !== undefined && supporter.number !== reserved) {
            // 読み直したら番号を持っていた（別の呼び出しが先に振った）。取った番号は欠番
            console.warn(`applyToProfile: サポーター番号 ${reserved} は使わずに欠番になりました（${userId}）`);
        }
        // 書けてから知らせる。落ちても本流は止めない（pushNotification が握る）
        for (const up of upgraded) {
            await pushNotification(userId, {
                type: "badge",
                key: up.key,
                tier: up.tier,
                photoId: "",
                photoSrc: "",
                byName: badgeDisplayNameJa(up.key, up.tier),
                t: new Date(t).toISOString(),
            });
        }
        return { status: "saved", row: item, ...(applied.ignored ? { ignored: applied.ignored } : {}) };
    }
    if (reserved !== undefined) {
        console.warn(`applyToProfile: 競合が続いたのでサポーター番号 ${reserved} は欠番になりました（${userId}）`);
    }
    return { status: "conflict" };
}

/**
 * 退会のとき: その人に結び付けた取引の行（`appstore#…`）を消す。**投げない**（退会は止めない）。
 * 消せなかった行は「持ち主が墓石」なので、知らせが来ても何も書かれない
 */
export async function forgetAppStoreLinks(userId: string, rawSupporter: unknown): Promise<void> {
    const s = readSupporter(rawSupporter);
    if (!s) return;
    const ids = new Set([...s.linked, ...(s.originalTransactionId ? [s.originalTransactionId] : [])]);
    for (const id of ids) {
        try {
            await ddb.send(new DeleteCommand({
                TableName: USERS_TABLE,
                Key: { userId: appStoreLinkKey(id) },
                // 自分に結び付いている行だけ消す
                ConditionExpression: "ownerId = :me",
                ExpressionAttributeValues: { ":me": userId },
            }));
        } catch (e) {
            if (!isCondFail(e)) console.error(`forgetAppStoreLinks: ${id} を消せませんでした:`, e);
        }
    }
}
