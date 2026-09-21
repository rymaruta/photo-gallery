import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE, USER_INDEX } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";

/**
 * ストーリーのアーカイブ（24時間で消えたあとも、本人だけが見られる）。
 *
 * **新しい置き場は作らない。** アーカイブは**ストーリーの行そのもの**で、
 * 掃除（`cleanupExpiredStories`）が「アーカイブに自動保存」の印を見て
 * 消す代わりに `archivedAt` を刻み、`storyFeed` を外したもの。
 * `keptAs` が「印があれば実体を消さない」なのと同じ1本の考え方。
 *
 * だから:
 *   - 一覧は `userId-createdAt-index` を引く（`countRecentStories` と
 *     退会処理が同じ索引でストーリーを見つけている）。ストーリー一覧の
 *     GSI（`storyFeed`）にはもう載っていない
 *   - 見るのは本人だけ。他人には `viewStory` / `postStoryReply` が
 *     期限切れとして 404 を返すので、**アーカイブで「消える」が緩むことは無い**
 *   - 消すのは `deleteStory`（本人か管理者）がそのまま効く——行・S3・
 *     返信の文書を一緒に消す
 *   - 退会は `account.ts` が同じ索引で全部の行を消すので、孤児にならない
 */

/** GET /stories/archive — 自分のアーカイブ（新しい順） */
export const getStoryArchive: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");

    try {
        const items: Record<string, unknown>[] = [];
        let lastKey: Record<string, unknown> | undefined;
        do {
            const res = await ddb.send(new QueryCommand({
                TableName: PHOTOS_TABLE,
                IndexName: USER_INDEX,
                KeyConditionExpression: "userId = :u",
                // **`archivedAt` が在る行だけ。** `story = true` も見るのは、
                // 将来ほかの種類の行に同じ名前の列が生えても混ざらないように
                FilterExpression: "story = :t AND attribute_exists(archivedAt)",
                ExpressionAttributeValues: { ":u": userId, ":t": true },
                // 新しい順（索引のソートキーは createdAt）
                ScanIndexForward: false,
                ExclusiveStartKey: lastKey,
            }));
            items.push(...((res.Items ?? []) as Record<string, unknown>[]));
            lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
        } while (lastKey);

        // 閲覧者は `getStories` と同じく応答から外す（本人は
        // `getStoryViewers` で引く。1つの形に揃える）
        for (const item of items) delete item.viewers;

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
