import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { requireEnv } from "./env";

// 通知の共通ヘルパー。
// 通知は "notifs#<uid>" 文書に list_append + ADD unread でアトミックに追記する
// （同時書き込みでも失われない）。件数上限の切り詰めは取得時に行う。

export type Notif = {
    // 実際に作られるのは like / comment / follow の3種類。
    // inspired / go は「行きたいリスト」機能のもので、通知を作る側が
    // どこにも無い（マーカーを書く経路も、UIのボタンも存在しない）。
    type: "like" | "comment" | "follow";
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

/**
 * 設定されている表示名だけを引く（未設定・読めない場合は undefined）。
 *
 * 写真の `displayName` はこちらを使う。既定名を入れてしまうと、
 * 名前を設定していない人の写真ページに
 * 「名前未設定さんの他の写真」という導線が新しく出てしまう
 * （今は displayName が無ければ出ない）。表示を勝手に変えない。
 */
export async function lookupDisplayNameIfSet(uid: string): Promise<string | undefined> {
    try {
        const res = await ddb.send(new GetCommand({
            TableName: USERS_TABLE,
            Key: { userId: uid },
            ProjectionExpression: "displayName",
        }));
        const name = typeof res.Item?.displayName === "string" ? res.Item.displayName.trim() : "";
        return name || undefined;
    } catch {
        return undefined;
    }
}

/** 表示名を Users テーブルから引く（クライアント申告を信用しない）。無ければ既定名 */
export async function lookupDisplayName(uid: string): Promise<string> {
    return (await lookupDisplayNameIfSet(uid)) ?? DEFAULT_NAME;
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

        // 上限を超えたら新しい方から NOTIFS_MAX 件だけ残す。
        //
        // 「読んだときと同じ長さのままなら書く」条件を必ず付ける。
        // 無条件に書いていた頃は、ほぼ同時に2件届くと**片方が消えていた**——
        // 表示されないのではなく DynamoDB から無くなる。
        //   50件のオーナーに A のいいねと B のコメントが同時に届く
        //   → A が51件のスナップショットを持つ
        //   → B が52件を正しく書く
        //   → A の切り詰めが「B を含まない50件」で上書きする
        // comments.ts の切り詰めが同じ理由で `size(#items) = :len` を
        // 付けている（対の実装。片方を直したらもう片方も見ること）。
        // 外れたら諦めてよい——次の通知がまた切り詰める。
        const items = res.Attributes?.items;
        const unread = typeof res.Attributes?.unread === "number" ? res.Attributes.unread : 0;
        if (Array.isArray(items) && items.length > NOTIFS_MAX) {
            const sets = ["#items = :trimmed"];
            const values: Record<string, unknown> = {
                ":trimmed": items.slice(0, NOTIFS_MAX),
                ":len": items.length,
            };
            // 未読数は「前回開いてからの件数」なので保存件数と同じではないが、
            // **保存件数を超えることはあり得ない**。捨てた分まで数え続けると、
            // 開かずに200件溜めた人のバッジが「200」なのに中身は50件になる。
            if (unread > NOTIFS_MAX) {
                sets.push("unread = :cap");
                values[":cap"] = NOTIFS_MAX;
            }
            await ddb.send(new UpdateCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: notifsId(ownerId) },
                UpdateExpression: "SET " + sets.join(", "),
                ConditionExpression: "size(#items) = :len",
                ExpressionAttributeNames: { "#items": "items" },
                ExpressionAttributeValues: values,
            })).catch((e: { name?: string }) => {
                if (e?.name !== "ConditionalCheckFailedException") throw e;
                // 競合。次の通知が切り詰める
            });
        }
    } catch (e) {
        console.error("pushNotification error:", e);
    }
}
