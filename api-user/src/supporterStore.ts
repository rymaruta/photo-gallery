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
 *                                            lastPurchaseDate?（結び付けを決めた・進めた取引の purchaseDate・ms）,
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
import { applySupporterEvent, endTransferredSupporter, readSupporter, supporterCounterKey } from "./supporter";
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

export type AppStoreLink = { ownerId: string; environment?: string; seen: string[]; rev: number; lastPurchaseDate?: number };

export async function readAppStoreLink(originalTransactionId: string): Promise<AppStoreLink | null> {
    const res = await ddb.send(new GetCommand({
        TableName: USERS_TABLE, Key: { userId: appStoreLinkKey(originalTransactionId) }, ConsistentRead: true,
    }));
    const it = res.Item;
    if (!it || typeof it.ownerId !== "string" || !it.ownerId) return null;
    return {
        ownerId: it.ownerId,
        ...(typeof it.environment === "string" ? { environment: it.environment } : {}),
        seen: Array.isArray(it.seen) ? it.seen.filter((x: unknown): x is string => typeof x === "string") : [],
        rev: typeof it.rev === "number" ? it.rev : 0,
        ...(typeof it.lastPurchaseDate === "number" && Number.isFinite(it.lastPurchaseDate) ? { lastPurchaseDate: it.lastPurchaseDate } : {}),
    };
}

/**
 * `lastPurchaseDate` を持たない古い結び付けの行のときの代わり: 今の持ち主の今の購読が
 * この取引なら、記録した期間のいちばん新しい始まり（ms）。分からなければ undefined。
 * 期間（`periods`）は originalTransactionId を持たないので、今の購読がこの取引のときだけ使う
 */
async function legacyLatestPurchase(ownerId: string, originalTransactionId: string): Promise<number | undefined> {
    const res = await ddb.send(new GetCommand({ TableName: USERS_TABLE, Key: { userId: ownerId }, ConsistentRead: true }));
    const row = res.Item as Record<string, unknown> | undefined;
    if (!row || isDeletedProfile(row)) return undefined;
    const s = readSupporter(row.supporter);
    if (!s || s.originalTransactionId !== originalTransactionId) return undefined;
    // 前倒しの更新で記録した、まだ始まっていない期間は比べる相手にしない（`claimAppStoreLink` の注記）
    const now = Date.now();
    const latest = s.periods.reduce((m, p) => {
        const start = Date.parse(p.start);
        return start <= now ? Math.max(m, start) : m;
    }, -Infinity);
    return Number.isFinite(latest) ? latest : undefined;
}

/** 結び付けの行の rev を条件にする（rev の無い古い行は「rev が無いまま」を条件に） */
const linkRevCondition = (rev: number) => (rev === 0
    ? { ConditionExpression: "attribute_exists(userId) AND attribute_not_exists(rev)" }
    : { ConditionExpression: "rev = :rev", ExpressionAttributeValues: { ":rev": rev } });

/**
 * 取引をこの人に結び付ける。既に別の人に結び付いていたら "other"。
 * 同じ人なら "ok"（より新しい取引なら `lastPurchaseDate` を進める）。
 *
 * **付け替え（`tokenIsMine`）**: 同じ Apple ID で別のアカウントが申し込み直すと、
 * 自動更新のサブスクリプションは**同じ originalTransactionId のまま**続く（Apple の仕様）。
 * その新しい取引に**この人の appAccountToken** が付いていれば、本人が今このアカウントで
 * 買った証拠なので結び付けを移す（前の人の番号・月数・メダルはそのまま）。
 * token の無い取引では移さない（誰が買ったか分からないものを横取りさせない）。
 *
 * **移すのは、今の結び付けを決めた取引より新しい取引（`purchaseDate` が後）のときだけ**。
 * 端末に残っていた前のアカウントの古い取引（token は前のアカウントのもの）が後から届いても、
 * 結び付けを取り返して今の持ち主の Pro を終えないように "other" を返す（2026-10-10）。
 * 比べる相手は行の `lastPurchaseDate`。無い古い行は今の持ち主の期間の始まり
 * （`legacyLatestPurchase`）。どちらも分からなければ今までどおり移す。
 *
 * **未来の purchaseDate は今の時刻に抑えて覚える**。Apple は自動更新を期限の最大 24 時間前に
 * 請求し、更新の取引の purchaseDate は新しい期間の始まり（未来）になる。そのまま覚えると、
 * 期限の前に同じ Apple ID で別のアカウントが申し込み直した（アップグレードした）取引が「古い」
 * と見なされ、払ったのに Pro にならなかった。古い行の代わり（`legacyLatestPurchase`）も、
 * まだ始まっていない期間は使わない。
 * 抑えたぶん、前の持ち主の未来の更新の取引が後から届くと「新しい」と見なされうるので、
 * **取り消された（`revocationDate`）・置き換わった（`isUpgraded`）取引（`superseded`）では移さない**。
 *
 * **移したら前の人の Pro をその場で終える**（`endPreviousOwnerAccess`）。前の人の token の付いた
 * 知らせは以後捨てられる（`purchases.ts`）ので、放っておくと元の期限まで Pro が残っていた
 *
 * 書き込みは行の rev を条件にする（間に入った `rememberNotification`・別の付け替えを消さない）。
 * 競合したら読み直して決め直す
 */
export async function claimAppStoreLink(
    originalTransactionId: string, userId: string, environment: AppStoreEnvironment,
    opts: { tokenIsMine?: boolean; purchaseDate?: number; superseded?: boolean } = {},
): Promise<"ok" | "other"> {
    const incoming = typeof opts.purchaseDate === "number" && Number.isFinite(opts.purchaseDate) ? opts.purchaseDate : undefined;
    /** 行に覚える時刻（未来の purchaseDate は今に抑える） */
    const stamp = incoming !== undefined ? Math.min(incoming, Date.now()) : undefined;
    for (let attempt = 0; attempt <= WRITE_RETRIES; attempt++) {
        const existing = await readAppStoreLink(originalTransactionId);
        if (!existing) {
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
                        ...(stamp !== undefined ? { lastPurchaseDate: stamp } : {}),
                    },
                    ConditionExpression: "attribute_not_exists(userId)",
                }));
                return "ok";
            } catch (e) {
                if (!isCondFail(e)) throw e;
                continue;   // 同時に誰かが結び付けた。読み直して持ち主を見る
            }
        }

        if (existing.ownerId === userId) {
            // 同じ人がより新しい取引を送ってきた → 比べる時刻を進める（落ちても結び付けはこの人のまま）
            if (stamp === undefined || (existing.lastPurchaseDate !== undefined && !(stamp > existing.lastPurchaseDate))) return "ok";
            try {
                const res = await ddb.send(new GetCommand({
                    TableName: USERS_TABLE, Key: { userId: appStoreLinkKey(originalTransactionId) }, ConsistentRead: true,
                }));
                const row = res.Item as Record<string, unknown> | undefined;
                if (!row || row.ownerId !== userId) continue;
                if (typeof row.lastPurchaseDate === "number" && !(stamp > row.lastPurchaseDate)) return "ok";
                const rev = typeof row.rev === "number" ? row.rev : 0;
                await ddb.send(new PutCommand({
                    TableName: USERS_TABLE,
                    Item: { ...row, lastPurchaseDate: stamp, rev: rev + 1 },
                    ...linkRevCondition(rev),
                }));
                return "ok";
            } catch (e) {
                if (isCondFail(e)) continue;
                console.error(`claimAppStoreLink: ${originalTransactionId} の lastPurchaseDate を進められませんでした:`, e);
                return "ok";
            }
        }

        if (!opts.tokenIsMine) return "other";
        // 取り消された・アップグレードで置き換わった取引では移さない（もう効いていない取引）
        if (opts.superseded) {
            console.warn(`claimAppStoreLink: ${originalTransactionId} の ${userId} の取引は取り消し・置き換え済みなので移しません`);
            return "other";
        }
        // 今の結び付けを決めた取引より新しいときだけ移す
        const reference = existing.lastPurchaseDate ?? await legacyLatestPurchase(existing.ownerId, originalTransactionId);
        if (incoming !== undefined && reference !== undefined && !(incoming > reference)) {
            console.warn(`claimAppStoreLink: ${originalTransactionId} は ${existing.ownerId} が新しい取引で持っているので ${userId} の古い取引では移しません`);
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
                    ...(stamp !== undefined ? { lastPurchaseDate: stamp } : {}),
                },
                // 読んだときの行のままなら移す（同時に別の付け替え・知らせの記録が来たら読み直す）
                ...linkRevCondition(existing.rev),
            }));
        } catch (e) {
            if (!isCondFail(e)) throw e;
            // 持ち主が変わった（同時に別の付け替えが通った）なら、負けた側は今までどおり引く。
            // 持ち主が同じまま（知らせの記録などで rev だけ進んだ）なら読み直して決め直す
            const again = await readAppStoreLink(originalTransactionId);
            if (again && again.ownerId !== existing.ownerId) return again.ownerId === userId ? "ok" : "other";
            continue;
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
    // 競合が続いた。最後に読んだ持ち主で答える
    const again = await readAppStoreLink(originalTransactionId);
    return again?.ownerId === userId ? "ok" : "other";
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
