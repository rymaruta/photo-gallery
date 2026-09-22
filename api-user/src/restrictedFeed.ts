import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { PUBLIC_INDEX, RESTRICTED_FEED_KEY } from "./publicFeed";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { readUserList } from "./userList";
import { closeFriendsId, isUserId } from "./closeFriends";
import { hiddenUserIds } from "./blockCheck";
// 行の名前は `followCheck.ts` が持つ（`follow.ts` は通知・S3・CDN まで
// 引き連れていて、読み込みの輪を作る）。**写しを作らない**——develop が
// 同じ理由でここへ切り出していたので、そちらに寄せた
import { followingId } from "./followCheck";
// **画像の URL に期限を付ける。** 鍵が無い環境では何もしない（`signedUrl.ts`）
import { signPhotoImages } from "./signedUrl";

/**
 * GET /feed/restricted — 公開範囲を絞った写真のうち、**自分に見えるぶん**。
 *
 * ## なぜ別の口が要るのか
 *
 * 写真の一覧（`app/data/photos.json`）は**全員に配る静的ファイル**で、
 * 個別ページもサイトマップもそこから作られる。載せた時点で
 * 「フォロワーだけ」は守れないので、絞った写真は**そこには出さず**、
 * ここでだけ返す。
 *
 * ## 索引を足していない
 *
 * `publicFeed-createdAt-index` の**別の仕切り**（`RESTRICTED_FEED_KEY`）を
 * 引く。`GET /photos` は仕切り `"1"` を引くので、絞ったぶんは混ざらない。
 */
export const MAX_ITEMS = 200;

export const getRestrictedFeed: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");
    try {
        const [items, following, closeOf, hidden] = await Promise.all([
            queryRestricted(),
            readUserList(followingId(userId), isUserId, "フォロー一覧")
                .catch(() => [] as string[]),
            // 自分を「親しい友達」に入れている人は、その人の行を読まないと
            // 分からない。**出している人ぶんだけ**あとで読む（下）
            Promise.resolve(new Set<string>()),
            hiddenUserIds(userId).catch(() => new Set<string>()),
        ]);

        const followingSet = new Set(following);
        const notBlocked = items.filter((i) => !hidden.has(String(i.userId ?? "")));

        // 「親しい友達」は持ち主の行にしか無い。**出している人だけ**読む
        const closeOwners = new Set(
            notBlocked.filter((i) => i.audience === "closeFriends")
                .map((i) => String(i.userId ?? ""))
                .filter((id) => id && id !== userId),
        );
        const closeFriendOf = closeOwners.size === 0 ? closeOf : await closeFriendsAmong(userId, closeOwners);

        const visible = notBlocked.filter((i) => isVisiblePhoto(i, userId, followingSet, closeFriendOf));
        return {
            statusCode: 200,
            // 利用者ごとの答えなので共有キャッシュには載せない
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            // 🔴 **画像の URL にも期限を付ける。** ここで誰に見せるかを
            // 正しく判定しても、配った URL が永久に有効なら、判定は
            // 「初回だけ」効いていることになる——フォローを外しても
            // ブロックしても、控えた URL で取り続けられる。
            // **鍵が無い環境（いまの本番）では何もしない**（`signedUrl.ts`）
            body: JSON.stringify(visible.map((p) => signPhotoImages(p))),
        };
    } catch (e) {
        console.error("getRestrictedFeed error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

/**
 * その人に見せてよいか。**閉じる側に倒す**（`stories.ts` と同じ約束）。
 *
 * 親しい友達は**フォローでは代用できない**（狭い方が勝つ）。
 */
export function isVisiblePhoto(
    item: { userId?: unknown; audience?: unknown },
    viewerId: string,
    following: Set<string>,
    closeFriendOf: Set<string>,
): boolean {
    const owner = String(item.userId ?? "");
    if (!owner) return false;
    if (owner === viewerId) return true;
    if (item.audience === "closeFriends") return closeFriendOf.has(owner);
    if (item.audience === "followers") return following.has(owner);
    // **印の無いものはここに来ない**（仕切りが違う）。来たら出さない
    return false;
}

async function queryRestricted(): Promise<Record<string, unknown>[]> {
    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
        const res = await ddb.send(new QueryCommand({
            TableName: PHOTOS_TABLE,
            IndexName: PUBLIC_INDEX,
            KeyConditionExpression: "publicFeed = :k",
            ExpressionAttributeValues: { ":k": RESTRICTED_FEED_KEY },
            // 新しい順
            ScanIndexForward: false,
            ExclusiveStartKey: lastKey as never,
        }));
        items.push(...((res.Items ?? []) as Record<string, unknown>[]));
        lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
        if (items.length >= MAX_ITEMS) break;
    } while (lastKey);
    return items.slice(0, MAX_ITEMS);
}

async function closeFriendsAmong(viewerId: string, owners: Set<string>): Promise<Set<string>> {
    const found = new Set<string>();
    await Promise.all([...owners].map(async (owner) => {
        try {
            const list = await readUserList(closeFriendsId(owner), isUserId, `closefriends#${owner}`);
            if (list.includes(viewerId)) found.add(owner);
        } catch (e) {
            console.error("closeFriendsAmong: 親しい友達を確かめられませんでした:", e);
        }
    }));
    return found;
}
