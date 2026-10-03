import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { PutCommand, DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { updateUserList, readUserList } from "./userList";
import { canViewPhoto } from "./restrictedFeed";
import { isBlocked } from "./blockCheck";
import { isRestrictedRow } from "./sanitize";

// 写真の「保存」（ブックマーク）。あとで見返すための、**自分だけの棚**。
//
// マーカー item の id: "save#<photoId>#<userId>"（いいねの `like#...` に倣う）
//   - 完全キー（id）だけで読み書きするので Query 不要
//   - GSI キー属性 `userId` は付けず `uid` を使う → 写真一覧 GSI を汚さない
//
// ## いいね（`likes.ts`）と**違う**ところ
//
// **公開の数を持たない。** 写真レコードに `saves` のような属性は足さず、
// 誰にも「何人が保存したか」を見せない。理由は2つ:
//
//   1. このサイトの方向性（CLAUDE.md）が「SNS的な競争要素は増やさない」。
//      保存は人に見せる反応ではなく、自分の棚に入れる操作
//   2. **数を持たないと、壊れ方がまるごと1種類消える。** いいねは
//      「マーカー」と「カウンタ」の2つを別々に書くので、片方だけ落ちると
//      食い違う——`likes.ts` の `definitelyNotApplied` は、その食い違いを
//      「戻してよい失敗」と「戻すと詰む失敗」に仕分けるためだけに在る
//      （50行のコメントが付いている）。書き込みが1つなら要らない
//
// **通知も飛ばさない。** 保存したことは投稿者に伝わらない。
//
// ## いいねと**同じ**にするところ
//
//   - 「保存済みか」は**マーカーが決める**。一覧（表示用の索引）からは決めない
//     ——上限（`SAVED_MAX`）で溢れた写真が「未保存」に見え、押すと解除が飛ぶ
//   - 一覧の書き込みが落ちても、**保存そのものは失敗させない**
//   - 非公開（下書き）・ストーリー・不在の写真は弾く

function markerId(photoId: string, userId: string): string {
    return `save#${photoId}#${userId}`;
}

/**
 * 「自分が保存した写真」の一覧（`saves#<uid>`）。
 *
 * **マーカーだけでは一覧を作れない。** このテーブルにソートキーは無いので
 * `save#<写真ID>#<自分>` を前方一致で列挙できず、全表 Scan しか手が無い。
 * `following#<uid>` / `likes#<uid>` と同じ形（新しい順のリスト＋`rev`）で
 * 1行持つ。書き込みの規則は `userList.ts` 1つ——**2つ目を作らない**。
 */
const savesId = (uid: string) => `saves#${uid}`;

/**
 * 一覧に残す上限。**溢れるのは古い方。**
 *
 * ⚠️ 溢れても「保存済みかどうか」は変わらない——判定は**マーカー**
 * （`GET /user/saves/{id}`）が持つ。この一覧から判定すると、溢れた写真の
 * しおりが空に見え、押すと解除が飛ぶ。ここが決めるのは「保存した写真」の
 * ページが何件まで遡れるか だけ。
 */
const SAVED_MAX = 1000;

/** 写真IDの形。uuid を要求せず、長さと文字種だけ見る（古い採番も通す） */
const isPhotoId = (x: string) => x.length > 0 && x.length <= 128 && !x.includes("#");

/**
 * 一覧を書き換える。**投げない**——書けたかどうかを返し、
 * どう受けるかは呼び出し側が決める。
 *
 * 足す側（POST）は**落ちても保存を失敗させない**。保存の本体はマーカー
 * （判定）で、この一覧は表示用の索引。ここで 500 にすると**索引1行のために
 * 保存を落とす**ことになる（`likes.ts` の `noteLiked`・`follow.ts` の
 * `updateFollowersQuietly` が同じ理由で同じ判断をしている）。欠けても、
 * 既に保存済みの POST（冪等経路）で足し直すので、もう一度押せば直る。
 *
 * **外す側（DELETE）には、その出口が無い。** だから `unsavePhoto` は
 * `false` を握りつぶさず、マーカーを戻してから失敗を返す（理由はあちらに）。
 */
async function noteSaved(userId: string, photoId: string, add: boolean): Promise<boolean> {
    try {
        await updateUserList(savesId(userId), userId, SAVED_MAX, (list) => {
            if (add) {
                if (list.includes(photoId)) return null;
                list.unshift(photoId);
                return list;
            }
            const next = list.filter((x) => x !== photoId);
            return next.length === list.length ? null : next;
        });
        return true;
    } catch (e) {
        console.warn(`saves#${userId} の一覧を更新できませんでした:`, e);
        return false;
    }
}

/** マーカーを書く。保存の POST と、解除に失敗したときの巻き戻しで使う */
function putMarker(photoId: string, userId: string) {
    return new PutCommand({
        TableName: PHOTOS_TABLE,
        Item: { id: markerId(photoId, userId), save: true, photoId, uid: userId, createdAt: new Date().toISOString() },
    });
}

/**
 * その写真が**今このサイトに出ていて、この人に見せてよいか**。
 *
 * `likes.ts` の `readLikeCount` と同じ判定（`published` が無い古い行は
 * 公開扱い・ストーリーは対象外・`src` を持たない内部の文書は写真ではない）。
 * いいねは書き込みの `ConditionExpression` に畳み込めるが、保存には
 * 更新するカウンタが無いので、**1回 GetItem して確かめる**。
 *
 * これが無いと、IDさえ分かれば**他人の下書きを保存できる**——本人が
 * 非公開に戻した写真が、保存した人の棚に居座ることになる。
 */
async function isVisiblePhoto(photoId: string, viewerId: string): Promise<boolean> {
    const res = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: photoId },
        ProjectionExpression: "src, published, story, userId, uploadedBy, audience",
    }));
    const item = res.Item as {
        src?: unknown; published?: unknown; story?: unknown; userId?: unknown; uploadedBy?: unknown; audience?: unknown;
    } | undefined;
    if (!item?.src || item.published === false || item.story === true) return false;
    // **公開範囲を絞った写真は、見せてよい相手だけが保存できる**（S-1）。
    // 判定は一覧（`/feed/restricted`）と同じ `canViewPhoto`（ブロックも見る）
    if (isRestrictedRow(item)) return canViewPhoto(item, viewerId);
    // 🔴 **公開の写真も、持ち主にブロックされた人は保存できない**（2026-10-03）。
    // `canViewPhoto` は公開の写真ではブロックを見ずに通すので、ここで見る。
    // 判定はコメントの投稿・いいねと同じ「持ち主がこの人をブロックしているか」。
    // 所有者は `userId ?? uploadedBy`（古い行は `uploadedBy` だけ・`likes.ts` と同じ）
    const ownerRaw = item.userId ?? item.uploadedBy;
    const owner = typeof ownerRaw === "string" ? ownerRaw : undefined;
    if (owner && owner !== viewerId && await isBlocked(owner, viewerId)) return false;
    return true;
}

/** マーカーが在るか（＝保存済みか）。判定はここ1つ */
async function hasMarker(photoId: string, userId: string): Promise<boolean> {
    const res = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: markerId(photoId, userId) },
        ProjectionExpression: "id",
    }));
    return !!res.Item;
}

/**
 * GET /user/saves — 自分が保存した写真のID一覧（新しい順）。
 *
 * **返すのは ID だけ。** 写真の中身は画面が既に持っている一覧から引く
 * （ここで写真を引くと、1000件の保存に対して GetItem が1000回になる）。
 * 非公開になった写真のIDも混ざりうるが、画面側の一覧に居ないので出ない。
 */
export const getMySaves: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(400, "不正なリクエスト");
    try {
        const photoIds = await readUserList(savesId(userId), isPhotoId, `saves#${userId}`);
        return {
            statusCode: 200,
            // 利用者ごとの答えなので共有キャッシュには載せない
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            body: JSON.stringify({ photoIds }),
        };
    } catch (e) {
        console.error("getMySaves error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

// GET /user/saves/{id} — 自分がこの写真を保存しているか（認証必要）
//
// **公開の口は作らない。** 保存は人に見せない操作なので、
// いいねの `getLikeCount`（誰でも読める数）に当たるものが無い。
export const getMySave: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    const photoId = event.pathParameters?.id;
    if (!userId || !photoId) return jsonError(400, "不正なリクエスト");
    try {
        return {
            statusCode: 200,
            // 利用者ごとの答えなので共有キャッシュには載せない
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            body: JSON.stringify({ saved: await hasMarker(photoId, userId) }),
        };
    } catch (e) {
        console.error("getMySave error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

// POST /photos/{id}/save — 保存（認証必要・冪等）
export const savePhoto: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    const photoId = event.pathParameters?.id;
    if (!userId || !photoId) return jsonError(400, "不正なリクエスト");

    try {
        if (!await isVisiblePhoto(photoId, userId)) {
            // **「もう見えない」ことと「あなたの保存は残っている」ことを
            // 分けて伝える。** マーカーが在るのに素の 404 を返すと、画面は
            // 「保存できなかった」と読んで未保存に戻す——サーバーには
            // マーカーがあるので、**開いている間、解除の導線が出ない**
            // （解除の DELETE 自体は通るのに、未保存表示では押しようがない）。
            // `likes.ts` が同じ形で `liked: true` を添えている。
            const saved = await hasMarker(photoId, userId);
            return {
                statusCode: 404,
                headers: JSON_HEADERS,
                body: JSON.stringify({ error: "写真が見つかりません", ...(saved ? { saved: true } : {}) }),
            };
        }

        // **条件を付けない Put。** いいねは「初回だけ通知を鳴らす」ために
        // `attribute_not_exists(id)` で初回を見分けるが、保存は通知も
        // カウンタも持たないので**見分ける必要が無い**。上書きしても
        // 変わるのは `createdAt` だけで、並び順は一覧（`saves#<uid>`）が
        // 持っている——`noteSaved` は既に在れば書かないので順番も動かない。
        await ddb.send(putMarker(photoId, userId));

        // **ここで足し直す。** 一覧の書き込みだけ落ちた回の出口
        // （マーカーは在るので、状態のずれた端末から押すと通る）。
        // **落ちても保存は成功**——索引1行のために保存を落とさない
        await noteSaved(userId, photoId, true);

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ saved: true }) };
    } catch (e) {
        console.error("savePhoto error:", e);
        return jsonError(500, "保存に失敗しました");
    }
};

// DELETE /photos/{id}/save — 保存の解除（認証必要・冪等）
export const unsavePhoto: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    const photoId = event.pathParameters?.id;
    if (!userId || !photoId) return jsonError(400, "不正なリクエスト");

    try {
        // **公開状態は見ない。** 見てしまうと、非公開に戻された写真を
        // 保存した人が**自分の棚から永久に外せなくなる**（`likes.ts` の
        // 減算が公開判定を条件に足していないのと同じ理由）。
        // 条件も付けない——無ければ何も起きないので、そのまま冪等。
        await ddb.send(new DeleteCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: markerId(photoId, userId) },
        }));

        // 一覧からも外す。**マーカーを消したあと**に置く——先に外すと、
        // 消し損ねた回に「保存は残っているのに棚から消える」状態になる。
        //
        // **ここは握りつぶせない。** 足す側には「押し直せば足し直す」
        // 冪等経路があるが、外す側にその出口は無い——棚には残り、マーカーは
        // 無いので `GET /user/saves/{id}` は「未保存」と答える。画面は
        // しおりを空で描き、押すと**解除ではなく保存**が飛ぶので、
        // **棚から外す手段が画面から消える**。
        //
        // だからマーカーを戻し、**両方「保存済み」に揃えたうえで**失敗を返す。
        // もう一度押せばやり直せる（一覧の書き換えは何度当てても同じ結果に
        // なるので、いいねのカウンタのように「二重に効く」心配が無い）。
        if (!await noteSaved(userId, photoId, false)) {
            await ddb.send(putMarker(photoId, userId))
                .catch((e) => { console.error(`save#${photoId}#${userId} を戻せませんでした:`, e); });
            return jsonError(500, "保存の解除に失敗しました");
        }

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ saved: false }) };
    } catch (e) {
        console.error("unsavePhoto error:", e);
        return jsonError(500, "保存の解除に失敗しました");
    }
};
