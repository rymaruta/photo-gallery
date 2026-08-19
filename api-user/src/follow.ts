import type { APIGatewayProxyHandlerV2, APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { PutCommand, DeleteCommand, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { pushNotification, lookupDisplayName } from "./notify";

// フォロー。すべて PHOTOS_TABLE・単一キー id で完結し GSI は汚さない。
//   - "follow#<targetUid>#<followerUid>" … 冪等マーカー（follower は uid 属性）
//   - "followstats#<uid>"                … { followers, following } 集計（原子加算）
//   - "following#<uid>"                  … 自分がフォロー中の userId リスト（feed/ボタン用）
// カウンタは users テーブルではなくここに置くため users-table の IAM 追加は不要。

const FOLLOWING_MAX = 2000;

const markerId = (target: string, follower: string) => `follow#${target}#${follower}`;
const statsId = (uid: string) => `followstats#${uid}`;
const followingId = (uid: string) => `following#${uid}`;

async function readStats(uid: string): Promise<{ followers: number; following: number }> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: statsId(uid) } }));
    const f = res.Item?.followers;
    const g = res.Item?.following;
    return {
        followers: typeof f === "number" && f > 0 ? f : 0,
        following: typeof g === "number" && g > 0 ? g : 0,
    };
}

async function readFollowing(uid: string): Promise<string[]> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: followingId(uid) } }));
    const list = res.Item?.list;
    return Array.isArray(list) ? (list as string[]) : [];
}

/**
 * following# の list を安全に書き換える。
 *
 * 以前は「読む → 変える → 無条件で Put」だった。1秒のうちに2人フォローすると
 * 2つの Lambda が同じ空リストを読み、片方の書き込みがもう片方を丸ごと
 * 上書きして、フォローが1件に減っていた。しかも follow# マーカーは両方
 * 残るので、もう一度フォローしても「既にフォロー済み」で早期 return し、
 * 一覧は欠けたまま直らない（フィードにその人の写真が出なくなる）。
 *
 * 順序（新しくフォローした順）を保ちたいので集合型には替えず、
 * リビジョン番号で衝突を検出して読み直す。
 */
const FOLLOWING_WRITE_RETRIES = 3;

async function updateFollowing(uid: string, mutate: (list: string[]) => string[] | null): Promise<void> {
    for (let attempt = 0; attempt <= FOLLOWING_WRITE_RETRIES; attempt++) {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: followingId(uid) } }));
        const current = Array.isArray(res.Item?.list) ? (res.Item.list as string[]) : [];
        const rev = typeof res.Item?.rev === "number" ? res.Item.rev : 0;

        const next = mutate([...current]);
        if (next === null) return; // 変更なし

        // 読んでから今までに他の書き込みが入っていないこと。
        // rev を持たない既存データ（この仕組みを入れる前の item）も通す必要が
        // あるので、rev が無いときだけ条件を緩める。
        // DynamoDB は値どうしの比較を許さないため、分岐は JS 側で作る。
        const guard = rev === 0
            ? "attribute_not_exists(id) OR attribute_not_exists(rev) OR rev = :rev"
            : "rev = :rev";

        try {
            await ddb.send(new PutCommand({
                TableName: PHOTOS_TABLE,
                Item: {
                    id: followingId(uid),
                    uid,
                    list: next.slice(0, FOLLOWING_MAX),
                    rev: rev + 1,
                    updatedAt: new Date().toISOString(),
                },
                ConditionExpression: guard,
                ExpressionAttributeValues: { ":rev": rev },
            }));
            return;
        } catch (e) {
            if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;
            // 競合。読み直してやり直す
        }
    }
    console.error(`updateFollowing: ${uid} の一覧更新が競合し続けたため諦めました`);
}

async function bumpStat(uid: string, field: "followers" | "following", delta: 1 | -1): Promise<void> {
    if (delta === 1) {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: statsId(uid) },
            UpdateExpression: `SET ${field} = if_not_exists(${field}, :z) + :one, uid = :uid`,
            ExpressionAttributeValues: { ":z": 0, ":one": 1, ":uid": uid },
        }));
    } else {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: statsId(uid) },
            UpdateExpression: `SET ${field} = ${field} - :one`,
            ConditionExpression: `attribute_exists(id) AND ${field} > :z`,
            ExpressionAttributeValues: { ":z": 0, ":one": 1 },
        })).catch(() => { /* 0 or 無しは無視 */ });
    }
}

// POST /users/{uid}/follow — フォロー（認証必要・冪等）
export const followUser: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const me = getUserId(event);
    const target = event.pathParameters?.uid;
    if (!me || !target) return jsonError(400, "不正なリクエスト");
    if (me === target) return jsonError(400, "自分はフォローできません");

    try {
        // マーカー（既にあれば冪等）
        try {
            await ddb.send(new PutCommand({
                TableName: PHOTOS_TABLE,
                Item: { id: markerId(target, me), follow: true, target, uid: me, createdAt: new Date().toISOString() },
                ConditionExpression: "attribute_not_exists(id)",
            }));
        } catch (e) {
            if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
                return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ following: true, followers: (await readStats(target)).followers }) };
            }
            throw e;
        }

        // カウンタ更新（target.followers +1 / me.following +1）
        await bumpStat(target, "followers", 1);
        await bumpStat(me, "following", 1);

        // 自分の following リストに追加（新しい順の先頭へ）
        await updateFollowing(me, (list) => {
            if (list.includes(target)) return null;
            list.unshift(target);
            return list;
        });

        // 相手に通知
        await pushNotification(target, {
            type: "follow",
            photoId: "",
            photoSrc: "",
            byName: await lookupDisplayName(me),
            byId: me,
            targetUserId: me,
            t: new Date().toISOString(),
        });

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ following: true, followers: (await readStats(target)).followers }) };
    } catch (e) {
        console.error("followUser error:", e);
        return jsonError(500, "フォローに失敗しました");
    }
};

// DELETE /users/{uid}/follow — フォロー解除（認証必要・冪等）
export const unfollowUser: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const me = getUserId(event);
    const target = event.pathParameters?.uid;
    if (!me || !target) return jsonError(400, "不正なリクエスト");

    try {
        try {
            await ddb.send(new DeleteCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: markerId(target, me) },
                ConditionExpression: "attribute_exists(id)",
            }));
        } catch (e) {
            if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
                return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ following: false, followers: (await readStats(target)).followers }) };
            }
            throw e;
        }

        await bumpStat(target, "followers", -1);
        await bumpStat(me, "following", -1);

        await updateFollowing(me, (list) => {
            const next = list.filter((x) => x !== target);
            return next.length === list.length ? null : next;
        });

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ following: false, followers: (await readStats(target)).followers }) };
    } catch (e) {
        console.error("unfollowUser error:", e);
        return jsonError(500, "フォロー解除に失敗しました");
    }
};

// GET /users/{uid}/follow — フォロワー/フォロー中の数（公開）
export const getFollowStats: APIGatewayProxyHandlerV2 = async (event) => {
    const uid = event.pathParameters?.uid;
    if (!uid) return jsonError(400, "IDが必要です");
    try {
        return {
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "public, s-maxage=30" },
            body: JSON.stringify(await readStats(uid)),
        };
    } catch (e) {
        console.error("getFollowStats error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

// GET /user/following — 自分がフォロー中の userId 一覧（認証必要・feed/ボタン用）
export const getMyFollowing: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const me = getUserId(event);
    if (!me) return jsonError(400, "不正なリクエスト");
    try {
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ userIds: await readFollowing(me) }) };
    } catch (e) {
        console.error("getMyFollowing error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};
