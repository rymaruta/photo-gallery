import type { APIGatewayProxyHandlerV2, APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { PutCommand, DeleteCommand, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";

// いいねはアグリゲート数を写真レコードの `likes` 属性に持ち、
// 二重カウント防止のために「誰がいいねしたか」をマーカー item で記録する。
//
// マーカー item の id: "like#<photoId>#<userId>"
//   - 完全キー（id）だけで読み書きするので Query 不要
//   - GSI キー属性 `userId` は付けず `uid` を使う → 写真一覧 GSI を汚さない

function markerId(photoId: string, userId: string): string {
    return `like#${photoId}#${userId}`;
}

async function readLikeCount(photoId: string): Promise<number> {
    const res = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: photoId },
        ProjectionExpression: "likes",
    }));
    const n = res.Item?.likes;
    return typeof n === "number" && n > 0 ? n : 0;
}

// GET /photos/{id}/like — 現在のいいね数（公開）
export const getLikeCount: APIGatewayProxyHandlerV2 = async (event) => {
    const photoId = event.pathParameters?.id;
    if (!photoId) return jsonError(400, "IDが必要です");
    try {
        return {
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "public, s-maxage=30" },
            body: JSON.stringify({ likes: await readLikeCount(photoId) }),
        };
    } catch (e) {
        console.error("getLikeCount error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

// POST /photos/{id}/like — いいね（認証必要・冪等）
export const likePhoto: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    const photoId = event.pathParameters?.id;
    if (!userId || !photoId) return jsonError(400, "不正なリクエスト");

    try {
        // マーカー作成（既にあれば ConditionalCheckFailed）
        try {
            await ddb.send(new PutCommand({
                TableName: PHOTOS_TABLE,
                Item: { id: markerId(photoId, userId), like: true, photoId, uid: userId, createdAt: new Date().toISOString() },
                ConditionExpression: "attribute_not_exists(id)",
            }));
        } catch (e) {
            if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
                // 既にいいね済み。現在数を返す（冪等）
                return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ liked: true, likes: await readLikeCount(photoId) }) };
            }
            throw e;
        }

        // 写真カウンタを +1（写真が存在する場合のみ）
        try {
            const res = await ddb.send(new UpdateCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: photoId },
                UpdateExpression: "SET likes = if_not_exists(likes, :z) + :one",
                ConditionExpression: "attribute_exists(id)",
                ExpressionAttributeValues: { ":z": 0, ":one": 1 },
                ReturnValues: "UPDATED_NEW",
            }));
            const likes = (res.Attributes?.likes as number | undefined) ?? 1;
            return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ liked: true, likes }) };
        } catch (e) {
            // 写真が存在しない → マーカーを巻き戻して 404
            if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
                await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: markerId(photoId, userId) } })).catch(() => { /* ignore */ });
                return jsonError(404, "写真が見つかりません");
            }
            throw e;
        }
    } catch (e) {
        console.error("likePhoto error:", e);
        return jsonError(500, "いいねに失敗しました");
    }
};

// DELETE /photos/{id}/like — いいね解除（認証必要・冪等）
export const unlikePhoto: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    const photoId = event.pathParameters?.id;
    if (!userId || !photoId) return jsonError(400, "不正なリクエスト");

    try {
        // マーカー削除（無ければ ConditionalCheckFailed → 冪等に現在数を返す）
        try {
            await ddb.send(new DeleteCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: markerId(photoId, userId) },
                ConditionExpression: "attribute_exists(id)",
            }));
        } catch (e) {
            if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
                return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ liked: false, likes: await readLikeCount(photoId) }) };
            }
            throw e;
        }

        // カウンタを -1（0未満にはしない）
        try {
            const res = await ddb.send(new UpdateCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: photoId },
                UpdateExpression: "SET likes = likes - :one",
                ConditionExpression: "attribute_exists(id) AND likes > :z",
                ExpressionAttributeValues: { ":z": 0, ":one": 1 },
                ReturnValues: "UPDATED_NEW",
            }));
            const likes = (res.Attributes?.likes as number | undefined) ?? 0;
            return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ liked: false, likes }) };
        } catch (e) {
            // likes が既に0 or 写真なし → 現在数（0）を返す
            if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
                return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ liked: false, likes: await readLikeCount(photoId) }) };
            }
            throw e;
        }
    } catch (e) {
        console.error("unlikePhoto error:", e);
        return jsonError(500, "いいね解除に失敗しました");
    }
};
