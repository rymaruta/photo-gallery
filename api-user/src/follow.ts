import type { APIGatewayProxyHandlerV2, APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { PutCommand, UpdateCommand, GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { pushNotification, lookupDisplayName } from "./notify";
import { requireEnv } from "./env";

const USERS_TABLE = requireEnv("USERS_TABLE");

/**
 * Cognito の sub（UUID）の形かどうか。
 * ここを見ないと、任意の文字列を相手に見立ててマーカー・カウンタ・
 * 通知文書を作れる（テーブルにゴミが際限なく積める）。
 */
function isUserId(v: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** その人が実在するか（プロフィール行の有無で見る） */
async function userExists(userId: string): Promise<boolean> {
    try {
        const res = await ddb.send(new GetCommand({
            TableName: USERS_TABLE,
            Key: { userId },
            ProjectionExpression: "userId",
        }));
        return !!res.Item;
    } catch (e) {
        console.error("userExists error:", e);
        // 判定できないときは通す（実在する相手をフォローできない方が困る）
        return true;
    }
}

// フォロー。すべて PHOTOS_TABLE・単一キー id で完結し GSI は汚さない。
//   - "follow#<targetUid>#<followerUid>" … 冪等マーカー（follower は uid 属性）
//   - "followstats#<uid>"                … { followers, following } 集計（原子加算）
//   - "following#<uid>"                  … 自分がフォロー中の userId リスト（feed/ボタン用）
// カウンタは users テーブルではなくここに置くため users-table の IAM 追加は不要。

const FOLLOWING_MAX = 2000;

const markerId = (target: string, follower: string) => `follow#${target}#${follower}`;
const statsId = (uid: string) => `followstats#${uid}`;
const followingId = (uid: string) => `following#${uid}`;

async function readStats(uid: string): Promise<{ followers: number; following: number }> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: statsId(uid) } }));
    const f = res.Item?.followers;
    const g = res.Item?.following;
    return {
        followers: typeof f === "number" && f > 0 ? f : 0,
        following: typeof g === "number" && g > 0 ? g : 0,
    };
}

async function readFollowing(uid: string): Promise<string[]> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: followingId(uid) } }));
    const list = res.Item?.list;
    return Array.isArray(list) ? (list as string[]) : [];
}

/**
 * following# の list を安全に書き換える。
 *
 * 以前は「読む → 変える → 無条件で Put」だった。1秒のうちに2人フォローすると
 * 2つの Lambda が同じ空リストを読み、片方の書き込みがもう片方を丸ごと
 * 上書きして、フォローが1件に減っていた。しかも follow# マーカーは両方
 * 残るので、もう一度フォローしても「既にフォロー済み」で早期 return し、
 * 一覧は欠けたまま直らない（フィードにその人の写真が出なくなる）。
 *
 * 順序（新しくフォローした順）を保ちたいので集合型には替えず、
 * リビジョン番号で衝突を検出して読み直す。
 */
const FOLLOWING_WRITE_RETRIES = 3;

/** 一覧の書き込みを諦めたときのエラー。呼び出し側が打ち消し処理に使う */
class FollowingListError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "FollowingListError";
    }
}

async function updateFollowing(uid: string, mutate: (list: string[]) => string[] | null): Promise<void> {
    for (let attempt = 0; attempt <= FOLLOWING_WRITE_RETRIES; attempt++) {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: followingId(uid) } }));
        const current = Array.isArray(res.Item?.list) ? (res.Item.list as string[]) : [];
        const rev = typeof res.Item?.rev === "number" ? res.Item.rev : 0;

        const next = mutate([...current]);
        if (next === null) return; // 変更なし

        // 読んでから今までに他の書き込みが入っていないこと。
        // rev を持たない既存データ（この仕組みを入れる前の item）も通す必要が
        // あるので、rev が無いときだけ条件を緩める。
        // DynamoDB は値どうしの比較を許さないため、分岐は JS 側で作る。
        const guard = rev === 0
            ? "attribute_not_exists(id) OR attribute_not_exists(rev) OR rev = :rev"
            : "rev = :rev";

        try {
            await ddb.send(new PutCommand({
                TableName: PHOTOS_TABLE,
                Item: {
                    id: followingId(uid),
                    uid,
                    list: next.slice(0, FOLLOWING_MAX),
                    rev: rev + 1,
                    updatedAt: new Date().toISOString(),
                },
                ConditionExpression: guard,
                ExpressionAttributeValues: { ":rev": rev },
            }));
            return;
        } catch (e) {
            if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;
            // 競合。読み直してやり直す
        }
    }
    // 諦めたことを黙って飲み込まない。
    //
    // 以前はログを1行出して正常終了していた。呼び出し側は成功として 200 を返すが、
    // follow# マーカーは書かれていて一覧だけが欠ける。もう一度フォローしても
    // 「既にフォロー済み」で早期 return するので、**二度と直らない**
    // （その人の写真がフィードに出ないままになる）。
    // 呼び出し側で打ち消して 500 を返せるように投げる。
    throw new FollowingListError(`${uid} の一覧更新が競合し続けました`);
}

/**
 * 同じ相手へのフォロー通知の最短間隔。
 * 解除するとマーカーが消えるので、フォロー→解除を繰り返すだけで
 * 何度でも通知できてしまう。通知は50件の輪なので、100回ほどで
 * 相手の通知欄を自分の通知だけで埋め尽くせる。
 */
const FOLLOW_NOTIFY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const notifyMarkerId = (target: string, by: string) => `follownotify#${target}#${by}`;

/** 直近に通知していなければ印を付けて true（＝通知してよい） */
async function shouldNotifyFollow(target: string, by: string): Promise<boolean> {
    const now = Date.now();
    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: notifyMarkerId(target, by) },
            UpdateExpression: "SET lastAt = :now",
            ConditionExpression: "attribute_not_exists(lastAt) OR lastAt < :cutoff",
            ExpressionAttributeValues: { ":now": now, ":cutoff": now - FOLLOW_NOTIFY_COOLDOWN_MS },
        }));
        return true;
    } catch (e) {
        if ((e as { name?: string }).name === "ConditionalCheckFailedException") return false;
        // 判定できないときは通知する（本来の通知を落とさない方を優先）
        console.error("shouldNotifyFollow error:", e);
        return true;
    }
}

/**
 * フォロー / 解除を**1つの書き込み**にする。
 *
 * ここは `api-user/src/account.ts` の `unfollowAtomically` と同じ形。
 * 新しい仕掛けは作らない（あちらは今日5回作り直して、ようやく
 * この形に落ち着いた）。**片方を直したらもう片方も見ること。**
 *
 * 直す前は「マーカー」と「カウンタ2つ」が別々の書き込みだった。
 *   - フォロー: マーカーを書いた直後の加算が落ちると 500。マーカーは残るので
 *     押し直しても冪等の早期 return で 200 が返り、**カウンタは永久に
 *     1少ないまま**。相手には直す手段が無い。
 *   - 解除: 減算が `.catch(() => {})` で**全部の失敗を握り潰して**いた。
 *     マーカーは既に消えているので**永久に1多いまま**。フォローし直して
 *     解除しても差し引きゼロなので自己修復しない。
 *
 * トランザクションなら「全部効く」か「1つも効かない」のどちらか。
 *
 * **失敗しうる条件を1つに絞る**のが要点。account.ts を5回作り直した原因は、
 * 条件が複数あって「どの理由でキャンセルされたか」の分岐が増えたこと。
 * ここでは条件を持つのはマーカーだけにしてある:
 *   - 加算は `if_not_exists(x, :z) + :one` で条件なし
 *   - 減算も条件なし。マーカーの存在が前提なので、マーカー1個につき
 *     最大1回しか減らない。負になるのは元から少なすぎた場合だけで、
 *     そのときも readStats が 0 に丸めて返す（テストで固定済み）。
 * だから CancellationReasons[0] だけを見ればよい。
 */
type CancelReason = { Code?: string };

/** 「マーカーの条件が外れた」＝既にフォロー済み / 既に未フォロー か */
function markerConditionFailed(e: unknown): boolean {
    if ((e as { name?: string }).name !== "TransactionCanceledException") return false;
    const reasons = (e as { CancellationReasons?: CancelReason[] }).CancellationReasons;
    return Array.isArray(reasons) && reasons[0]?.Code === "ConditionalCheckFailed";
}

function statBump(uid: string, field: "followers" | "following", delta: 1 | -1) {
    return {
        Update: {
            TableName: PHOTOS_TABLE,
            Key: { id: statsId(uid) },
            UpdateExpression: delta === 1
                ? `SET ${field} = if_not_exists(${field}, :z) + :one, uid = :uid`
                : `SET ${field} = if_not_exists(${field}, :z) - :one, uid = :uid`,
            ExpressionAttributeValues: { ":z": 0, ":one": 1, ":uid": uid },
        },
    };
}

/** フォロー（マーカー作成 + 双方のカウンタ +1）を1つの書き込みで */
async function followAtomically(target: string, me: string): Promise<void> {
    await ddb.send(new TransactWriteCommand({
        TransactItems: [
            {
                Put: {
                    TableName: PHOTOS_TABLE,
                    Item: { id: markerId(target, me), follow: true, target, uid: me, createdAt: new Date().toISOString() },
                    ConditionExpression: "attribute_not_exists(id)",
                },
            },
            statBump(target, "followers", 1),
            statBump(me, "following", 1),
        ],
    }));
}

/** 解除（マーカー削除 + 双方のカウンタ -1）を1つの書き込みで */
async function unfollowAtomically(target: string, me: string): Promise<void> {
    await ddb.send(new TransactWriteCommand({
        TransactItems: [
            {
                Delete: {
                    TableName: PHOTOS_TABLE,
                    Key: { id: markerId(target, me) },
                    ConditionExpression: "attribute_exists(id)",
                },
            },
            statBump(target, "followers", -1),
            statBump(me, "following", -1),
        ],
    }));
}

// POST /users/{uid}/follow — フォロー（認証必要・冪等）
export const followUser: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const me = getUserId(event);
    const target = event.pathParameters?.uid;
    if (!me || !target) return jsonError(400, "不正なリクエスト");
    if (me === target) return jsonError(400, "自分はフォローできません");
    // 実在しない相手をフォローさせない。
    // 形も存在も見ていなかったので、でたらめなIDを投げるだけで
    // follow# マーカー・followstats# ・notifs# の3つが作られた。
    // このテーブルは公開一覧やストーリー掃除が端から端まで読むので、
    // ゴミが増えるほど全員の表示が遅くなる。しかも notifs# は
    // 退会処理でも消えない。
    if (!isUserId(target)) return jsonError(400, "不正なリクエスト");
    if (!(await userExists(target))) return jsonError(404, "ユーザーが見つかりません");

    try {
        // マーカー作成とカウンタ加算を1つの書き込みで（既にあれば冪等）
        try {
            await followAtomically(target, me);
        } catch (e) {
            if (markerConditionFailed(e)) {
                return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ following: true, followers: (await readStats(target)).followers }) };
            }
            throw e;
        }

        // 自分の following リストに追加（新しい順の先頭へ）。
        // ここで失敗したらマーカーとカウンタを戻す。戻さないと
        // 「フォロー済み扱いなのに一覧に出ない」状態が固定され、
        // 押し直しても早期 return で直らない。
        // 打ち消しも1つの書き込みで行う（バラバラだと、まさにここで
        // 直そうとしている「片方だけ効いた状態」を打ち消し側で作る）。
        try {
            await updateFollowing(me, (list) => {
                if (list.includes(target)) return null;
                list.unshift(target);
                return list;
            });
        } catch (e) {
            if ((e as { name?: string }).name !== "FollowingListError") throw e;
            await unfollowAtomically(target, me).catch(() => { /* 戻せなくてもこれ以上できることは無い */ });
            return jsonError(500, "フォローに失敗しました。もう一度お試しください");
        }

        // 相手に通知。
        //
        // ただし「同じ相手への連続したフォロー通知」は間引く。
        // 解除するとマーカーが消えるので、フォロー→解除を繰り返すだけで
        // 通知を何度でも積めた。通知は50件の輪（古いものから落ちる）なので、
        // 100回ほどで**相手の通知欄を自分の通知だけで埋め尽くせる**。
        // まだ読んでいないいいねやコメントの知らせが全部消える。
        if (await shouldNotifyFollow(target, me)) {
            await pushNotification(target, {
                type: "follow",
                photoId: "",
                photoSrc: "",
                byName: await lookupDisplayName(me),
                byId: me,
                targetUserId: me,
                t: new Date().toISOString(),
            });
        }

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ following: true, followers: (await readStats(target)).followers }) };
    } catch (e) {
        console.error("followUser error:", e);
        return jsonError(500, "フォローに失敗しました");
    }
};

// DELETE /users/{uid}/follow — フォロー解除（認証必要・冪等）
export const unfollowUser: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const me = getUserId(event);
    const target = event.pathParameters?.uid;
    if (!me || !target) return jsonError(400, "不正なリクエスト");

    try {
        try {
            await unfollowAtomically(target, me);
        } catch (e) {
            if (markerConditionFailed(e)) {
                return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ following: false, followers: (await readStats(target)).followers }) };
            }
            throw e;
        }

        // 解除も同じ。失敗したらマーカーを戻して再試行できるようにする。
        try {
            await updateFollowing(me, (list) => {
                const next = list.filter((x) => x !== target);
                return next.length === list.length ? null : next;
            });
        } catch (e) {
            if ((e as { name?: string }).name !== "FollowingListError") throw e;
            await followAtomically(target, me).catch(() => { /* 戻せなくてもこれ以上できることは無い */ });
            return jsonError(500, "フォロー解除に失敗しました。もう一度お試しください");
        }

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ following: false, followers: (await readStats(target)).followers }) };
    } catch (e) {
        console.error("unfollowUser error:", e);
        return jsonError(500, "フォロー解除に失敗しました");
    }
};

// GET /users/{uid}/follow — フォロワー/フォロー中の数（公開）
export const getFollowStats: APIGatewayProxyHandlerV2 = async (event) => {
    const uid = event.pathParameters?.uid;
    if (!uid) return jsonError(400, "IDが必要です");
    try {
        return {
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "public, s-maxage=30" },
            body: JSON.stringify(await readStats(uid)),
        };
    } catch (e) {
        console.error("getFollowStats error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

// GET /user/following — 自分がフォロー中の userId 一覧（認証必要・feed/ボタン用）
export const getMyFollowing: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const me = getUserId(event);
    if (!me) return jsonError(400, "不正なリクエスト");
    try {
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ userIds: await readFollowing(me) }) };
    } catch (e) {
        console.error("getMyFollowing error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};
