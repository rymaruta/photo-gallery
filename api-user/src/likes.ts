import type { APIGatewayProxyHandlerV2, APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { PutCommand, DeleteCommand, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { pushNotification, lookupDisplayName } from "./notify";
import { updateUserList, readUserList } from "./userList";
import { canViewPhoto } from "./restrictedFeed";
import { isRestrictedRow } from "./sanitize";
import { isBlocked } from "./blockCheck";

// いいねはアグリゲート数を写真レコードの `likes` 属性に持ち、
// 二重カウント防止のために「誰がいいねしたか」をマーカー item で記録する。
//
// マーカー item の id: "like#<photoId>#<userId>"
//   - 完全キー（id）だけで読み書きするので Query 不要
//   - GSI キー属性 `userId` は付けず `uid` を使う → 写真一覧 GSI を汚さない

function markerId(photoId: string, userId: string): string {
    return `like#${photoId}#${userId}`;
}

// 「自分がいいねした写真」の一覧（`likes#<uid>`）。
//
// **マーカーだけでは一覧を作れない。** このテーブルにソートキーは無いので
// `like#<写真ID>#<自分>` を前方一致で列挙できず、全表 Scan しか手が無い。
// `following#<uid>` と同じ形（新しい順のリスト＋`rev`）で1行持つ。
//
// 無かった頃は「いいねした写真」のページが**この端末の localStorage しか
// 見ておらず**、スマホで押して PC で開くと0件だった（写真ページは
// マーカーを見るので「いいね済み」と出る＝同じアカウントで食い違う）。
const likesId = (uid: string) => `likes#${uid}`;

/**
 * 一覧に残す上限。**溢れるのは古い方。**
 *
 * ⚠️ 溢れても「いいね済みかどうか」は変わらない——判定は**マーカー**
 * （`GET /user/likes/{id}`）が持つ。この一覧から判定すると、溢れた写真の
 * ハートが空に見え、押すと解除が飛ぶ（`LIM-1` と同じ壊れ方）。
 * ここが決めるのは「いいねした写真」のページが何件まで遡れるか だけ。
 */
const LIKED_MAX = 1000;

/** 写真IDの形。uuid を要求せず、長さと文字種だけ見る（古い採番も通す） */
const isPhotoId = (x: string) => x.length > 0 && x.length <= 128 && !x.includes("#");

/**
 * 一覧を書き換える。**失敗しても、いいねそのものは失敗させない。**
 *
 * いいねの本体はマーカー（判定）と `likes` 属性（公開の数）と通知で、
 * この一覧は表示用の索引。ここで 500 にすると**索引1行のために
 * 通知ごといいねを落とす**ことになる（`follow.ts` の
 * `updateFollowersQuietly` が同じ理由で同じ判断をしている）。
 *
 * 欠けたときの出口は2つ: 押した端末では localStorage に残るので
 * その端末の一覧には出る／既にいいね済みの POST（冪等経路）でも
 * 足し直すので、状態がずれた端末から押すと直る。
 */
async function noteLiked(userId: string, photoId: string, add: boolean): Promise<void> {
    try {
        await updateUserList(likesId(userId), userId, LIKED_MAX, (list) => {
            if (add) {
                if (list.includes(photoId)) return null;
                list.unshift(photoId);
                return list;
            }
            const next = list.filter((x) => x !== photoId);
            return next.length === list.length ? null : next;
        });
    } catch (e) {
        console.warn(`likes#${userId} の一覧を更新できませんでした（いいね自体は成功）:`, e);
    }
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
async function readLikeCount(photoId: string, viewerId?: string): Promise<number | null> {
    const res = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: photoId },
        ProjectionExpression: "likes, src, published, story, userId, audience",
    }));
    const item = res.Item as {
        likes?: unknown; src?: unknown; published?: unknown; story?: unknown; userId?: unknown; audience?: unknown;
    } | undefined;
    if (!item?.src || item.published === false || item.story === true) return null;
    // **公開範囲を絞った写真は、見せてよい相手にだけ数を返す**（S-1）。
    // 未認証の `getLikeCount` は閲覧者が分からないので、絞った写真は一律 null
    if (!await canViewPhoto(item, viewerId)) return null;
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

// GET /user/likes/{id} — 自分がこの写真にいいねしているか（認証必要）。
// 応答は `{ liked: boolean, count?: number }`。`count` は写真を見てよい相手のときだけ（S-1）
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
/**
 * GET /user/likes — 自分がいいねした写真のID一覧（新しい順）。
 *
 * 「いいねした写真」のページはこれまで**この端末の localStorage しか
 * 見ていなかった**ので、別の端末で押したぶんは0件に見えた
 * （同じ写真のページは「いいね済み」と出るので、同じアカウントで食い違う）。
 *
 * **返すのは ID だけ。** 写真の中身は画面が既に持っている一覧から引く
 * （ここで写真を引くと、1000件のいいねに対して GetItem が1000回になる）。
 * 非公開になった写真のIDも混ざりうるが、画面側の一覧に居ないので出ない。
 */
export const getMyLikes: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(400, "不正なリクエスト");
    try {
        const photoIds = await readUserList(likesId(userId), isPhotoId, `likes#${userId}`);
        return {
            statusCode: 200,
            // 利用者ごとの答えなので共有キャッシュには載せない
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            body: JSON.stringify({ photoIds }),
        };
    } catch (e) {
        console.error("getMyLikes error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

export const getMyLike: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    const photoId = event.pathParameters?.id;
    if (!userId || !photoId) return jsonError(400, "不正なリクエスト");
    try {
        const [res, count] = await Promise.all([
            ddb.send(new GetCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: markerId(photoId, userId) },
                ProjectionExpression: "id",
            })),
            // **いいね数も、見せてよい相手にだけ一緒に返す**（S-1）。
            // 公開範囲を絞った写真では未認証の `GET /photos/{id}/like` が 404 に
            // なるので、フォロワーが数を見る道がここしか無い（新しい道は増やさない）。
            // 読めなかったら数を出さない側に倒す——`liked` は本人の状態なので
            // 数の読み取りの失敗で巻き添えにしない
            readLikeCount(photoId, userId).catch((e: unknown) => {
                console.error("getMyLike: いいね数を読めませんでした:", e);
                return null;
            }),
        ]);
        return {
            statusCode: 200,
            // 利用者ごとの答えなので共有キャッシュには載せない
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            // 見せない相手（絞った写真で判定を通らない・下書き・ストーリー・不在）には
            // **`count` を含めない**。404 にはしない——`liked` は見えなくなった写真でも
            // 本人が解除の導線を出すのに要る（`likePhoto` の 404 + `liked: true` と同じ考え）
            body: JSON.stringify({ liked: !!res.Item, ...(count === null ? {} : { count }) }),
        };
    } catch (e) {
        console.error("getMyLike error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

/**
 * 写真の `likes` を +1 する条件つき更新の引数。
 *
 * attribute_exists(src) が「写真であること」の判定。これが無いと
 * notifs#<相手のsub> や comments#<写真ID> といった内部の文書にも
 * likes 属性を書き込めてしまった（同じテーブルに同居しているため）。
 *
 * **公開範囲（`audience`）も条件に入れる**（S-1）。
 *   - `audience` 未指定 … 公開の写真だけ通す（今までの経路。読み取りは増えない）
 *   - `audience` 指定   … 読んだときと同じ公開範囲のままなら通す。
 *     判定（フォロー・親しい友達）は条件式に書けないので、呼び手が
 *     `canViewPhoto` で確かめてから、**その間に変わっていないこと**だけをここで見る
 */
function incrementArgs(photoId: string, audience?: string) {
    return {
        TableName: PHOTOS_TABLE,
        Key: { id: photoId },
        UpdateExpression: "SET likes = if_not_exists(likes, :z) + :one",
        ConditionExpression:
            "attribute_exists(id) AND attribute_exists(src) AND (attribute_not_exists(published) OR published = :pub) AND attribute_not_exists(story)"
            + (audience === undefined
                ? " AND (attribute_not_exists(audience) OR audience = :noAud)"
                : " AND audience = :aud"),
        ExpressionAttributeValues: {
            ":z": 0, ":one": 1, ":pub": true,
            ...(audience === undefined ? { ":noAud": "" } : { ":aud": audience }),
        },
        ReturnValues: "ALL_NEW" as const,
    };
}

/**
 * いいね数を +1。**公開の写真は今までどおり1回の更新**で済ませ、
 * 条件に外れたときだけ写真を読み、**公開範囲を絞った写真で、見せてよい相手なら**
 * 公開範囲つきの条件でやり直す。
 *
 * 見せてはいけない（下書き・ストーリー・不在・見せない相手）なら、
 * 最初の `ConditionalCheckFailedException` をそのまま投げる——呼び手は
 * それを「戻してよい失敗」としてマーカーを消し、404 を返す（今までと同じ道）。
 */
async function incrementLikes(photoId: string, viewerId: string) {
    try {
        return await ddb.send(new UpdateCommand(incrementArgs(photoId)));
    } catch (e) {
        if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;
        const got = await ddb.send(new GetCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: photoId },
            ProjectionExpression: "src, published, story, userId, audience",
        }));
        const photo = got?.Item as {
            src?: unknown; published?: unknown; story?: unknown; userId?: unknown; audience?: unknown;
        } | undefined;
        const live = !!photo?.src && photo.published !== false && photo.story !== true;
        if (!live || !isRestrictedRow(photo) || typeof photo.audience !== "string"
            || !await canViewPhoto(photo, viewerId)) {
            throw e;
        }
        return await ddb.send(new UpdateCommand(incrementArgs(photoId, photo.audience)));
    }
}

/**
 * 付けたばかりのいいねを戻す（ブロックされた人の回・`likePhoto`）。
 *
 * 数は 0 を下回らない条件で −1、印は消す。**戻せなくても投げない**——
 * 数が1つ多く残るだけで、押した人には 404 が返り、通知も一覧も足さない
 */
async function undoLike(photoId: string, userId: string): Promise<void> {
    await ddb.send(new UpdateCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: photoId },
        UpdateExpression: "SET likes = likes - :one",
        ConditionExpression: "attribute_exists(likes) AND likes > :z",
        ExpressionAttributeValues: { ":one": 1, ":z": 0 },
    })).catch((e) => { console.error("undoLike decrement:", e); });
    await ddb.send(new DeleteCommand({
        TableName: PHOTOS_TABLE, Key: { id: markerId(photoId, userId) },
    })).catch((e) => { console.error("undoLike marker:", e); });
}

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
                // **ここで足し直す。** 一覧の書き込みだけ落ちた回の出口
                // （マーカーは在るので、状態のずれた端末から押すと通る）
                await noteLiked(userId, photoId, true);
                const cur = await readLikeCount(photoId, userId);
                if (cur === null) {
                    // **「もう見えない」ことと「あなたのいいねは残っている」ことを
                    // 分けて伝える。** ここに来るのはマーカーが**既にある**
                    // 経路なので、数字は出せなくても状態は分かる。
                    // 伝えないと、クライアントは「付かなかった」と読んで
                    // 画面を未いいねに戻す——サーバーにはマーカーがあるので、
                    // 押し直しても同じ 404 で**永久に外せなくなる**
                    // （解除の DELETE は通るのに、画面がその導線を出さない）。
                    return {
                        statusCode: 404,
                        headers: JSON_HEADERS,
                        body: JSON.stringify({ error: "写真が見つかりません", liked: true }),
                    };
                }
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
            const res = await incrementLikes(photoId, userId);
            const likes = (res.Attributes?.likes as number | undefined) ?? 1;
            const photo = res.Attributes as { userId?: string; uploadedBy?: string; src?: string; thumbSrc?: string; location?: string } | undefined;

            // 🔴 **持ち主にブロックされた人のいいねは戻して 404**（2026-10-03）。
            // 公開範囲を絞った写真は `canViewPhoto` がブロックを見るが、公開の写真は
            // 写真を読まずに1回の更新で通すので、**ブロックされた人も数を増やせた**
            // （通知だけは `notify.ts` で止まっていた）。コメントの投稿（`comments.ts`）と
            // 同じく「持ち主がこの人をブロックしているか」を見て、同じ 404 を返す。
            // 判定は更新の**後**——前に置くと持ち主を知るために写真を読む1回が
            // 全員のいいねに増える。ここで増えるのは印の GetItem 1回だけ
            const blockOwnerRaw = photo?.userId ?? photo?.uploadedBy;
            const blockOwner = blockOwnerRaw ? String(blockOwnerRaw) : undefined;
            //
            // 🔴 **判定の読みが失敗しても、下の catch に落とさない。** 数はもう +1 済みなので、
            // catch がスロットリングなどを「確実に未適用」と見て印だけ消すと、
            // **誰にも減らせない +1** が残る。読めなければ閉じる（通さない）——
            // いいねを戻して 500 を返し、押し直してもらう
            if (blockOwner && blockOwner !== userId) {
                let blocked: boolean;
                try {
                    blocked = await isBlocked(blockOwner, userId);
                } catch (e) {
                    console.error("likePhoto isBlocked:", e);
                    await undoLike(photoId, userId);
                    return jsonError(500, "いいねできませんでした。もう一度お試しください");
                }
                if (blocked) {
                    await undoLike(photoId, userId);
                    return jsonError(404, "写真が見つかりません");
                }
            }

            // 「自分がいいねした写真」の一覧に足す（表示用の索引）
            await noteLiked(userId, photoId, true);

            // 投稿者へ「いいねされました」通知（自分の写真は除く）。
            // 初回いいね（マーカー新規作成）の時だけここに到達するので連打では鳴らない
            // **所有者は `userId ?? uploadedBy`。** `userId` が入る前に保存された
            // 古い行は `uploadedBy` しか持たない（`ddb-photos.ts:75` ほかが
            // 前提にしている形）。ここだけ `userId` 単独だったので、
            // **古い写真にいいねされても投稿者のベルに何も来ない**
            // ——成功が返るので押した側も気づけない。`comments.ts:169` が
            // 同じ見落としを直したときのコメントを、200行下で繰り返していた。
            //
            // **`ReturnValues: "ALL_NEW"` は射影の影響を受けない**ので
            // `uploadedBy` は普通に返る。ここを `ProjectionExpression` 付きの
            // 読みに変えると静かに落ちる（`isDeletedProfile` の docstring と同じ罠）。
            const ownerRaw = photo?.userId ?? photo?.uploadedBy;
            const owner = ownerRaw ? String(ownerRaw) : undefined;
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
                const cur = await readLikeCount(photoId, userId);
                if (cur === null) return jsonError(404, "写真が見つかりません");
                return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ liked: false, likes: cur }) };
            }
            throw e;
        }

        // 一覧からも外す。**マーカーを消せたあと**に置く——消せていない回
        // （冪等経路）で外すと、いいねは残っているのにページから消える
        await noteLiked(userId, photoId, false);

        // カウンタを -1（0未満にはしない）
        try {
            const res = await ddb.send(new UpdateCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: photoId },
                UpdateExpression: "SET likes = likes - :one",
                ConditionExpression: "attribute_exists(id) AND likes > :z",
                ExpressionAttributeValues: { ":z": 0, ":one": 1 },
                // **`ALL_NEW` にして公開状態も一緒に受け取る。**
                // 減算そのものは条件に公開判定を足さない——足すと、非公開に
                // なった写真のいいねを**本人が永久に取り消せなくなる**。
                // 減らしはするが、**数字は返さない**のが正しい形。
                // 追加の読み取りを増やさずに済むので `ALL_NEW`。
                ReturnValues: "ALL_NEW",
            }));
            const after = res.Attributes as {
                likes?: unknown; src?: unknown; published?: unknown; story?: unknown; userId?: unknown; audience?: unknown;
            } | undefined;
            // ここだけ素通しだったので、DELETE の応答が経路で 404 / 200 / 200(実数)
            // の3通りに割れていた。すぐ上の冪等経路と揃える
            if (!after?.src || after.published === false || after.story === true) {
                return jsonError(404, "写真が見つかりません");
            }
            // 解除そのものは通す（見えなくなった写真のいいねも本人が外せるように）。
            // **数だけは、見せてよい相手にしか返さない**（S-1・`readLikeCount` と同じ）
            if (!await canViewPhoto(after, userId)) return jsonError(404, "写真が見つかりません");
            const likes = (after.likes as number | undefined) ?? 0;
            return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ liked: false, likes }) };
        } catch (e) {
            // likes が既に0 or 写真なし → 現在数（0）を返す。
            // この場合は「減らすものが無かった」だけなので、マーカーは戻さない。
            if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
                const cur = await readLikeCount(photoId, userId);
                // 非公開・写真でない → 数字を返さない（上の経路と揃える）
                if (cur === null) return jsonError(404, "写真が見つかりません");
                return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ liked: false, likes: cur }) };
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
                // マーカーを戻したなら一覧も戻す（片方だけ戻すと、
                // いいね済みなのにページに出ない状態が残る）
                await noteLiked(userId, photoId, true);
            }
            throw e;
        }
    } catch (e) {
        console.error("unlikePhoto error:", e);
        return jsonError(500, "いいね解除に失敗しました");
    }
};
