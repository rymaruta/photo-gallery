import type { APIGatewayProxyHandlerV2, APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { pushNotification, lookupDisplayName, deletedUserIds, DELETED_USER_NAME } from "./notify";
import { truncate } from "./sanitize";
import { isBlocked } from "./blockCheck";

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
const COMMENTS_MAX_PER_USER = 10;
/** 追記が競合したときのやり直し回数（同時投稿はすぐ収まる） */
const COMMENT_APPEND_RETRIES = 3;
const DELETE_RETRIES = 3;   // 削除の添字がずれたときの読み直し回数
const TEXT_MAX = 500;
/**
 * `comments#<photoId>` の item に許すバイト数。
 *
 * **件数だけでは DynamoDB の 400KB を守れない。** 上限は
 * `COMMENTS_MAX`(200) × `TEXT_MAX`(500) × 表示名(100) で、日本語は
 * 1文字3バイトなので 200 × (1500 + 300 + id/uid/日時 ≈ 150) ≈ 390KB
 * ——**余裕が数%しかない**。しかも切り詰めは追記の**あと**に走るので、
 * 超えた瞬間の `UpdateCommand` が `ValidationException` で落ち、
 * **その写真には以後1件もコメントできなくなる**（誰かが消すまで、
 * 毎回500が返る）。件数の上限は「古いものから落ちる」と言っているのに、
 * 実際には「新しいものが入らない」に化ける。
 *
 * そこで**追記の前に**バイト数で見て、入らなければ古い方から落とす。
 * 350KB は 400KB に対して 50KB の余白（id・photoId・updatedAt と、
 * DynamoDB が属性名ぶんに使う分）。
 */
const ITEM_BUDGET_BYTES = 350 * 1024;

/**
 * `next` を足しても収まるように、**古い方から**落とす件数を返す。
 * 落とす必要が無ければ 0。
 */
export function overBudgetCount(existing: readonly Comment[], next: Comment): number {
    const size = (arr: readonly Comment[]) => Buffer.byteLength(JSON.stringify(arr), "utf8");
    let drop = 0;
    while (drop < existing.length && size([...existing.slice(drop), next]) > ITEM_BUDGET_BYTES) drop++;
    return drop;
}

const commentsId = (photoId: string) => `comments#${photoId}`;

async function readComments(photoId: string, consistent = false): Promise<Comment[]> {
    // やり直しのときだけ強整合で読む。既定の結果整合だと、競合した直後の
    // 読み直しが**競合前の状態**を返し、同じ長さでまた条件が外れる
    // （待ち時間ゼロで即読み直すので当たりやすい）。上限の健全性は条件式が
    // 守るので壊れないが、正規の利用者に 409 が出やすくなる。
    const res = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: commentsId(photoId) },
        ...(consistent ? { ConsistentRead: true } : {}),
    }));
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

        // **退会した人の名前は出さない。**
        // このAPIは未認証で読めるのに、投稿者の生死を見ていなかったので、
        // 退会したあとも本文と**表示名**が誰でも読めるまま残っていた。
        // 退会でプロフィールは墓石になるのに、コメントだけ取り残される形。
        // account.ts が「各写真に散在する自分のコメント」をスコープ外と
        // 明記している（per-user インデックスが無く全 Scan が要る）ので、
        // 掃除役は別枠。読むときに伏せるのが当座の手。
        //
        // uid は伏せない——`/users/<sub>` は公開ルートで photos.json にも
        // 載るので、sub は秘密ではない（userProfile.ts のコメント参照）。
        // 画面側は `deleted` を見てプロフィールへの導線を出さない。
        // コメントが無ければ引きに行かない
        const gone = items.length === 0 ? new Set<string>() : await deletedUserIds();
        const safeItems = gone.size === 0
            ? items
            : items.map((c) => (gone.has(c.uid)
                ? { ...c, name: DELETED_USER_NAME, deleted: true }
                : c));
        return {
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "public, s-maxage=15" },
            body: JSON.stringify({ items: safeItems, count: all.length }),
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
    const text = typeof body.text === "string" ? truncate(body.text.trim(), TEXT_MAX) : "";
    if (!text) return jsonError(400, "コメントを入力してください");

    try {
        // 写真の存在確認（通知先とサムネ取得も兼ねる）
        const photoRes = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: photoId } }));
        const photo = photoRes.Item as {
            src?: string; thumbSrc?: string; userId?: string; uploadedBy?: string; location?: string;
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
        // 所有者は `userId ?? uploadedBy` で見る。**ここだけフォールバックが
        // 無かった。** photoUpdate.ts の2か所と deleteComment は持っていて、
        // 「userId が無い写真は uploadedBy で判定する」専用テストまである。
        // 無いと、`uploadedBy` しか持たない古い写真の**本人が11件目で 429**に
        // なる——免除を入れた理由（30人にお礼を書くと途中で止まる）そのもの。
        const photoOwner = photo.userId ?? photo.uploadedBy;
        // **ブロックされていたら書けない。** 通知は `pushNotification` が
        // 止めるが、コメントの**本文は公開**で誰でも読める（500字）。
        // 通知だけ止めても、相手の写真に自分の言葉が残り続ける。
        // **404 で返す**——「ブロックされています」と言うと相手の操作を教える
        if (photoOwner && photoOwner !== uid && await isBlocked(String(photoOwner), uid)) {
            return jsonError(404, "写真が見つかりません");
        }
        const isOwner = photoOwner === uid;

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
            // 条件は**オーナーにも付ける**。一度は「上限の対象外だから要らない」と
            // して外していたが、この条件は上限のためだけのものではない——
            // 下の「前回の追記が通っていたら、もう足さない」を成立させるのが
            // この条件で、外すとオーナーの分岐だけ再送で2件入った
            // （同じファイルが説明している壊れ方が、そこだけ生きていた）。
            // 同時投稿でやり直しが増えるのは事実だが、それは回数の話で、
            // 上限を免除する話とは別。
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

        let appended: Awaited<ReturnType<typeof ddb.send>> | undefined;
        // 追記後の姿。応答を取り逃した回は、読み直した一覧がそれにあたる。
        let storedItems: unknown;
        // バイト超過で落としたときの**実数**。落とした分は「+1」では
        // 表せない（下の commentCount を見よ）
        let exactCount: number | undefined;
        {
            for (let attempt = 0; ; attempt++) {
                const existing = await readComments(photoId, attempt > 0);
                // **前回の追記が通っていたら、もう足さない。**
                // 追記がサーバー側では成功したのに応答が失われると、SDK が自前で
                // 再送し（既定 maxAttempts=3）、再送は条件に外れて
                // ConditionalCheckFailedException としてこちらに返る。気づかずに
                // やり直すと**同じ id のコメントが2件入る**（deleteComment は
                // findIndex で先頭1件しか消さないので、消すのに2回要る）。
                // comment を ループの外で1回だけ作っているので、id で見分けられる。
                if (existing.some((c) => c.id === comment.id)) {
                    storedItems = existing;
                    break;
                }
                // **免除するのは上限だけ。** オーナーは自分の写真に何件でも
                // 返信できてよいが、それと「再送で2件入らないこと」は別の話
                if (!isOwner && existing.filter((c) => c.uid === uid).length >= COMMENTS_MAX_PER_USER) {
                    return jsonError(429, `同じ写真へのコメントは${COMMENTS_MAX_PER_USER}件までです`);
                }
                // **入るかどうかを、足す前に見る。** 超えた状態で
                // `list_append` を投げると `ValidationException` になり、
                // その写真は以後コメントを1件も受け付けなくなる（下の
                // 切り詰めは追記のあとにしか走らない）。落とすのは古い方
                // ——件数の上限と同じ向き。
                //
                // **落とすのと足すのは1回の書き込みでやる。** 別々にすると、
                // 切り詰めだけ成功して追記が競合し続けたときに
                // 「他人のコメントを数件消して、自分のは入らないまま 409」
                // になる（この下の件数の切り詰めが「書けたときだけ印を立てる」
                // 形になっているのと同じ理由）。
                const drop = overBudgetCount(existing, comment);
                if (drop > 0) {
                    const kept = [...existing.slice(drop), comment];
                    try {
                        await ddb.send(new UpdateCommand({
                            TableName: PHOTOS_TABLE,
                            Key: { id: commentsId(photoId) },
                            UpdateExpression: "SET #items = :kept, photoId = :pid, updatedAt = :now",
                            ConditionExpression: "size(#items) = :len",
                            ExpressionAttributeNames: { "#items": "items" },
                            ExpressionAttributeValues: {
                                ":kept": kept, ":len": existing.length, ":pid": photoId, ":now": comment.t,
                            },
                        }));
                        storedItems = kept;
                        // 捨てたぶんを件数に反映する。**「+1」で済ませると、
                        // バイト超過で落とした分がカウントに残り続ける**
                        // ——しかも落とした結果 `COMMENTS_MAX` に届かなく
                        // なるので、下の「実数に合わせる」経路も走らない。
                        // 同じ写真に2つの数字が出る、この関数が一度潰した
                        // 壊れ方に戻る。
                        exactCount = kept.length;
                        break;
                    } catch (e) {
                        if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;
                        if (attempt >= COMMENT_APPEND_RETRIES) {
                            return jsonError(409, "他の投稿と重なりました。もう一度お試しください");
                        }
                        await new Promise((r) => setTimeout(r, 10 * 2 ** attempt + Math.random() * 10));
                        continue;
                    }
                }
                try {
                    appended = await ddb.send(new UpdateCommand(appendArgs({ len: existing.length })));
                    storedItems = appended.Attributes?.items;
                    break;
                } catch (e) {
                    if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;
                    if (attempt >= COMMENT_APPEND_RETRIES) {
                        // 諦めたことを黙って飲まない（200 を返すと画面には出るのに消える）
                        return jsonError(409, "他の投稿と重なりました。もう一度お試しください");
                    }
                    // **少し待つ。ばらつきを入れる。**
                    // 待ちが無いと、混んだ瞬間に負けた全員が同じミリ秒で
                    // 撃ち直して衝突が持続する。オーナーもこの経路を通るように
                    // なった（以前は無条件で必ず成功していた）ので、その分
                    // ここが効く場面が増えている。待つのは 10〜20 / 20〜30 /
                    // 40〜50ms で、最悪でも合計 100ms（postComment の6秒枠の 1.7%）。
                    await new Promise((r) => setTimeout(r, 10 * 2 ** attempt + Math.random() * 10));
                }
            }
        }

        // 上限を超えたら古い方を捨てて COMMENTS_MAX 件だけ残す（末尾が新しい）。
        //
        // 読んでから書き戻すまでの間に別の投稿が入ると、その投稿ごと
        // 消えていた（自分には200が返り画面にも出ているのに、あとで消える）。
        // 「読んだときと同じ長さのままなら書く」条件を付けて、外れたら諦める
        // ——次の投稿がまた切り詰めるので、放っておいて問題ない。
        const stored = storedItems;
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
                : exactCount !== undefined
                ? {
                    // バイト超過で落とした回。落とした分を残すと、
                    // モーダルと写真ページで**同じ写真に2つの数字**が出る
                    UpdateExpression: "SET commentCount = :n",
                    ExpressionAttributeValues: { ":n": exactCount },
                }
                : {
                    UpdateExpression: "SET commentCount = if_not_exists(commentCount, :z) + :one",
                    ExpressionAttributeValues: { ":z": 0, ":one": 1 },
                }),
            ConditionExpression: "attribute_exists(id)",
        })).catch(() => { /* 写真が消えていても本文は保存済み */ });

        // 写真オーナーへ通知（自分の写真は除く）。
        // **`userId ?? uploadedBy`**——:169 が同じ見落としを直しているのに、
        // ここだけ `userId` 単独で残っていた（古い写真にコメントしても
        // 投稿者のベルに何も来ない。本文は普通に出るので誰も気づけない）
        const ownerRaw = photo.userId ?? photo.uploadedBy;
        const owner = ownerRaw ? String(ownerRaw) : undefined;
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
