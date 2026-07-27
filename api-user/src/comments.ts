import type { APIGatewayProxyHandlerV2, APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand, UpdateCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { pushNotification, lookupDisplayName } from "./notify";

// 写真コメント。
// ストレージ: "comments#<photoId>" の list ドキュメント（notifs と同型）に
// list_append で追記。写真 item の commentCount を原子加算。
// 単一PKテーブルなので prefix Query は使えず、写真ごとの1ドキュメントに集約する。

export type Comment = {
    id: string;
    uid: string;
    name: string;
    text: string;
    t: string;
};

const COMMENTS_MAX = 200;   // 読み取り時に新しい順で切り詰め
const TEXT_MAX = 500;

const commentsId = (photoId: string) => `comments#${photoId}`;

async function readComments(photoId: string): Promise<Comment[]> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: commentsId(photoId) } }));
    const items = res.Item?.items;
    return Array.isArray(items) ? (items as Comment[]) : [];
}

// GET /photos/{id}/comments — コメント一覧（公開）。新しい順で最大200件
export const getComments: APIGatewayProxyHandlerV2 = async (event) => {
    const photoId = event.pathParameters?.id;
    if (!photoId) return jsonError(400, "IDが必要です");
    try {
        const all = await readComments(photoId);
        const items = all.slice(-COMMENTS_MAX).reverse(); // 末尾追記なので後ろが新しい
        return {
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "public, s-maxage=15" },
            body: JSON.stringify({ items, count: all.length }),
        };
    } catch (e) {
        console.error("getComments error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

// POST /photos/{id}/comments — コメント投稿（認証必要）
export const postComment: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    const photoId = event.pathParameters?.id;
    if (!uid || !photoId) return jsonError(400, "不正なリクエスト");

    let body: { text?: unknown };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return jsonError(400, "不正なリクエスト");
    }
    const text = typeof body.text === "string" ? body.text.trim().slice(0, TEXT_MAX) : "";
    if (!text) return jsonError(400, "コメントを入力してください");

    try {
        // 写真の存在確認（通知先とサムネ取得も兼ねる）
        const photoRes = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: photoId } }));
        const photo = photoRes.Item as { src?: string; thumbSrc?: string; userId?: string; location?: string } | undefined;
        if (!photo || !photo.src) return jsonError(404, "写真が見つかりません");

        const comment: Comment = {
            id: uuidv4(),
            uid,
            name: await lookupDisplayName(uid),
            text,
            t: new Date().toISOString(),
        };

        // コメントドキュメントへ原子追記
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: commentsId(photoId) },
            UpdateExpression:
                "SET #items = list_append(if_not_exists(#items, :empty), :new), photoId = :pid, updatedAt = :now",
            ExpressionAttributeNames: { "#items": "items" },
            ExpressionAttributeValues: { ":new": [comment], ":empty": [], ":pid": photoId, ":now": comment.t },
        }));

        // 写真の commentCount +1
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: photoId },
            UpdateExpression: "SET commentCount = if_not_exists(commentCount, :z) + :one",
            ConditionExpression: "attribute_exists(id)",
            ExpressionAttributeValues: { ":z": 0, ":one": 1 },
        })).catch(() => { /* 写真が消えていても本文は保存済み */ });

        // 写真オーナーへ通知（自分の写真は除く）
        const owner = photo.userId ? String(photo.userId) : undefined;
        if (owner && owner !== uid) {
            await pushNotification(owner, {
                type: "comment",
                photoId,
                photoSrc: String(photo.thumbSrc ?? photo.src),
                byName: comment.name,
                ...(photo.location ? { atLocation: photo.location } : {}),
                t: comment.t,
            });
        }

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ comment }) };
    } catch (e) {
        console.error("postComment error:", e);
        return jsonError(500, "投稿に失敗しました");
    }
};

// DELETE /photos/{id}/comments/{commentId} — 削除（投稿者本人 or 写真オーナー）
export const deleteComment: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    const photoId = event.pathParameters?.id;
    const commentId = event.pathParameters?.commentId;
    if (!uid || !photoId || !commentId) return jsonError(400, "不正なリクエスト");

    try {
        // 写真オーナー判定
        const photoRes = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: photoId } }));
        const ownerId = photoRes.Item ? String(photoRes.Item.userId ?? photoRes.Item.uploadedBy ?? "") : "";

        const all = await readComments(photoId);
        const target = all.find((c) => c.id === commentId);
        if (!target) return jsonError(404, "コメントが見つかりません");
        // 投稿者本人 or 写真オーナーのみ
        if (target.uid !== uid && ownerId !== uid) return jsonError(403, "権限がありません");

        const next = all.filter((c) => c.id !== commentId);
        // read-modify-write で1件除去
        await ddb.send(new PutCommand({
            TableName: PHOTOS_TABLE,
            Item: { id: commentsId(photoId), items: next, photoId, updatedAt: new Date().toISOString() },
        }));

        // commentCount −1（0未満ガード）
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: photoId },
            UpdateExpression: "SET commentCount = commentCount - :one",
            ConditionExpression: "attribute_exists(id) AND commentCount > :z",
            ExpressionAttributeValues: { ":z": 0, ":one": 1 },
        })).catch(() => { /* 0 or 写真消滅は無視 */ });

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };
    } catch (e) {
        console.error("deleteComment error:", e);
        return jsonError(500, "削除に失敗しました");
    }
};
