import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { updateUserList, readUserList, UserListError } from "./userList";

/**
 * 「行きたい場所」——**撮影スポット**（`/location/<スラッグ>`）を保存する口。
 *
 * ## 写真の「保存」とは別物
 *
 * 保存するのが写真ではなく**場所**なので、入れ物を分ける。混ぜると
 * 「この写真を保存した」と「この場所に行きたい」が同じ一覧に並び、
 * どちらの画面も相手の要素を弾くコードを持つことになる。
 *
 * ## 仕組みは `likes#<uid>` / `following#<uid>` と**同じものを使い回す**
 *
 * `userList.ts` の `updateUserList`（新しい順のリスト1行 ＋ `rev` の CAS）。
 * このテーブルにソートキーは無いので `spot#<スラッグ>#<自分>` のような
 * マーカーを前方一致で列挙できない——だから利用者ごとの1行に持つ、
 * という判断は `userList.ts` に書いてある通りで、ここでも同じ。
 * **2つ目の実装は作らない。**
 *
 * ## いいねと違って、マーカーを置かない
 *
 * いいねは「済みかどうか」を**マーカー**が決め、一覧は表示用の索引だった
 * （溢れても判定は変わらない）。スポットには公開の集計も通知も無いので、
 * **この一覧そのものが唯一の状態**。結果として2つ違う:
 *
 *  - 書き込みに失敗したら **500 を返す**。`likes.ts` の `noteLiked` は
 *    黙って飲み込むが、あちらには戻れる先（マーカー）が在る。ここで
 *    飲み込むと、画面は「保存した」と出るのに次に開くと消えている。
 *  - 上限（`SAVED_SPOTS_MAX`）に達したら**古い方が落ちる**のは同じだが、
 *    落ちた場所は**本当に保存されていない**状態になる（嘘はつかない）。
 *
 * ## 他人の一覧は読めない
 *
 * 行 ID は **JWT の `sub` からしか作らない**（`spotsId(getUserId(event))`）。
 * パスにもクエリにも本文にも「誰の一覧か」を受け取る口を持たない。
 * フォロー（`/users/{uid}/following` が公開）とはここが違う——
 * 行きたい場所は**本人だけが見られる**。
 * これは `__tests__/savedSpots.test.ts` が見張る。
 */

/** 「行きたい場所」の一覧（`spots#<uid>`）。新しい順 */
const spotsId = (uid: string) => `spots#${uid}`;

/**
 * 一覧に残す上限。**溢れるのは古い方。**
 *
 * いいね（1000）より小さくしているのは、場所の数が写真より桁で少ないため
 * （実データの撮影地は14種）。ここが決めるのは「どこまで遡れるか」で、
 * **溢れたぶんは本当に外れる**——いいねと違って判定を持つマーカーが無い。
 */
export const SAVED_SPOTS_MAX = 500;

/**
 * 受け取ってよいスラッグの形。
 *
 * スラッグを作るのは画面側（`lib/utils/collections.ts` の `slugify(_, "location")`）で、
 * あそこは `/` `\` `?` `#` `%` と制御文字を `-` に潰し、**200バイト**で切る。
 * ここではその結果として在りうる形だけを通す:
 *
 *  - **空は通さない**（空の行 ID を作らない）
 *  - **`#` を含むものは通さない**。行 ID の区切りなので、通すと
 *    `spots#<uid>` 以外の行を指す値を一覧に混ぜられる（`report.ts` が
 *    写真 ID に同じ判定を置いているのと同じ理由）
 *  - 長さは 200 バイト＝**最大でも 200 文字**。`slugify` の上限と揃える
 *    （揃えないと、保存できたのに開けないスラッグが一覧に残る）
 */
const isSpotSlug = (x: string) => x.length > 0 && x.length <= 200 && !x.includes("#");

/**
 * GET /user/spots — 自分が保存したスポットのスラッグ一覧（新しい順）。
 *
 * **返すのはスラッグだけ。** 見出しも枚数も画面が既に持っている写真の一覧から
 * 引く（`likes.getMyLikes` が「写真の中身は返さない」としているのと同じ）。
 */
export const getMySavedSpots: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(400, "不正なリクエスト");
    try {
        const slugs = await readUserList(spotsId(userId), isSpotSlug, `spots#${userId}`);
        return {
            statusCode: 200,
            // **本人だけの答え。共有キャッシュには載せない**
            // （載せると、次に来た別の人へ配られる）
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            body: JSON.stringify({ slugs }),
        };
    } catch (e) {
        console.error("getMySavedSpots error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

/**
 * POST /user/spots — 行きたい場所に足す（冪等）。
 *
 * 本文は `{ "slug": "<撮影地のスラッグ>" }`。
 * 既に入っていれば何も書かずに 200（`updateUserList` の `mutate` が `null`）。
 */
export const saveSpot: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(400, "不正なリクエスト");

    let body: { slug?: unknown };
    try {
        body = JSON.parse(event.body ?? "{}") as { slug?: unknown };
    } catch {
        return jsonError(400, "不正なリクエスト");
    }
    const slug = typeof body.slug === "string" ? body.slug : "";
    if (!isSpotSlug(slug)) return jsonError(400, "場所の指定が不正です");

    return writeSpot(userId, slug, true, "保存に失敗しました");
};

/**
 * DELETE /user/spots/{slug} — 行きたい場所から外す（冪等）。
 *
 * **スラッグはパスで受ける。** 本文のある DELETE は経路（CDN・プロキシ）で
 * 落とされることがあるため。`event.pathParameters` は API Gateway が
 * 1回デコードした値を渡すので、こちらでは**デコードしない**
 * （二重デコードすると `%2D` を含む地名が別のスラッグになる）。
 */
export const unsaveSpot: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(400, "不正なリクエスト");
    const slug = event.pathParameters?.slug ?? "";
    if (!isSpotSlug(slug)) return jsonError(400, "場所の指定が不正です");

    return writeSpot(userId, slug, false, "解除に失敗しました");
};

/**
 * 足す／外すの共通部分。
 *
 * **応答は「書いたあとの状態」を返す**（`saved` と `slugs`）。画面が
 * 自分で足し引きして持ち回ると、失敗した回に嘘の状態が残る——
 * サーバーの答えをそのまま映せるようにする。
 */
async function writeSpot(userId: string, slug: string, add: boolean, failMessage: string) {
    try {
        let after: string[] = [];
        await updateUserList(spotsId(userId), userId, SAVED_SPOTS_MAX, (list) => {
            if (add) {
                // **重複して保存しない。** 既にあれば書かない（冪等）
                if (list.includes(slug)) { after = list; return null; }
                list.unshift(slug);
                after = list.slice(0, SAVED_SPOTS_MAX);
                return list;
            }
            const next = list.filter((x) => x !== slug);
            after = next;
            return next.length === list.length ? null : next;
        });
        return {
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            body: JSON.stringify({ saved: add, slugs: after }),
        };
    } catch (e) {
        // **黙って 200 を返さない。** この一覧が唯一の状態なので、
        // 飲み込むと画面だけが「保存した」と言い続ける（上の docstring 参照）。
        // 競合で諦めた回（`UserListError`）は押し直せば通るので、
        // 「いま混み合っている」と分かる 503 にする。
        if (e instanceof UserListError) {
            console.warn(`spots#${userId} の一覧が競合し続けました:`, e);
            return jsonError(503, "混み合っています。もう一度お試しください");
        }
        console.error("writeSpot error:", e);
        return jsonError(500, failMessage);
    }
}
