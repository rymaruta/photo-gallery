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

/**
 * **外に出さない項目。** `lib/server/photos.ts` ／ `api/src/photos.ts` ／
 * `scripts/sync-photos-from-ddb.js` と同じ一覧で、
 * `scripts/__tests__/privateFieldsParity.test.ts` が突き合わせる。
 *
 * ここは**見せてよい相手にだけ返す口**だが、それは「行をそのまま渡してよい」
 * という意味ではない。とくに `srcOriginal` は **EXIF を落とす前の原本**（GPS 入り）
 * のURLで、フォロワーであっても撮影者の自宅が割れる粒度の情報を渡すことになる。
 *
 * 同じ考えを `api-user/src/albums.ts` が先に書いている（招いた相手にだけ返す口で、
 * 表示に要る項目だけを組み直している）。**ここだけ生の行を返していた。**
 */
const PRIVATE_FIELDS = ["srcOriginal", "key", "staticStale", "publicFeed", "keptFrom"] as const;

/** 行から外に出さない項目を落とす（渡すのは写し。元の行は触らない） */
export function stripPrivate(item: Record<string, unknown>): Record<string, unknown> {
    const out = { ...item };
    for (const f of PRIVATE_FIELDS) delete out[f];
    return out;
}

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
            // 🔴 **読めなければ返さない（500）。** 空の集合に倒すと、ブロックした
            // 相手に「親しい友達」の写真が渡る——`isVisiblePhoto` の closeFriends は
            // フォローを見ず、`block.ts` は親しい友達から外さない。フォローの解除も
            // 失敗を握りつぶすので、「フォロワーのみ」も安全とは言えない。
            // ここは限定公開だけを返す口なので、閉じる側に倒す（公開の一覧は別の口）
            hiddenUserIds(userId),
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
            // 🔴 **落としてから、署名する。順番に意味がある。**
            //
            // この1行を2つの PR が別々に書き換えていた（#134 が
            // `stripPrivate`・#136 が `signPhotoImages`）。**機械任せに
            // すると片方が黙って消える**——`stripPrivate` が消えれば
            // GPS 入り原本の URL が戻り、`signPhotoImages` が消えれば
            // 署名が効かない。**要るのは両方。**
            //
            // 先に落とすのは、これから捨てる項目（`srcOriginal`）に
            // 署名しないため。署名してから落としても結果は同じだが、
            // **捨てるものに鍵をかける**のは読む人を迷わせる。
            //
            //  - `stripPrivate`   … 原本・S3 のキー・内部の印を外に出さない
            //  - `signPhotoImages`… 残った画像の URL に期限を付ける
            //                       （鍵が無い環境では何もしない）
            body: JSON.stringify(visible.map((p) => signPhotoImages(stripPrivate(p)))),
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
