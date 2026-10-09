/**
 * メダルの**数え直し・保存・通知**と、`GET /user/badges`。数え方そのものは `badges.ts`（純関数）。
 *
 * ## いつ数え直すか
 *
 * - 写真を上げたあと（`upload.ts` の `savePhoto`）と、写真を直したあと
 *   （`photoUpdate.ts` の `updatePhotoVisibility`）——**本流を落とさない・待たせすぎない**
 *   （`refreshBadgesQuietly`：失敗は記録だけ・時間の上限つき）
 * - `GET /user/badges` を開いたとき（ここで数えた結果を保存もする）
 * - Pro の取引・知らせのあと（`supporterStore.ts` が同じ `mergeProBadges` を通す）
 *
 * Pro のメダル（サポーター章・続けた年・季節の章）もここで重ねる（`proBadges.ts`）。
 * 年ごとの人の季節の章は、季節が変わったあとの最初の数え直しで付く。
 *
 * Lambda は応答を返すと止まるので「応答のあとで」は書けない。だから本流の中で、
 * 上限（`QUIET_LIMIT_MS`）を切って待つ。上限を越えたぶんは次に開いたときに拾われる
 * （数え直しは何度やっても同じ答えになる）。
 *
 * ## 保存の書き方
 *
 * プロフィールの行（`USERS_TABLE`）を読み、`badges` だけ差し替えて **rev つきで置き直す**
 * （`userProfile.ts` の `removePinnedPhoto` と同じ書き方。この表に対する Lambda の権限は
 * GetItem / PutItem / DeleteItem / Scan だけで、UpdateItem は持っていない）。
 * rev を上げないと、`updateMyProfile` が読んだ古い姿（メダル無し）で上書きして、
 * 取ったメダルが消える。行が無い・墓石の行には書かない（作らない）。
 */
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./dynamodb";
import { requireEnv } from "./env";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { isDeletedProfile } from "./types";
import { listMyPhotos } from "./ddb-photos";
import { readUserList } from "./userList";
import { spotsId, isStoredSpotSlug } from "./savedSpots";
import { pushNotification } from "./notify";
import { badgeProgress, countBadges, mergeBadges } from "./badges";
import type { BadgeProgress } from "./badges";
import { badgeDisplayNameJa } from "./badgeKeys";
import type { BadgeKey, BadgeMap } from "./badgeKeys";
import { mergeProBadges, monthsOf } from "./proBadges";

const USERS_TABLE = requireEnv("USERS_TABLE");

/** 競合したときに読み直す回数（`userProfile.ts` の PROFILE_WRITE_RETRIES と同じ） */
const WRITE_RETRIES = 3;

export type BadgeResult = { badges: BadgeMap; progress: BadgeProgress };

/**
 * 数え直して、上がった段があれば保存して通知する。
 *
 * 読む・数える・書くの途中で落ちたら投げる（呼ぶ側が決める）。
 * 書けなかった（競合し続けた・行が無い）ときも、**数えた結果は返す**。
 */
export async function refreshBadges(userId: string, now: () => Date = () => new Date()): Promise<BadgeResult> {
    const [photos, wishKeys] = await Promise.all([
        listMyPhotos(userId),
        readUserList(spotsId(userId), isStoredSpotSlug, `spots#${userId}`),
    ]);
    const counts = countBadges(photos, wishKeys);

    let last: BadgeResult | null = null;
    for (let attempt = 0; attempt <= WRITE_RETRIES; attempt++) {
        const res = await ddb.send(new GetCommand({
            TableName: USERS_TABLE,
            Key: { userId },
            // 置き直すので行をまるごと読む（射影を付けない）
        }));
        const row = res.Item as ({ badges?: unknown; rev?: unknown; deletedAt?: unknown; supporter?: unknown } & Record<string, unknown>) | undefined;
        // 墓石（退会済み）→ 何も渡さない・書かない
        if (isDeletedProfile(row)) return { badges: {}, progress: badgeProgress(counts, undefined) };
        const t = now();
        const counted = mergeBadges(row?.badges, counts, t.toISOString());
        const pro = mergeProBadges(counted.badges, row?.supporter, t.getTime());
        const badges = pro.badges;
        const upgraded: { key: BadgeKey; tier: number }[] = [...counted.upgraded, ...pro.upgraded];
        last = { badges, progress: badgeProgress(counts, badges, monthsOf(row?.supporter, t.getTime())) };
        // 行が無い → 書かない（ここで行を作らない。作るのは getMyProfile の役目）。
        // 上がった段が無い → 書くものが無い
        if (!row || upgraded.length === 0) return last;
        const rev = typeof row.rev === "number" ? row.rev : 0;
        try {
            await ddb.send(new PutCommand({
                TableName: USERS_TABLE,
                Item: { ...row, userId, badges, rev: rev + 1 },
                // 行が在って・墓石でなく・読んだときから誰も書いていない
                ConditionExpression: rev === 0
                    ? "attribute_exists(userId) AND attribute_not_exists(deletedAt) AND (attribute_not_exists(rev) OR rev = :rev)"
                    : "attribute_exists(userId) AND attribute_not_exists(deletedAt) AND rev = :rev",
                ExpressionAttributeValues: { ":rev": rev },
            }));
        } catch (e) {
            if ((e as { name?: string }).name === "ConditionalCheckFailedException") continue;  // 読み直して重ね直す
            throw e;
        }
        // **書けてから知らせる**（書けなかった段を「手に入れました」と言わない）。
        // 通知は落ちても本流を止めない（pushNotification が握る）
        for (const up of upgraded) {
            await pushNotification(userId, {
                type: "badge",
                key: up.key,
                tier: up.tier,
                photoId: "",
                photoSrc: "",
                byName: badgeDisplayNameJa(up.key, up.tier),
                t: now().toISOString(),
            });
        }
        return last;
    }
    // 競合が続いた。数えた結果は返す（保存は次の機会に拾われる）
    console.warn(`refreshBadges: 競合が続いたので保存しませんでした（${userId}）`);
    return last ?? { badges: {}, progress: badgeProgress(counts, undefined) };
}

/** 本流の中で待ってよい上限。越えたら待たずに先へ進む（数え直しは次の機会に拾われる） */
export const QUIET_LIMIT_MS = 2500;

/**
 * 写真の保存・更新のあとに呼ぶ。**投げない・待たせすぎない。**
 * 失敗は記録だけ（写真はもう保存されている）。
 */
export async function refreshBadgesQuietly(userId: string, label: string): Promise<void> {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            refreshBadges(userId).catch((e) => {
                console.error(`${label}: メダルを数え直せませんでした（${userId}）:`, e);
            }),
            new Promise<void>((resolve) => { timer = setTimeout(resolve, QUIET_LIMIT_MS); }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * GET /user/badges — 自分のメダルと進み具合（認証必要）。
 *
 *     { badges: { [鍵]: { tier, at } }, progress: { [鍵]: { count, tier, next } } }
 *
 * 開くたびに数え直す（上がっていれば保存して通知する）。
 */
export const getMyBadges: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");
    try {
        const result = await refreshBadges(userId);
        return {
            statusCode: 200,
            // 本人だけの答え。共有キャッシュに載せない
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            body: JSON.stringify(result),
        };
    } catch (e) {
        console.error("getMyBadges error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};
