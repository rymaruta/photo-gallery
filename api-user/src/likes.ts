import type { APIGatewayProxyHandlerV2, APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { PutCommand, DeleteCommand, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { pushNotification, lookupDisplayName } from "./notify";

// いいねはアグリゲート数を写真レコードの `likes` 属性に持ち、
// 二重カウント防止のために「誰がいいねしたか」をマーカー item で記録する。
//
// マーカー item の id: "like#<photoId>#<userId>"
//   - 完全キー（id）だけで読み書きするので Query 不要
//   - GSI キー属性 `userId` は付けず `uid` を使う → 写真一覧 GSI を汚さない

function markerId(photoId: string, userId: string): string {
    return `like#${photoId}#${userId}`;
}

/**
 * 「この失敗は、書き込みが**適用されていない**と言い切れるか」。
 *
 * マーカーとカウンタは別々の書き込みなので、片方が落ちたらもう片方を
 * 戻さないと食い違う。ところが「どんな失敗でも戻す」にすると、
 * タイムアウトや応答の取りこぼし——**適用されたかどうか分からない**失敗
 * ——でも戻してしまう。いいねの場合、実際には +1 されているのに
 * マーカーだけ消えるので、本人が取り消しても `attribute_exists(id)` に
 * 引っかかって減らせない。つまり**誰にも直せない +1** が残る。
 *
 * だから戻すのは「適用されていないと言い切れる」失敗だけにする。
 * 分からない失敗ではマーカーを残す。それで必ず直るわけではないが、
 * 消すと「誰にも減らせない +1」で確実に詰むので、まだ動かせる方を選ぶ。
 */
function definitelyNotApplied(e: unknown): boolean {
    const name = (e as { name?: string }).name ?? "";
    return [
        "ConditionalCheckFailedException",
        "ValidationException",
        "ResourceNotFoundException",
        "AccessDeniedException",
        "SerializationException",
        // 資格情報切れ。Lambda の実行中にも起こりうる（確実に未適用）
        "ExpiredTokenException",
        "UnrecognizedClientException",
        "InvalidSignatureException",
        // スロットリングは SDK が再試行を使い切ってから投げる＝未適用
        "ProvisionedThroughputExceededException",
        "ThrottlingException",
        "RequestLimitExceeded",
    ].includes(name);
}

/**
 * いいね数を読む。**公開されている写真でなければ null。**
 *
 * `likes` だけを見ていたので、**非公開に戻した写真のいいね数が
 * 未認証で読めた**（このルートは公開）。存在と人気度が漏れるうえ、
 * 「不適切な反応が付いたので非公開にする」が効かない。
 *
 * 書き込み側（`likePhoto`）は最初から
 * `attribute_exists(src) AND (attribute_not_exists(published) OR published = true)
 *  AND attribute_not_exists(story)` を条件にしていて、
 * `getComments` も同じ理由で同じ判定を入れてある。**読み取りだけ
 * 素通しだった**ので、そこへ揃える。
 *
 * `published` が無い古い行は公開扱い（一覧・書き込み側と同じ）。
 */
async function readLikeCount(photoId: string): Promise<number | null> {
    const res = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: photoId },
        ProjectionExpression: "likes, src, published, story",
    }));
    const item = res.Item as { likes?: unknown; src?: unknown; published?: unknown; story?: unknown } | undefined;
    if (!item?.src || item.published === false || item.story === true) return null;
    const n = item.likes;
    return typeof n === "number" && n > 0 ? n : 0;
}

// GET /photos/{id}/like — 現在のいいね数（公開）
export const getLikeCount: APIGatewayProxyHandlerV2 = async (event) => {
    const photoId = event.pathParameters?.id;
    if (!photoId) return jsonError(400, "IDが必要です");
    try {
        const likes = await readLikeCount(photoId);
        // **存在も人気度も返さない。** `getComments` と同じ文言・同じ番号に
        // 揃える（「非公開だから断った」と「そもそも無い」を区別させない）
        if (likes === null) return jsonError(404, "写真が見つかりません");
        return {
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "public, s-maxage=30" },
            body: JSON.stringify({ likes }),
        };
    } catch (e) {
        console.error("getLikeCount error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

// GET /user/likes/{id} — 自分がこの写真にいいねしているか（認証必要）
//
// 公開の getLikeCount に混ぜてはいけない。あちらは共有キャッシュに
// 載せている（public, s-maxage=30）ので、利用者ごとに違う liked を
// 入れると他人の状態が配られる。別のエンドポイントに分ける。
//
// なぜ必要か: これまでフロントは「いいね済みか」を端末のお気に入り
// （localStorage）だけで判断していた。未ログインで押した状態のまま
// ログインすると、次の一押しが DELETE になって取り消し扱いになり、
// 投稿者にいいねも通知も届かない。別の端末では逆に、いいね済みの写真が
// 未いいねに見える。サーバーの真値を返す口を用意する。
export const getMyLike: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    const photoId = event.pathParameters?.id;
    if (!userId || !photoId) return jsonError(400, "不正なリクエスト");
    try {
        const res = await ddb.send(new GetCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: markerId(photoId, userId) },
            ProjectionExpression: "id",
        }));
        return {
            statusCode: 200,
            // 利用者ごとの答えなので共有キャッシュには載せない
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            body: JSON.stringify({ liked: !!res.Item }),
        };
    } catch (e) {
        console.error("getMyLike error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

// POST /photos/{id}/like — いいね（認証必要・冪等）
export const likePhoto: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    const photoId = event.pathParameters?.id;
    if (!userId || !photoId) return jsonError(400, "不正なリクエスト");

    try {
        // マーカー作成（既にあれば ConditionalCheckFailed）
        try {
            await ddb.send(new PutCommand({
                TableName: PHOTOS_TABLE,
                Item: { id: markerId(photoId, userId), like: true, photoId, uid: userId, createdAt: new Date().toISOString() },
                ConditionExpression: "attribute_not_exists(id)",
            }));
        } catch (e) {
            if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
                // 既にいいね済み。現在数を返す（冪等）。
                // **公開されていなければ数字を返さない**——ここは条件式を
                // 通らない経路なので、非公開に戻された写真でも来られる
                const cur = await readLikeCount(photoId);
                if (cur === null) return jsonError(404, "写真が見つかりません");
                return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ liked: true, likes: cur }) };
            }
            throw e;
        }

        // 写真カウンタを +1（公開されている写真の場合のみ）。
        // ALL_NEW で写真の属性ごと受け取り、通知用の追加読み取りを省く。
        //
        // 条件で下書き（published:false）とストーリー（story:true）を弾く。
        // 以前は存在チェックだけだったので、IDさえ分かれば非公開の写真に
        // いいねを付けてオーナーに通知を飛ばせた。読み取りを増やさずに済むよう、
        // 判定は既にある ConditionExpression に足している。
        try {
            const res = await ddb.send(new UpdateCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: photoId },
                UpdateExpression: "SET likes = if_not_exists(likes, :z) + :one",
                // attribute_exists(src) が「写真であること」の判定。これが無いと
                // notifs#<相手のsub> や comments#<写真ID> といった内部の文書にも
                // likes 属性を書き込めてしまった（同じテーブルに同居しているため）。
                ConditionExpression:
                    "attribute_exists(id) AND attribute_exists(src) AND (attribute_not_exists(published) OR published = :pub) AND attribute_not_exists(story)",
                ExpressionAttributeValues: { ":z": 0, ":one": 1, ":pub": true },
                ReturnValues: "ALL_NEW",
            }));
            const likes = (res.Attributes?.likes as number | undefined) ?? 1;

            // 投稿者へ「いいねされました」通知（自分の写真は除く）。
            // 初回いいね（マーカー新規作成）の時だけここに到達するので連打では鳴らない
            const photo = res.Attributes as { userId?: string; src?: string; thumbSrc?: string; location?: string } | undefined;
            const owner = photo?.userId ? String(photo.userId) : undefined;
            if (owner && owner !== userId && photo?.src) {
                await pushNotification(owner, {
                    type: "like",
                    photoId,
                    photoSrc: String(photo.thumbSrc ?? photo.src),
                    byName: await lookupDisplayName(userId),
                    byId: userId,
                    ...(photo.location ? { atLocation: photo.location } : {}),
                    t: new Date().toISOString(),
                });
            }

            return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ liked: true, likes }) };
        } catch (e) {
            // カウンタを増やせなかったら、先に書いたマーカーを戻す。
            //
            // ただし戻すのは「増えていないと言い切れる」失敗のときだけ。
            // どんな失敗でも戻していた頃は、タイムアウト（実際には +1 済み
            // かもしれない）でもマーカーを消していたので、本人が取り消しても
            // マーカーが無く `attribute_exists(id)` で弾かれ、
            // **誰にも減らせない +1** が公開の数字に残った。
            // 分からない失敗ではマーカーを残す。直せるとは限らないが、
            // 消すと「誰にも減らせない +1」で確実に詰むので、まだ動かせる方を選ぶ。
            if (definitelyNotApplied(e)) {
                await ddb.send(new DeleteCommand({
                    TableName: PHOTOS_TABLE, Key: { id: markerId(photoId, userId) },
                })).catch(() => { /* 戻せなくてもこれ以上できることは無い */ });
            }
            // 存在しない / 非公開（下書き・ストーリー）
            if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
                return jsonError(404, "写真が見つかりません");
            }
            throw e;
        }
    } catch (e) {
        console.error("likePhoto error:", e);
        return jsonError(500, "いいねに失敗しました");
    }
};

// DELETE /photos/{id}/like — いいね解除（認証必要・冪等）
export const unlikePhoto: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    const photoId = event.pathParameters?.id;
    if (!userId || !photoId) return jsonError(400, "不正なリクエスト");

    try {
        // マーカー削除（無ければ ConditionalCheckFailed → 冪等に現在数を返す）
        try {
            await ddb.send(new DeleteCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: markerId(photoId, userId) },
                ConditionExpression: "attribute_exists(id)",
            }));
        } catch (e) {
            if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
                const cur = await readLikeCount(photoId);
                if (cur === null) return jsonError(404, "写真が見つかりません");
                return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ liked: false, likes: cur }) };
            }
            throw e;
        }

        // カウンタを -1（0未満にはしない）
        try {
            const res = await ddb.send(new UpdateCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: photoId },
                UpdateExpression: "SET likes = likes - :one",
                ConditionExpression: "attribute_exists(id) AND likes > :z",
                ExpressionAttributeValues: { ":z": 0, ":one": 1 },
                ReturnValues: "UPDATED_NEW",
            }));
            const likes = (res.Attributes?.likes as number | undefined) ?? 0;
            return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ liked: false, likes }) };
        } catch (e) {
            // likes が既に0 or 写真なし → 現在数（0）を返す。
            // この場合は「減らすものが無かった」だけなので、マーカーは戻さない。
            if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
                const cur = await readLikeCount(photoId);
                return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ liked: false, likes: cur ?? 0 }) };
            }
            // 減っていないと言い切れる失敗（スロットリング等）ならマーカーを戻す。
            // 戻さないと「マーカーは消えたのにカウンタは減っていない」状態が
            // 残り、公開の数字が実際より大きいままになる。
            //
            // 適用されたか分からない失敗（タイムアウト・応答の取りこぼし）では
            // 戻さない。戻すと画面は「いいね済み」に見えるので、本人が
            // もう一度取り消して**二重に減る**——実際より小さい数字は
            // いいねし直しても直らない（マーカーが既にあると +1 されない）。
            if (definitelyNotApplied(e)) {
                await ddb.send(new PutCommand({
                    TableName: PHOTOS_TABLE,
                    Item: { id: markerId(photoId, userId), like: true, photoId, uid: userId, createdAt: new Date().toISOString() },
                })).catch(() => { /* 戻せなくてもこれ以上できることは無い */ });
            }
            throw e;
        }
    } catch (e) {
        console.error("unlikePhoto error:", e);
        return jsonError(500, "いいね解除に失敗しました");
    }
};
