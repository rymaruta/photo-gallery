import type { APIGatewayProxyHandlerV2, APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { pushNotification, lookupDisplayName } from "./notify";

// 写真コメント。
// ストレージ: "comments#<photoId>" の list ドキュメント（notifs と同型）に
// list_append で追記。写真 item の commentCount を原子加算。
// 単一PKテーブルなので prefix Query は使えず、写真ごとの1ドキュメントに集約する。

export type Comment = {
    id: string;
    uid: string;
    name: string;
    text: string;
    t: string;
};

const COMMENTS_MAX = 200;   // 保持する上限（書き込み時に切り詰め・読み取りもこの数）
/**
 * 1人がひとつの写真に付けられる数の上限。
 *
 * 上限200の輪（古いものから落ちる）なので、1人が200件書けば
 * **その写真の議論を全部消せる**。履歴もどこにも残らない。
 * 200回のリクエストで他人のコメント欄を無に帰せるのは、
 * 会話の場としてもたない。1人あたりを絞れば、この経路は塞がる。
 */
/** 追記が競合したときのやり直し回数（同時投稿はすぐ収まる） */
const COMMENT_APPEND_RETRIES = 3;
const COMMENTS_MAX_PER_USER = 10;
const DELETE_RETRIES = 3;   // 削除の添字がずれたときの読み直し回数
const TEXT_MAX = 500;

const commentsId = (photoId: string) => `comments#${photoId}`;

async function readComments(photoId: string): Promise<Comment[]> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: commentsId(photoId) } }));
    const items = res.Item?.items;
    return Array.isArray(items) ? (items as Comment[]) : [];
}

// GET /photos/{id}/comments — コメント一覧（公開）。新しい順で最大200件
export const getComments: APIGatewayProxyHandlerV2 = async (event) => {
    const photoId = event.pathParameters?.id;
    if (!photoId) return jsonError(400, "IDが必要です");
    try {
        // 写真の状態を先に見る。ここが素通しだったので、
        //   - 非公開に戻した写真のコメントが誰でも読めたまま
        //   - 削除された写真・退会した人の写真のコメントも読めたまま
        // だった。投稿側（postComment）は同じ条件で弾いているのに、
        // 読み取り側だけ何も見ていなかった。
        // 「不適切なコメントが付いたので非公開にする」が効かない状態。
        const photoRes = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: photoId } }));
        const photo = photoRes.Item as { src?: string; published?: boolean; story?: boolean } | undefined;
        if (!photo?.src || photo.published === false || photo.story === true) {
            return jsonError(404, "写真が見つかりません");
        }

        const all = await readComments(photoId);
        const items = all.slice(-COMMENTS_MAX).reverse(); // 末尾追記なので後ろが新しい
        return {
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "public, s-maxage=15" },
            body: JSON.stringify({ items, count: all.length }),
        };
    } catch (e) {
        console.error("getComments error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

// POST /photos/{id}/comments — コメント投稿（認証必要）
export const postComment: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    const photoId = event.pathParameters?.id;
    if (!uid || !photoId) return jsonError(400, "不正なリクエスト");

    let body: { text?: unknown };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return jsonError(400, "不正なリクエスト");
    }
    const text = typeof body.text === "string" ? body.text.trim().slice(0, TEXT_MAX) : "";
    if (!text) return jsonError(400, "コメントを入力してください");

    try {
        // 写真の存在確認（通知先とサムネ取得も兼ねる）
        const photoRes = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: photoId } }));
        const photo = photoRes.Item as {
            src?: string; thumbSrc?: string; userId?: string; location?: string;
            published?: boolean; story?: boolean;
        } | undefined;
        if (!photo || !photo.src) return jsonError(404, "写真が見つかりません");
        // 下書きとストーリーにはコメントさせない。以前は存在チェックだけだったので、
        // IDさえ分かれば非公開の写真にコメントを付けてオーナーに通知を飛ばせた
        // （しかも一覧APIは公開なので、そのコメントは誰でも読めた）。
        if (photo.published === false || photo.story === true) {
            return jsonError(404, "写真が見つかりません");
        }

        // 自分がこの写真に何件書いているか（上限の輪を1人で埋めさせない）。
        // 写真のオーナーは対象外——自分の写真の会話に返信し続けられなくなる
        // （30人にお礼を書くと11人目で止まり、以後は自分のコメントを消すまで
        // 参加できなかった）。オーナーには「議論を流す」動機が無いし、
        // 消したければ写真ごと消せる。
        const isOwner = photo.userId === uid;

        const comment: Comment = {
            id: uuidv4(),
            uid,
            name: await lookupDisplayName(uid),
            text,
            t: new Date().toISOString(),
        };

        // コメントドキュメントへ原子追記。
        // 追記だけだと際限なく伸び、DynamoDB のアイテム上限（400KB）に達した時点で
        // 以後そのフォトには誰もコメントできなくなる（縮む経路が無い）。
        // notify.ts と同じく、溢れたときだけ読み直して切り詰める。
        // **1人あたりの上限は、読みと書きを条件でつなぐ。**
        //
        // 以前は「読んで数える → 無条件に list_append」だったので、
        // 同時に投げれば全部が「既存0件」を読んで全部通った。
        // COMMENTS_MAX(200) のリングは自分のコメントだけで埋まる
        // ——**他人の写真のコメント欄を1回のバーストで全消しできる**。
        // COMMENTS_MAX_PER_USER を入れた理由（「200回のリクエストで他人の
        // コメント欄を無に帰せるのはもたない」）が、並行実行で戻っていた。
        //
        // 仕掛けは下の切り詰めと同じ「読んだときと同じ長さのままなら書く」。
        // 新しい機構は作らない。外れたら読み直してやり直す。
        const appendArgs = (guard?: { len: number }) => ({
            TableName: PHOTOS_TABLE,
            Key: { id: commentsId(photoId) },
            UpdateExpression:
                "SET #items = list_append(if_not_exists(#items, :empty), :new), photoId = :pid, updatedAt = :now",
            // 上限の対象外（オーナー）は条件を付けない。付ける必要が無いうえ、
            // 付けると同時投稿のたびにやり直しが要る。
            ...(guard
                ? {
                    // 文書がまだ無い回もあるので、その形も通す
                    // （userProfile.ts の rev ガードと同じ組み立て方）。
                    ConditionExpression: guard.len === 0
                        ? "attribute_not_exists(#items) OR size(#items) = :len"
                        : "size(#items) = :len",
                }
                : {}),
            ExpressionAttributeNames: { "#items": "items" },
            ExpressionAttributeValues: {
                ":new": [comment], ":empty": [], ":pid": photoId, ":now": comment.t,
                ...(guard ? { ":len": guard.len } : {}),
            },
            ReturnValues: "UPDATED_NEW" as const,
        });

        let appended;
        if (isOwner) {
            appended = await ddb.send(new UpdateCommand(appendArgs()));
        } else {
            for (let attempt = 0; ; attempt++) {
                const existing = await readComments(photoId);
                if (existing.filter((c) => c.uid === uid).length >= COMMENTS_MAX_PER_USER) {
                    return jsonError(429, `同じ写真へのコメントは${COMMENTS_MAX_PER_USER}件までです`);
                }
                try {
                    appended = await ddb.send(new UpdateCommand(appendArgs({ len: existing.length })));
                    break;
                } catch (e) {
                    if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;
                    if (attempt >= COMMENT_APPEND_RETRIES) {
                        // 諦めたことを黙って飲まない（200 を返すと画面には出るのに消える）
                        return jsonError(409, "他の投稿と重なりました。もう一度お試しください");
                    }
                }
            }
        }

        // 上限を超えたら古い方を捨てて COMMENTS_MAX 件だけ残す（末尾が新しい）。
        //
        // 読んでから書き戻すまでの間に別の投稿が入ると、その投稿ごと
        // 消えていた（自分には200が返り画面にも出ているのに、あとで消える）。
        // 「読んだときと同じ長さのままなら書く」条件を付けて、外れたら諦める
        // ——次の投稿がまた切り詰めるので、放っておいて問題ない。
        const stored = appended.Attributes?.items;
        let trimmed = false;
        if (Array.isArray(stored) && stored.length > COMMENTS_MAX) {
            // 印を立てるのは**書けたときだけ**。先に立てていた頃は、
            // 条件が外れて切り詰めが起きなかったのに commentCount を
            // 上限値に書き換えていたので、実際の件数とずれたまま残った
            // （下の「実数に合わせる」が実数でなくなる）。
            await ddb.send(new UpdateCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: commentsId(photoId) },
                UpdateExpression: "SET #items = :trimmed",
                ConditionExpression: "size(#items) = :len",
                ExpressionAttributeNames: { "#items": "items" },
                ExpressionAttributeValues: {
                    ":trimmed": stored.slice(-COMMENTS_MAX),
                    ":len": stored.length,
                },
            })).then(() => { trimmed = true; }).catch((e: { name?: string }) => {
                if (e?.name !== "ConditionalCheckFailedException") throw e;
                // 競合。次の投稿が切り詰める
            });
        }

        // 写真の commentCount を更新する。
        //
        // 切り詰めが起きたときは「+1」ではなく実数（＝上限）に合わせる。
        // 足すだけだったので、上限を超えて捨てた分もカウントに残り、
        // モーダルは「コメント 250件」、個別ページは「200」と**同じ写真に
        // 2つの数字**が出ていた。全部消すと 50件のまま残りもした。
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: photoId },
            ...(trimmed
                ? {
                    UpdateExpression: "SET commentCount = :max",
                    ExpressionAttributeValues: { ":max": COMMENTS_MAX },
                }
                : {
                    UpdateExpression: "SET commentCount = if_not_exists(commentCount, :z) + :one",
                    ExpressionAttributeValues: { ":z": 0, ":one": 1 },
                }),
            ConditionExpression: "attribute_exists(id)",
        })).catch(() => { /* 写真が消えていても本文は保存済み */ });

        // 写真オーナーへ通知（自分の写真は除く）
        const owner = photo.userId ? String(photo.userId) : undefined;
        if (owner && owner !== uid) {
            await pushNotification(owner, {
                type: "comment",
                photoId,
                photoSrc: String(photo.thumbSrc ?? photo.src),
                byName: comment.name,
                byId: uid,
                ...(photo.location ? { atLocation: photo.location } : {}),
                t: comment.t,
            });
        }

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ comment }) };
    } catch (e) {
        console.error("postComment error:", e);
        return jsonError(500, "投稿に失敗しました");
    }
};

// DELETE /photos/{id}/comments/{commentId} — 削除（投稿者本人 or 写真オーナー）
export const deleteComment: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    const photoId = event.pathParameters?.id;
    const commentId = event.pathParameters?.commentId;
    if (!uid || !photoId || !commentId) return jsonError(400, "不正なリクエスト");

    try {
        // 写真オーナー判定
        const photoRes = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: photoId } }));
        const ownerId = photoRes.Item ? String(photoRes.Item.userId ?? photoRes.Item.uploadedBy ?? "") : "";

        // 該当の1要素だけを添字で消す。
        //
        // 以前は「全部読む → 除いて無条件で Put」だった。読んでから書くまでの間に
        // 入った新しいコメントは、書き戻す配列に入っていないので消えていた
        // （投稿者には200が返り、画面にも出ているのに）。
        // 添字指定の REMOVE なら末尾への追記と衝突しない。念のため
        // 「その添字が今も目的のコメントであること」を条件に付け、
        // ずれていたら読み直す。
        let removed = false;
        let gone = false; // 再試行中に他の経路で消えた（結果は同じなので成功扱い）
        for (let attempt = 0; attempt <= DELETE_RETRIES && !removed && !gone; attempt++) {
            const all = await readComments(photoId);
            const index = all.findIndex((c) => c.id === commentId);
            if (index < 0) {
                if (attempt === 0) return jsonError(404, "コメントが見つかりません");
                gone = true;
                break;
            }
            // 投稿者本人 or 写真オーナーのみ
            if (all[index].uid !== uid && ownerId !== uid) return jsonError(403, "権限がありません");

            try {
                await ddb.send(new UpdateCommand({
                    TableName: PHOTOS_TABLE,
                    Key: { id: commentsId(photoId) },
                    UpdateExpression: `REMOVE #items[${index}] SET updatedAt = :now`,
                    ConditionExpression: `#items[${index}].id = :cid`,
                    ExpressionAttributeNames: { "#items": "items" },
                    ExpressionAttributeValues: { ":cid": commentId, ":now": new Date().toISOString() },
                }));
                removed = true;
            } catch (e) {
                if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;
                // 添字がずれた（同時に別のコメントが消えた）。読み直してやり直す
            }
        }
        if (!removed && !gone) return jsonError(409, "混み合っています。もう一度お試しください");
        // 他で消えていた場合は数を動かさない（二重に減らさないため）
        if (gone) return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };

        // commentCount −1（0未満ガード）
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: photoId },
            UpdateExpression: "SET commentCount = commentCount - :one",
            ConditionExpression: "attribute_exists(id) AND commentCount > :z",
            ExpressionAttributeValues: { ":z": 0, ":one": 1 },
        })).catch(() => { /* 0 or 写真消滅は無視 */ });

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };
    } catch (e) {
        console.error("deleteComment error:", e);
        return jsonError(500, "削除に失敗しました");
    }
};
