import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { notifsId, NOTIFS_MAX } from "./notify";

// 通知の取得と既読化。
// 通知本体は "notifs#<uid>" 文書に { items: Notif[], unread: number } として持つ。
// 書き込みは各操作（いいね・コメント・フォロー）から notify.ts 経由で追記される。

// GET /user/notifications — 通知一覧（認証必要）
export const getNotifications: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    try {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: notifsId(uid) } }));
        const items = (Array.isArray(res.Item?.items) ? res.Item.items : []).slice(0, NOTIFS_MAX);
        // 未読数は保存件数を超えられない。書き込み側は notify.ts で頭打ちに
        // してあるが、それより前に溜まった行は `unread > items.length` の
        // まま残っている（バッジが「200」なのに開くと50件）。読み側でも丸める。
        const stored = typeof res.Item?.unread === "number" ? res.Item.unread : 0;
        const unread = Math.max(0, Math.min(stored, items.length));
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ items, unread }) };
    } catch (e) {
        console.error("getNotifications error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

// PUT /user/notifications — 既読化（認証必要）
export const readNotifications: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: notifsId(uid) },
            UpdateExpression: "SET unread = :z",
            ConditionExpression: "attribute_exists(id)",
            ExpressionAttributeValues: { ":z": 0 },
        })).catch((e) => {
            if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;
        });
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };
    } catch (e) {
        console.error("readNotifications error:", e);
        return jsonError(500, "更新に失敗しました");
    }
};
