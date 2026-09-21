import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE, USER_INDEX } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";

/**
 * ストーリーのアーカイブ（24時間で消えたあとも、本人だけが見られる）。
 *
 * **新しい置き場は作らない。** アーカイブは**ストーリーの行そのもの**で、
 * 投稿のときに立てた印（`archive: true`）を掃除（`cleanupExpiredStories`）が
 * 見て、消す代わりに `archivedAt` を刻み・`storyFeed` を外し・
 * 他人の言葉と名前（返信の文書・`viewers`・`replyCount`）だけ消したもの。
 * `keptAs` が「印があれば実体を消さない」なのと同じ1本の考え方。
 *
 * だから:
 *   - 一覧は `userId-createdAt-index` を引く（`countRecentStories` と
 *     退会処理が同じ索引でストーリーを見つけている）。ストーリー一覧の
 *     GSI（`storyFeed`）には棚へ移った時点で載っていない
 *   - **「期限が切れた ＋ 印がある」で引く。`archivedAt` では引かない。**
 *     `archivedAt` を刻むのは1時間ごとの掃除なので、それで引くと期限切れ
 *     から次の掃除までの間（最長およそ1時間・掃除が転べばもっと）
 *     **バーにもアーカイブにも無い**時間ができる。印のある行は掃除が
 *     消すことは無いので、期限が切れた時点で棚に在るとみなしてよい
 *   - 見るのは本人だけ。他人には `viewStory` / `postStoryReply` が
 *     期限切れとして 404 を返すので、**アーカイブで「消える」が緩むことは無い**
 *   - 消すのは `deleteStory`（本人か管理者）がそのまま効く——行・S3・
 *     返信の文書を一緒に消す
 *   - 退会は `account.ts` が同じ索引で全部の行を消すので、孤児にならない
 *
 * **数に上限は置いていない。** 1人1日20本までなので、日ごとに入にして
 * いれば年に数千行。索引の分割の中をふるいで読むので、写真とアーカイブが
 * 増えるほど1回の読みが重くなる。要るようになったらページ分け
 * （`ExclusiveStartKey` を応答に返す）を足す——その前に**古い順に落とす
 * 上限**を置くと、本人が残したものを黙って消すことになるので、それはしない。
 */

/** GET /stories/archive — 自分のアーカイブ（新しい順） */
export const getStoryArchive: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");

    try {
        const now = new Date().toISOString();
        const items: Record<string, unknown>[] = [];
        let lastKey: Record<string, unknown> | undefined;
        do {
            const res = await ddb.send(new QueryCommand({
                TableName: PHOTOS_TABLE,
                IndexName: USER_INDEX,
                KeyConditionExpression: "userId = :u",
                // 印があって、期限が切れている行だけ（上の docstring）。
                // `story = true` も見るのは、将来ほかの種類の行に同じ名前の
                // 列が生えても混ざらないように
                FilterExpression: "story = :t AND archive = :t AND expiresAt <= :now",
                ExpressionAttributeValues: { ":u": userId, ":t": true, ":now": now },
                // 新しい順（索引のソートキーは createdAt）
                ScanIndexForward: false,
                ExclusiveStartKey: lastKey,
            }));
            items.push(...((res.Items ?? []) as Record<string, unknown>[]));
            lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
        } while (lastKey);

        // 棚へ移る前の行（掃除がまだ来ていない）は `viewers` と `replyCount` を
        // まだ持っている。掃除が消すものは応答にも出さない——本人向けでも、
        // 他人の名前と数は期限とともに消える側（`cleanupExpiredStories`）
        for (const item of items) {
            delete item.viewers;
            delete item.replyCount;
        }

        return {
            // 本人向けの内容。共有キャッシュに載せない
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            body: JSON.stringify(items),
        };
    } catch (e) {
        console.error("getStoryArchive error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};
