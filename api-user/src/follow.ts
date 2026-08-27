import type { APIGatewayProxyHandlerV2, APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { hasAnyPhoto } from "./ddb-photos";
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

/**
 * その人が実在するか（プロフィール行の有無で見る）。
 *
 * **判定できなかったときは "unknown" を返し、呼び出し側は 503 で断る。**
 * 以前は catch で true を返していた（fail-open）。USERS_TABLE が
 * スロットルされている間は、存在しない UUID でもマーカー・カウンタ・
 * 通知文書の3つが作られる——この関数のすぐ上のコメントが「ここを見ないと
 * テーブルにゴミが際限なく積める」と書いている当のものが、失敗時だけ
 * 素通りだった。photoLimitError・discardUpload と同じく
 * 「分からないなら止める」に倒す（押し直せば通る）。
 */
async function userExists(userId: string): Promise<boolean | "unknown"> {
    try {
        const res = await ddb.send(new GetCommand({
            TableName: USERS_TABLE,
            Key: { userId },
            ProjectionExpression: "userId",
        }));
        if (res.Item) return true;
        // 行が無い＝存在しない、ではない。PostConfirmation トリガーが
        // 失敗した人・トリガー導入前に登録した人には最初から行が無く、
        // **誰からもフォローできなかった**（プロフィールページは 200 で
        // 開き、ボタンも出るので押して初めて 404 になり、相手にも本人にも
        // 直す手段が無い）。写真を上げているなら明らかに実在する。
        return await hasAnyPhoto(userId);
    } catch (e) {
        console.error("userExists error:", e);
        return "unknown";
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
const CCF = "ConditionalCheckFailed";

/** トランザクションのキャンセル理由。別の失敗なら null */
function cancelReasons(e: unknown): CancelReason[] | null {
    if ((e as { name?: string }).name !== "TransactionCanceledException") return null;
    const r = (e as { CancellationReasons?: CancelReason[] }).CancellationReasons;
    return Array.isArray(r) ? r : null;
}

/**
 * TransactionCanceledException は SDK の自動再試行の対象外（400系）。
 * 人気ユーザーの followstats# は全フォロー/解除が触るので、
 * TransactionConflict は日常的に起きる。ここで諦めると利用者に
 * 「うまくいきませんでした」が出るだけなので、少し待って撃ち直す。
 * account.ts の退会処理も同じ理由で再試行している。
 */
const TX_ATTEMPTS = 3;
const TX_RETRY_BASE_MS = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * カウンタの増減。
 *
 * **減算には必ず床（`> :z`）を付ける。** 一度これを外したが誤りだった。
 * 床は表示のためではなく「誤差が増えるのを止める」ためにある:
 *   古い実装のせいで followstats#T が実際より1少ない状態が既にある
 *   → 床が無いと解除で -1 になる
 *   → 次の本物のフォローが 0 に戻すだけで、表示は 0 のまま
 *   → **その1人分が永久に吸収される**（床があれば解除は空振りして、
 *     次のフォローで正しく1になる）
 * `attribute_exists(id)` も要る。無いと、退会で消えた followstats# を
 * `followers: -1` で作り直してしまう（誰も消せない行が増える）。
 */
function statBump(uid: string, field: "followers" | "following", delta: 1 | -1) {
    if (delta === 1) {
        return {
            Update: {
                TableName: PHOTOS_TABLE,
                Key: { id: statsId(uid) },
                UpdateExpression: `SET ${field} = if_not_exists(${field}, :z) + :one, uid = :uid`,
                ExpressionAttributeValues: { ":z": 0, ":one": 1, ":uid": uid },
            },
        };
    }
    return {
        Update: {
            TableName: PHOTOS_TABLE,
            Key: { id: statsId(uid) },
            UpdateExpression: `SET ${field} = ${field} - :one`,
            ConditionExpression: `attribute_exists(id) AND ${field} > :z`,
            ExpressionAttributeValues: { ":z": 0, ":one": 1 },
        },
    };
}

type TxItem = ReturnType<typeof statBump> | Record<string, unknown>;

/**
 * マーカーとカウンタを1つの書き込みで動かす。
 *
 * 戻り値の "already" は「マーカーの条件が外れた」＝
 * 既にフォロー済み / 既に未フォロー。冪等に扱ってよい。
 *
 * 減らせないカウンタ（既に0・行が無い）があったら、その項目だけ落として
 * 組み直す。**落としてよいのは「借りが無い」と確かめられたときだけ**で、
 * マーカーとまだ減らせるカウンタは同じ書き込みのまま保つ。
 */
async function runMarkerTx(marker: TxItem, bumps: TxItem[]): Promise<"done" | "already"> {
    let items: TxItem[] = [marker, ...bumps];
    // 落とし直しは**試行回数を食わない**。for の増分に混ぜていた頃は、
    // 数回スロットルされたあとに本当の条件外れが見えると、組み直した
    // 書き込みを一度も送らないままループが尽きて 500 になっていた
    // （本当の DynamoDB のエラーも一緒に捨てていた）。
    // 落とせるのは高々2件（マーカーは必ず残す）なので、これで回り続けない。
    let attempt = 0;
    for (;;) {
        try {
            await ddb.send(new TransactWriteCommand({ TransactItems: items }));
            return "done";
        } catch (e) {
            const reasons = cancelReasons(e);
            if (!reasons) throw e;                       // 別の失敗。何も書かれていない
            if (reasons[0]?.Code === CCF) return "already";

            // 減らせないカウンタを落として組み直す（理由は現在の items と同じ並び）
            const dropped = items.filter((_, i) => i === 0 || reasons[i]?.Code !== CCF);
            if (dropped.length < items.length) {
                items = dropped;
                continue;
            }
            // 競合・スロットリング。待って撃ち直す
            if (++attempt >= TX_ATTEMPTS) throw e;
            await sleep(TX_RETRY_BASE_MS * 2 ** (attempt - 1));
        }
    }
}

/**
 * 打ち消しが落ちても、**マーカーだけを単発で戻すことはしない**。
 *
 * 一度そう書いたが誤りだった。マーカーは「次の1回の増減を許可する券」
 * そのものなので、券だけ復活させるとカウンタが二重に動く:
 *   解除が成立（カウンタ -1）→ 一覧が競合し続ける → 打ち消しも競合で落ちる
 *   → マーカーだけ戻す → 画面は一覧を見ているので「フォロー中」のまま
 *   → 利用者が解除を押し直す → マーカーがあるので **もう一度 -1**
 * 床（`> :z`）は 0 付近しか守らないので、100 が 98 になるのは止められない。
 * 「誤差が増えるのを止める」ために床を戻したのに、その逃げ道になっていた。
 *
 * 代わりに**冪等の道でも一覧を突き合わせる**ようにした（下の2つの handler）。
 * マーカーと一覧が食い違っても、押し直せば一覧の方が直る。だから打ち消しは
 * 「取れたら取る」でよく、取れなくても行き止まりにならない。
 */
async function undoFollow(target: string, me: string): Promise<void> {
    await unfollowAtomically(target, me).catch((e) => {
        // 押し直しで一覧が直るので、ここで無理はしない
        console.error("undoFollow failed:", e);
    });
}

/** 解除の打ち消し。同じ理由でマーカー単体の復活はしない */
async function undoUnfollow(target: string, me: string): Promise<void> {
    await followAtomically(target, me).catch((e) => {
        console.error("undoUnfollow failed:", e);
    });
}

const followMarker = (target: string, me: string) => ({
    Put: {
        TableName: PHOTOS_TABLE,
        Item: { id: markerId(target, me), follow: true, target, uid: me, createdAt: new Date().toISOString() },
        ConditionExpression: "attribute_not_exists(id)",
    },
});

/** フォロー（マーカー作成 + 双方のカウンタ +1） */
function followAtomically(target: string, me: string): Promise<"done" | "already"> {
    return runMarkerTx(followMarker(target, me), [
        statBump(target, "followers", 1),
        statBump(me, "following", 1),
    ]);
}

/** 解除（マーカー削除 + 双方のカウンタ -1） */
function unfollowAtomically(target: string, me: string): Promise<"done" | "already"> {
    return runMarkerTx({
        Delete: {
            TableName: PHOTOS_TABLE,
            Key: { id: markerId(target, me) },
            ConditionExpression: "attribute_exists(id)",
        },
    }, [
        statBump(target, "followers", -1),
        statBump(me, "following", -1),
    ]);
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
    const exists = await userExists(target);
    // 「居ない」と「確認できなかった」を混ぜない。unknown で 404 を返すと
    // 「見つかりません」という嘘になり、fail-open に戻すとゴミが積める。
    if (exists === "unknown") return jsonError(503, "確認できませんでした。時間をおいてもう一度お試しください");
    if (!exists) return jsonError(404, "ユーザーが見つかりません");

    try {
        // マーカー作成とカウンタ加算を1つの書き込みで（既にあれば冪等）
        const outcome = await followAtomically(target, me);

        // 自分の following リストに追加（新しい順の先頭へ）。
        //
        // **既にフォロー済み（"already"）でもここを通す。** 以前は早期 return
        // していたが、それだと「マーカーはあるが一覧に無い」状態を誰も直せない
        // ——画面は一覧から作るのでボタンは「フォロー」のまま、押しても
        // 早期 return で一覧は書かれない。押し直しで直るようにしておけば、
        // 打ち消しが取れなくても行き止まりにならない。
        // 一覧に既に居れば mutate が null を返すので、書き込みは増えない。
        try {
            await updateFollowing(me, (list) => {
                if (list.includes(target)) return null;
                list.unshift(target);
                return list;
            });
        } catch (e) {
            if ((e as { name?: string }).name !== "FollowingListError") throw e;
            // 打ち消すのは**この呼び出しで書いたぶんだけ**。"already" のときは
            // 何も書いていないので、打ち消すと他人の（前回成立した）
            // フォローを勝手に解除することになる。
            if (outcome === "done") await undoFollow(target, me);
            return jsonError(500, "フォローに失敗しました。もう一度お試しください");
        }

        // 相手に通知。
        //
        // ただし「同じ相手への連続したフォロー通知」は間引く。
        // 解除するとマーカーが消えるので、フォロー→解除を繰り返すだけで
        // 通知を何度でも積めた。通知は50件の輪（古いものから落ちる）なので、
        // 100回ほどで**相手の通知欄を自分の通知だけで埋め尽くせる**。
        // まだ読んでいないいいねやコメントの知らせが全部消える。
        if (outcome === "done" && await shouldNotifyFollow(target, me)) {
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
    // 自分自身は followUser 側で弾いているのでマーカーは存在しないが、
    // ここを通すと1つのトランザクションが同じ項目（followstats#<自分>）を
    // 2回触ることになり、DynamoDB が ValidationException で丸ごと拒否する
    // ——条件の評価より前なので 500 になる。以前は 200 だった。
    if (me === target) return jsonError(400, "自分はフォロー解除できません");

    try {
        const outcome = await unfollowAtomically(target, me);

        // 解除も同じ。**マーカーが既に無くても一覧は突き合わせる。**
        // 一覧に居なければ mutate が null を返すので書き込みは増えない。
        try {
            await updateFollowing(me, (list) => {
                const next = list.filter((x) => x !== target);
                return next.length === list.length ? null : next;
            });
        } catch (e) {
            if ((e as { name?: string }).name !== "FollowingListError") throw e;
            if (outcome === "done") await undoUnfollow(target, me);
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
