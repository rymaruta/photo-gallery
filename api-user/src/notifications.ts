import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { notifsId, NOTIFS_MAX, deletedUserIds, DELETED_USER_NAME } from "./notify";
import { hiddenUserIds } from "./block";

// 通知の取得と既読化。
// 通知本体は "notifs#<uid>" 文書に { items: Notif[], unread: number } として持つ。
// 書き込みは各操作（いいね・コメント・フォロー）から notify.ts 経由で追記される。

// GET /user/notifications — 通知一覧（認証必要）
export const getNotifications: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    // getUserId は sub 欠落で "" を返す（http.ts）。見ずに進むと
    // "notifs#"（空uid）という**共有の1行**を読み書きすることになる。
    // 他のハンドラは全部見ている。JWT オーソライザーが sub を保証するので
    // 実害はほぼ無いが、1か所だけ緩い状態を残さない。
    if (!uid) return jsonError(401, "認証が必要です");
    try {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: notifsId(uid) } }));
        const all = (Array.isArray(res.Item?.items) ? res.Item.items : []).slice(0, NOTIFS_MAX);

        // **ブロックした相手の通知は出さない（両向き）。**
        //
        // `pushNotification` が断るのは**これから来るぶん**だけ。通知は
        // 作られた時点の表示名（`byName`）と ID（`byId`）を焼き込んで持つので、
        // ブロックしても**それまでに届いたぶんはベルに残る**——名前も、
        // プロフィールへのリンク（`NotificationsBell` の `ROUTES.USER_PROFILE`）も
        // 生きたまま。50件の輪から押し出されるまで消えない。
        // ブロックはフォローを両向きに切り、ストーリーも両向きに隠すのに、
        // ここだけ「見せない相手」を通していた。
        //
        // **`hiddenUserIds` は和集合**（自分がブロックした人 ∪ 自分を
        // ブロックした人）なので、相手が自分をブロックした側も同じ形で消える。
        // 片側だけ（ブロックした本人の行を掃除する）にすると、もう片方は
        // **他人の行を書き換える**ことになるうえ、取りこぼしの窓も残る。
        //
        // **読めなければ一覧は返す**（`getStories` と同じ判断）。見えなくする側が
        // 落ちたときに全部消すのは倒しすぎで、通知が一件も出なくなる。
        const [hidden, gone] = all.length === 0
            ? [new Set<string>(), new Set<string>()]
            : await Promise.all([
                hiddenUserIds(uid).catch((e) => {
                    console.error("getNotifications: ブロック一覧を読めませんでした:", e);
                    return new Set<string>();
                }),
                deletedUserIds(),
            ]);
        const items = hidden.size === 0
            ? all
            : all.filter((n) => {
                const by = (n as { byId?: unknown }).byId;
                return !(typeof by === "string" && hidden.has(by));
            });
        // 未読数は保存件数を超えられない。DynamoDB 側は素のカウンタで、
        // 開かずに溜め続けると保存件数（NOTIFS_MAX）を超えて伸びる。
        // 丸めるのは**ここだけ**——切り詰め側で丸めると、その書き込みが
        // 既読化（下の readNotifications）を追い越してバッジを復活させる。
        // 見え方への影響は小さい（NotificationsBell は 9 を超えると "9+"
        // と描くので、ズレるのは「開くと50件しか無い」という点だけ）が、
        // 未読数と中身が食い違ったままにはしない。
        const stored = typeof res.Item?.unread === "number" ? res.Item.unread : 0;
        const unread = Math.max(0, Math.min(stored, items.length));

        // **退会した人の名前は出さない。**
        //
        // 通知には作られた時点の表示名（`byName`）と ID（`byId`）が焼き込まれ、
        // 退会が消すのは**自分宛て**の `notifs#<uid>` だけ。つまり
        // 「A が B の写真にいいね → A が退会」で、**B のベルには A の表示名が
        // 残り、プロフィールへのリンクも生きたまま**になる。
        // コメント側（`getComments`）は同じ理由で同じ判定を入れてあるので、
        // そこへ揃える。画面は `deleted` を見て導線を出さない。
        const safeItems = gone.size === 0
            ? items
            : items.map((n) => {
                const by = (n as { byId?: unknown }).byId;
                return typeof by === "string" && gone.has(by)
                    ? { ...(n as Record<string, unknown>), byName: DELETED_USER_NAME, deleted: true }
                    : n;
            });
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ items: safeItems, unread }) };
    } catch (e) {
        console.error("getNotifications error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

// PUT /user/notifications — 既読化（認証必要）
export const readNotifications: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    if (!uid) return jsonError(401, "認証が必要です");
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
