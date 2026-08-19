import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";

// 通知の共通ヘルパー。
// 通知は "notifs#<uid>" 文書に list_append + ADD unread でアトミックに追記する
// （同時書き込みでも失われない）。件数上限の切り詰めは取得時に行う。

export type Notif = {
    type: "inspired" | "like" | "go" | "comment" | "follow";
    photoId: string;
    photoSrc: string;
    byName: string;
    atLocation?: string;
    // follow 通知は写真を伴わないため、リンク先のユーザーIDを持つ
    targetUserId?: string;
    t: string;
};

export const notifsId = (uid: string) => `notifs#${uid}`;

const USERS_TABLE = process.env.USERS_TABLE ?? "prod-photo-gallery-users";
// プロフィール未設定の人に使う表示。人名に見える語（以前は「旅人」）だと
// 「そういう名前の人がいる」と誤解され、検索しても見つからず混乱するため、
// 明らかに未設定と分かる表記にする。
const DEFAULT_NAME = "名前未設定さん";

/** 表示名を Users テーブルから引く（クライアント申告を信用しない）。無ければ既定名 */
export async function lookupDisplayName(uid: string): Promise<string> {
    try {
        const res = await ddb.send(new GetCommand({
            TableName: USERS_TABLE,
            Key: { userId: uid },
            ProjectionExpression: "displayName",
        }));
        const name = typeof res.Item?.displayName === "string" ? res.Item.displayName.trim() : "";
        return name || DEFAULT_NAME;
    } catch {
        return DEFAULT_NAME;
    }
}

/**
 * 通知を積む。通知は本流の操作（いいね等）を失敗させないよう、
 * エラーはログに残して握りつぶす。
 */
export async function pushNotification(ownerId: string, notif: Notif): Promise<void> {
    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: notifsId(ownerId) },
            UpdateExpression:
                "SET #items = list_append(:new, if_not_exists(#items, :empty)), " +
                "unread = if_not_exists(unread, :z) + :one, uid = :owner, updatedAt = :now",
            ExpressionAttributeNames: { "#items": "items" },
            ExpressionAttributeValues: {
                ":new": [notif],
                ":empty": [],
                ":z": 0,
                ":one": 1,
                ":owner": ownerId,
                ":now": notif.t,
            },
        }));
    } catch (e) {
        console.error("pushNotification error:", e);
    }
}
