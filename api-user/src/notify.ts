import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { requireEnv } from "./env";

// 通知の共通ヘルパー。
// 通知は "notifs#<uid>" 文書に list_append + ADD unread でアトミックに追記する
// （同時書き込みでも失われない）。件数上限の切り詰めは取得時に行う。

export type Notif = {
    type: "inspired" | "like" | "go" | "comment" | "follow";
    photoId: string;
    photoSrc: string;
    byName: string;
    // 通知を起こした本人の userId。
    // 名前だけだと、名前未設定の人は既定名で表示され、誰なのか辿れない。
    // これがあれば通知からその人のプロフィールへ飛べる。
    byId?: string;
    atLocation?: string;
    // follow 通知は写真を伴わないため、リンク先のユーザーIDを持つ
    targetUserId?: string;
    t: string;
};

export const notifsId = (uid: string) => `notifs#${uid}`;

const USERS_TABLE = requireEnv("USERS_TABLE");
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

// 保持する通知の件数。DynamoDB の1アイテム上限（400KB）に達すると
// 以後の書き込みが全部失敗し、しかもこの関数はエラーを握りつぶすため、
// その人には二度と通知が届かなくなる。追記時に必ず切り詰める。
export const NOTIFS_MAX = 50;

/**
 * 通知を積む。通知は本流の操作（いいね等）を失敗させないよう、
 * エラーはログに残して握りつぶす。
 *
 * 追記は list_append の1回で済ませたいが、それだと際限なく伸びる。
 * 溢れそうなときだけ読み直して切り詰める（通常は追記1回のまま）。
 */
export async function pushNotification(ownerId: string, notif: Notif): Promise<void> {
    try {
        const res = await ddb.send(new UpdateCommand({
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
            ReturnValues: "UPDATED_NEW",
        }));

        // 上限を超えたら新しい方から NOTIFS_MAX 件だけ残す
        const items = res.Attributes?.items;
        if (Array.isArray(items) && items.length > NOTIFS_MAX) {
            await ddb.send(new UpdateCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: notifsId(ownerId) },
                UpdateExpression: "SET #items = :trimmed",
                ExpressionAttributeNames: { "#items": "items" },
                ExpressionAttributeValues: { ":trimmed": items.slice(0, NOTIFS_MAX) },
            }));
        }
    } catch (e) {
        console.error("pushNotification error:", e);
    }
}
