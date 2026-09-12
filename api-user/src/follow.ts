import type { APIGatewayProxyHandlerV2, APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { hasAnyUserItem } from "./ddb-photos";
import { PutCommand, UpdateCommand, GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { pushNotification, lookupDisplayName, lookupDisplayNameIfSet, deletedUserIds } from "./notify";
import { requireEnv } from "./env";
import { isUserId } from "./userId";
import { hiddenUserIds, isBlocked } from "./blockCheck";
import { isDeletedProfile } from "./types";

const USERS_TABLE = requireEnv("USERS_TABLE");

// `isUserId` は `userId.ts` へ移した（`block.ts` も同じ判定が要るため。
// **複製した規則は静かにずれる**——このリポジトリが何度も踏んでいる形）。

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
            ProjectionExpression: "userId, deletedAt",
        }));
        // 退会の墓石は「実在する」に数えない。数えると、消えた ID を
        // フォローできてしまう。判定は types.ts に1か所だけ置く
        // （上の ProjectionExpression から deletedAt を外すと、この行は
        //  常に false になって黙って死ぬ——そこもテストで固定してある）。
        if (isDeletedProfile(res.Item)) return false;
        if (res.Item) return true;
        // 行が無い＝存在しない、ではない。PostConfirmation トリガーが
        // 失敗した人・トリガー導入前に登録した人には最初から行が無く、
        // **誰からもフォローできなかった**（プロフィールページは 200 で
        // 開き、ボタンも出るので押して初めて 404 になり、相手にも本人にも
        // 直す手段が無い）。写真を上げているなら明らかに実在する。
        return await hasAnyUserItem(userId);
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
/**
 * **自分をフォローしている人の一覧。**
 *
 * これまで持っていたのは「自分がフォローしている人」（`following#`）と
 * 数（`followstats#`）だけで、**「誰にフォローされているか」を引ける行が
 * 無かった**。マーカー（`follow#<自分>#<相手>`）は主キーが1本なので
 * 前方一致で列挙できない（このテーブルにソートキーは無い）＝
 * 全表 Scan しか手が無く、画面からは引けない。
 *
 * `following#` と同じ形（新しい順のリスト＋`rev`）で持つ。
 * 既にあるフォロー関係は `scripts/backfill-followers.js` が埋める。
 */
const followersId = (uid: string) => `followers#${uid}`;

async function readStats(uid: string): Promise<{ followers: number; following: number }> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: statsId(uid) } }));
    const f = res.Item?.followers;
    const g = res.Item?.following;
    return {
        followers: typeof f === "number" && f > 0 ? f : 0,
        following: typeof g === "number" && g > 0 ? g : 0,
    };
}

/**
 * 一覧に入っている ID のうち、**画面に出してよいものだけ**返す。
 *
 * `isUserId` を入れる前は形も存在も見ずにマーカーと一覧を作れたので、
 * **でたらめな ID が本番に実在する**（`backfill-followers` のドライランで
 * 2件確認）。素通しすると一覧に「旅人」として並び、押すと空のプロフィール
 * ——このリポジトリが何度も潰してきた行き止まり。
 *
 * **行は書き直さない**（読むだけ）。書き換えは競合の窓を増やすうえ、
 * 消していいものかの判断が要る。出さないだけにする。
 * **落とした ID は出さない**（診断ログに表示名を書き出した事故がある）。
 */
function usableUserIds(list: unknown, label: string): string[] {
    if (!Array.isArray(list)) return [];
    const out = list.filter((x): x is string => typeof x === "string" && isUserId(x));
    if (out.length !== list.length) {
        console.warn(`${label}: 形の違う ID を ${list.length - out.length} 件落としました`);
    }
    return out;
}

async function readFollowing(uid: string): Promise<string[]> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: followingId(uid) } }));
    return usableUserIds(res.Item?.list, `following#${uid}`);
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
/** やり直しの待ち（指数＋ばらつき）。`followers#` は多人数が同じ行を書く */
const LIST_RETRY_BASE_MS = 25;

/** 一覧の書き込みを諦めたときのエラー。呼び出し側が打ち消し処理に使う */
class FollowingListError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "FollowingListError";
    }
}

/**
 * `following#` と `followers#` は同じ形（新しい順のリスト＋`rev`）なので、
 * 書き換えも1つにする。**規則を2つ書くと静かにずれる**——このリポジトリが
 * 何度も踏んでいる形。
 */
async function updateUserList(rowId: string, uid: string, mutate: (list: string[]) => string[] | null): Promise<void> {
    for (let attempt = 0; attempt <= FOLLOWING_WRITE_RETRIES; attempt++) {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: rowId } }));
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
                    id: rowId,
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
            // 競合。読み直してやり直す。
            //
            // **間を置く。** `following#<自分>` は書き手が自分1人なので
            // 競合はほぼ起きないが、`followers#<相手>` は**その人を
            // フォロー／解除する全員が同じ1行を書く**。即座に撃ち直すと
            // 押し合いになるだけなので、指数で待ってばらす
            // （待たずに撃ち直すとスロットリング由来の失敗も悪化する
            //  ——`account.ts` の掃除が同じ理由で待っている）。
            // **最後の回は待たない。** 待ってもループが尽きて投げるだけで、
            // その 100〜300ms は丸損（`followUser` は2つの行を通るので
            // 最悪 1,125ms、既定6秒の枠から削る意味が無い）
            if (attempt < FOLLOWING_WRITE_RETRIES) {
                await new Promise((r) => setTimeout(r, LIST_RETRY_BASE_MS * 2 ** attempt * (0.5 + Math.random())));
            }
        }
    }
    // 諦めたことを黙って飲み込まない。
    //
    // 以前はログを1行出して正常終了していた。呼び出し側は成功として 200 を返すが、
    // follow# マーカーは書かれていて一覧だけが欠ける。もう一度フォローしても
    // 「既にフォロー済み」で早期 return するので、**二度と直らない**
    // （その人の写真がフィードに出ないままになる）。
    // 呼び出し側で打ち消して 500 を返せるように投げる。
    throw new FollowingListError(`${rowId} の一覧更新が競合し続けました`);
}

/** 自分がフォローしている人の一覧 */
const updateFollowing = (uid: string, mutate: (list: string[]) => string[] | null) =>
    updateUserList(followingId(uid), uid, mutate);

/**
 * 相手の「フォロワー一覧」に自分を足す／外す。
 *
 * **失敗しても投げない。** マーカーと数（`followstats#`）は既に正しく、
 * 欠けるのは表示用の一覧の1行だけ。ここで 500 にすると、**表示の都合で
 * フォローそのものを失敗させる**ことになる（`following#` を投げる側に
 * したのは、あちらが欠けると相手の写真がフィードから消えるため）。
 *
 * **ただし「押し直せば直る」は `following#` ほど素直ではない。**
 * フォロワー本人のボタンの状態は `following#<本人>` から作るので、
 * `followers#<相手>` が欠けても本人には「フォロー中」に見える
 * ——押すと**解除**される。直すには「解除してもう一度フォロー」が要る。
 * 気づく手がかりは、相手の画面で数（`followstats#`）と一覧が食い違うこと
 * （`getUserFollowers` が両方返し、画面が「一覧はまだ用意できていません」と
 * 出す）。取りこぼしをまとめて直すには
 * `scripts/backfill-followers.js` を流す。
 */
export async function updateFollowersQuietly(target: string, follower: string, add: boolean): Promise<boolean> {
    try {
        await updateUserList(followersId(target), target, (list) => {
            if (add) {
                if (list.includes(follower)) return null;
                list.unshift(follower);
                return list;
            }
            const next = list.filter((x) => x !== follower);
            return next.length === list.length ? null : next;
        });
        return true;
    } catch (e) {
        console.error(`updateFollowersQuietly: ${target} の一覧を更新できませんでした（${follower}, add=${add}）:`, e);
        return false;
    }
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

    // **ブロックした相手とは、フォローの関係を作らせない。**
    //
    // `blockUser` は両向きのフォローを切る（`unfollowQuietly` を2回）のに、
    // **この口には判定が1つも無かった**——ブロックされた側がプロフィールを
    // 開いて「フォロー」を押すだけで 200 が返り、関係が戻る。しかも
    // `notify.ts` がフォロー通知を握るので、**ブロックした側は気づけない**
    // （フォロワー数だけが増える）。「関係を切る」を1回の書き込みで
    // 済ませた代償が、相手のワンタップで消えていた。
    //
    // 判定は2回とも要る（向きが違う）。**同時に投げるので往復は1回分**。
    //   - 相手が自分をブロック → **404**。ブロックの事実を教えない
    //     （`storyReplies.ts:150` と同じ倒し方）
    //   - 自分が相手をブロック → **400 で理由を言う**。自分がやったことなので
    //     隠す意味が無く、404 にすると「消えた人」に見えて行き止まりになる
    const [blockedByTarget, blockedByMe] = await Promise.all([
        isBlocked(target, me).catch((e) => { console.error("followUser isBlocked(target,me):", e); return null; }),
        isBlocked(me, target).catch((e) => { console.error("followUser isBlocked(me,target):", e); return null; }),
    ]);
    // 「分からない」を素通ししない。`userExists` の unknown と同じ倒し方
    // （押し直せば通る）。fail-open にすると、ブロックしたのに繋がる
    if (blockedByTarget === null || blockedByMe === null) {
        return jsonError(503, "確認できませんでした。時間をおいてもう一度お試しください");
    }
    if (blockedByTarget) return jsonError(404, "ユーザーが見つかりません");
    // **どこで解除するかを言う。** 「解除してから」だけでは、その画面に
    // 解除の口が無い（プロフィールの共有メニューに出ているのは、開き直した
    // 直後は逆の「この人をブロック」）。他の2か所——`StoryViewer` と
    // `UserProfileClient` の注意書き——は「解除はプロフィール設定から」と
    // 場所まで言っているのに、**押した人が実際に受け取るこの文言だけ**が
    // 言っていなかった
    if (blockedByMe) return jsonError(400, "ブロック中の相手です。解除はプロフィール設定の「ブロックした人」からできます");

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

        // **相手のフォロワー一覧にも足す。** ここも `outcome` を見ない
        // ——「マーカーはあるが一覧に無い」を押し直しで直せるようにする
        // （すぐ上の `following#` と同じ考え）。失敗しても投げない。
        //
        // 応答の中身を先に決めてから書く。**守りではなく、テストの
        // 読みやすさのため**——`updateFollowersQuietly` は `followstats#` を
        // 触らないので、順番を入れ替えても返す数は変わらない
        // （「ここが落ちても数は守られる」と書いていたが、守っているのは
        //  この順番ではなくトランザクションの方）
        const body = JSON.stringify({ following: true, followers: (await readStats(target)).followers });
        await updateFollowersQuietly(target, me, true);
        return { statusCode: 200, headers: JSON_HEADERS, body };
    } catch (e) {
        console.error("followUser error:", e);
        return jsonError(500, "フォローに失敗しました");
    }
};

// DELETE /users/{uid}/follow — フォロー解除（認証必要・冪等）
/**
 * 片向きのフォローを解く（口ではなく中身）。
 *
 * ブロックから呼ぶために切り出した。**関係を切るのは「見えなくする」より
 * 強い**——このサイトの写真は静的サイトに焼かれて未ログインでも見えるので、
 * 「ブロックした相手の写真をフィードから隠す」は閲覧者ごとの出し分けが要る
 * のに対し、フォローを外すのは1回の書き込みで済み、静的サイトとも矛盾しない。
 *
 * **失敗しても投げない。** ブロックそのものは既に効いている（印が立って
 * いる）ので、フォローが残ったからといってブロックを失敗にはしない。
 *
 * **`unfollowUser` と違って打ち消さない**（あちらは一覧の書き換えが
 * 3回競合したら `undoUnfollow` でマーカーを戻す）。ここで戻すと
 * **ブロックがいま切ったフォローを、自分で作り直す**ことになる。
 * 残るのは「カウンタは減ったのに `following#<自分>` に相手が残る」形で、
 * フィードは `hiddenUserIds` が両向きに隠すので出てこない——**これは誤り**
 * （下の `getMyFollowing` の注記を見ること）。
 */
export async function unfollowQuietly(target: string, me: string): Promise<void> {
    if (!target || !me || target === me) return;
    // **「解除が成立したか」を持ち回る。**
    //
    // 一度この呼び出しを `try` の外に出したが、**`try` には
    // `unfollowAtomically` も入っている**ので、解除そのものが失敗した回にも
    // 相手の一覧から自分を消すようになっていた。`unfollowAtomically` は
    // 投げる——`runMarkerTx` が3回とも `TransactionConflict` だったとき、
    // キャンセル系でない失敗（通信断・5xx）では1回目で即。しかも
    // `runMarkerTx` 自身が「`followstats#<人気ユーザー>` は全フォロー／解除が
    // 触るので、競合は日常」と書いている。
    //
    // そのとき残るのは:
    //     follow#<相手>#<自分>        残る（解除は成立していない）
    //     followstats#<相手>.followers 自分を数えたまま
    //     following#<自分>            相手が残る
    //     followers#<相手>            **自分だけ消える** ← ここだけ動く
    // 変更前は1行も書かれず整合していたので、**直したつもりで作った不整合**。
    // 誰も直せない（埋め戻しを流すしかない）。
    let severed = false;
    try {
        await unfollowAtomically(target, me);
        severed = true;
        await updateFollowing(me, (list) => {
            const next = list.filter((x) => x !== target);
            return next.length === list.length ? null : next;
        });
    } catch (e) {
        console.error(`unfollowQuietly: 解除できませんでした（${me} -> ${target}）:`, e);
    }
    // **`updateFollowing` が投げた回はここに来る。**
    // 括弧の中に「`getUserFollowers` は行ごとのブロック除外をしない」と
    // 書いていたが、**その除外は入れた**（`withoutHidden`）ので根拠としては
    // 無効。それでもここは要る——`followers#` の行そのものを直しておかないと、
    // (a) 2000人の上限を切れた関係が食う (b) 数（`followstats#`）と一覧が
    // ずれたまま残る (c) ブロックを解除した瞬間に古い関係が生き返って見える。
    // ふるいは「見せない」だけで、行は直さない。
    if (severed) await updateFollowersQuietly(target, me, false);
}

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

        const body = JSON.stringify({ following: false, followers: (await readStats(target)).followers });
        await updateFollowersQuietly(target, me, false);
        return { statusCode: 200, headers: JSON_HEADERS, body };
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

/**
 * 名前まで引く人数の上限。`FOLLOWING_MAX` は2000だが、1回の呼び出しの
 * 6秒に 2000回の GetItem は収まらない（`Promise.all` の並列でも、
 * DynamoDB の応答と再送のぶんが積み上がる）。
 * 超えたぶんは返さず、`total` で件数だけ伝える。
 */
const FOLLOWING_PAGE = 50;

/**
 * 一覧からブロック関係の相手を落とす。
 *
 * **`blockUser` が両向きのフォローを外すので、普通はここに残らない。**
 * 残るのは `unfollowQuietly` の `.catch` が握った回だけ——だから「稀」で
 * あって「起きない」ではない。しかも**呼び手が違えば見える相手も違う**
 * （`hiddenUserIds` は「自分がブロックした人 ∪ 自分をブロックした人」）。
 * 他人のフォロワー一覧を開いたとき、**自分をブロックした人**が名前つきで
 * 並んでプロフィールへリンクする、というのが実際に起きる形。
 * ストーリー・通知・返信・閲覧者の4経路が既に通している判定なので、
 * ここだけ素通りさせる理由が無い（片側だけの防御を作らない）。
 *
 * **窓を切る前に落とす。** `slice(0, FOLLOWING_PAGE)` のあとで落とすと、
 * 落とした相手が50の枠を食って**生きている行が押し出される**
 * （`storyReplies.ts` が同じ理由で並びを変えた）。
 *
 * **数（`total`）は下げない——落ちた枝でも下げない。** あちらは
 * `followstats#` の独立したカウンタで「関係が実在するか」を数える。
 * ここで落とすのは「この呼び手に見せるか」＝別のことを数えている。
 *
 * **一度これを `total` のフォールバック（`stats` が読めなかったときの
 * 代わり）にも当ててしまった。** 本線だけ `followstats#` を見て、
 * フォールバックは `visible.length` ＝ふるいの後、という**同じ項目が
 * 枝によって別のものを数える**形になり、実際に画面が壊れた:
 *
 *     `readStats` がスロットル（`.catch` で握る実在の経路）
 *       ＋ 一覧の相手が全員ブロック関係（例: 自分をブロックした1人だけ）
 *     → total 0 / 行 0 → `FollowingSheet` は **「まだ誰もフォローして
 *       いません」**（すぐ上のコメントが名指しで避けている矛盾）
 *
 * フォールバックは `list.length`＝**ふるいの前**が正しい。
 *
 * 画面（`FollowingSheet`）は `total` と実際に描いた行数で見分ける作りなので、
 * **ずれる向きは既にある3つ**（50人で切る・埋め戻し前・
 * `updateFollowersQuietly` の握り潰し）と同じ「多い側」に揃う。
 *
 * **承知で残す副作用**: 一覧の相手が全員ブロック関係だと、
 * 「一覧はまだ用意できていません。上の数の方が新しい場合があります。」が
 * **待っても解消しない**（あの文言は埋め戻し待ち＝そのうち直る、を想定して
 * いる）。解消するには「見せない相手が居る」ことを画面に伝えることになり、
 * それはブロック関係そのものを教える。**言わない方を採る。**
 *
 * 読めなければ一覧をそのまま返す（`getStoryViewers` と同じ倒し方）。
 *
 * **`getStories` のように並列にはしない。** あちらは
 * `Promise.all([queryStories, hiddenUserIds])` だが、こちらは
 * 「一覧が空なら引きに行かない」を優先した——新しく登録した人の
 * フォロー一覧は空で、そこで毎回 GetItem を2回増やすより、
 * 一覧が実際にある回にだけ往復1回を払う方がよい。
 */
async function withoutHidden(list: string[], me: string | undefined, where: string): Promise<string[]> {
    if (!me || list.length === 0) return list;
    const hidden = await hiddenUserIds(me).catch((e) => {
        console.error(`${where}: ブロック一覧を読めませんでした:`, e);
        return new Set<string>();
    });
    return hidden.size === 0 ? list : list.filter((id) => !hidden.has(id));
}

/**
 * GET /users/{uid}/following — その人がフォローしている人の一覧。
 *
 * owner の指示「誰をフォローしてて、みたいなの見れるようにして」。
 *
 * **認証を要る側にした。** 数（`getFollowStats`）は未認証で返しているが、
 * こちらは (1) 人の繋がりそのもの、(2) 1回で最大50件の GetItem を撃つ
 * ——未認証の口を増やすと、同時実行10の枠を外から埋められる。
 * `publicLambdaRole.test.ts` が未認証の口を増やしにくくしているのは
 * まさにこの判断を毎回させるため。
 *
 * **フォロワー側は `getUserFollowers`（すぐ下）。** `followers#<uid>` を
 * 足すまでは引ける行が無かったが、いまはある（既にあるフォロー関係は
 * `scripts/backfill-followers.js` で埋め戻す）。
 *
 * **ブロックされていたら 404**（存在を教えない）。写真もプロフィールも
 * 静的サイトで誰にでも見えるので「隠す」効果は限定的だが、
 * `getStories` / `getStoryReplies` / `postComment` が全部通している判定を
 * 新しい口だけ素通りさせる理由が無い（片側だけの防御を作らない）。
 *
 * **退会した人は名前ではなく印で伝える。** 墓石の行には `displayName` が
 * 無いので `lookupDisplayNameIfSet` は `undefined` を返すが、画面はそれを
 * 「名前を設定していない人」と区別できず、**「旅人」という普通の行**として
 * 出して空のプロフィールへリンクしていた。しかも退会は自分の
 * `following#` しか消さないので（`account.ts`）、**他人の一覧には残り続ける**。
 * `getComments` / `getNotifications` / `getStoryReplies` と同じ
 * `deletedUserIds()`（60秒の控えつき）を通す。
 */
export const getUserFollowing: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = event.pathParameters?.uid;
    const me = getUserId(event);
    if (!uid || !isUserId(uid)) return jsonError(400, "不正なリクエスト");
    try {
        if (me && await isBlocked(uid, me)) return jsonError(404, "ユーザーが見つかりません");
        const [list, stats] = await Promise.all([
            readFollowing(uid),
            // **数が取れなくても一覧は返す。** 取れなかったら一覧の長さに
            // 落とす（今より悪くならない）。`followers#` 側も同じ
            readStats(uid).catch((e) => { console.error("getUserFollowing readStats:", e); return null; }),
        ]);
        const visible = await withoutHidden(list, me, "getUserFollowing");
        const page = visible.slice(0, FOLLOWING_PAGE);
        // 引くのは一覧が空でないときだけ（`getComments` と同じ）
        const gone = page.length > 0 ? await deletedUserIds() : new Set<string>();
        const users = await Promise.all(page.map(async (id) => {
            if (gone.has(id)) return { id, deleted: true };
            const name = await lookupDisplayNameIfSet(id);
            return name ? { id, name } : { id };
        }));
        return {
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            // **`total` は数（`followstats#`）、`listed` は一覧の長さ。**
            // 一度どちらも一覧の長さにして「形を揃えた」と書いたが、揃って
            // いたのは名前だけだった。ピル（`useFollow`）は `followstats#`
            // から出るので、上限（2000）で溢れた場合や `undoFollow` が
            // 落ちた回に**見出しの数字とピルの数字が食い違う**。
            // `following#` が空で数が 0 でないと、シートは
            // 「まだ誰もフォローしていません」——`followers#` 側で直した
            // 矛盾がそのまま残っていた
            // `listed` は**落としたあとの長さ**。この値の役目は「サーバーが
            // 50人で切ったぶん」と「一覧が追いついていないぶん」を外から
            // 区別することなので、呼び手に見せない相手を数えても意味がない
            body: JSON.stringify({ users, total: stats?.following ?? list.length, listed: visible.length }),
        };
    } catch (e) {
        console.error("getUserFollowing error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

/**
 * GET /users/{uid}/followers — その人をフォローしている人の一覧。
 *
 * `getUserFollowing` と対。倒し方も揃える（認証必要・ブロックは 404・
 * 退会した人は `deleted: true`・名前は50人まで・総数は `total`）。
 *
 * **数は `followstats#` が正。一覧は追いついていないことがある。**
 *
 *   - 埋め戻し（`scripts/backfill-followers.js`）を流すまで、既にある
 *     フォロー関係は行に入っていない＝**一覧は空だが数は5**
 *   - 上限（`FOLLOWING_MAX`）で古い方から溢れる
 *   - `updateFollowersQuietly` は失敗を握るので、1件だけ欠けることがある
 *
 * だから `total` に一覧の長さを返してはいけない。**返すのは数（`followers`）と
 * 一覧の長さ（`listed`）の両方。** 片方だけだと「5 フォロワー」と言いながら
 * 開くと「まだフォロワーはいません」になる（実際にそうなっていた）。
 *
 * **ただし画面は `listed` を読んでいない**（`FollowingSheet` は `total` と
 * 実際に描いた行数で見分ける。あちらのコメントが正）。ここに残して
 * あるのは、サーバーが50人で切っているぶんと「一覧が追いついていない」
 * ぶんを外から区別できる唯一の値だから。一度「画面はこの2つで見分ける」
 * と書いたが、それは事実ではない。
 */
export const getUserFollowers: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = event.pathParameters?.uid;
    const me = getUserId(event);
    if (!uid || !isUserId(uid)) return jsonError(400, "不正なリクエスト");
    try {
        if (me && await isBlocked(uid, me)) return jsonError(404, "ユーザーが見つかりません");
        const [res, stats] = await Promise.all([
            ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: followersId(uid) } })),
            // **数の Get が落ちただけで一覧を丸ごと失わせない。**
            // `Promise.all` に素で入れると、スロットル1回で 500 になる
            readStats(uid).catch((e) => { console.error("getUserFollowers readStats:", e); return null; }),
        ]);
        const list = usableUserIds(res.Item?.list, `followers#${uid}`);
        const visible = await withoutHidden(list, me, "getUserFollowers");
        const page = visible.slice(0, FOLLOWING_PAGE);
        const gone = page.length > 0 ? await deletedUserIds() : new Set<string>();
        const users = await Promise.all(page.map(async (id) => {
            if (gone.has(id)) return { id, deleted: true };
            const name = await lookupDisplayNameIfSet(id);
            return name ? { id, name } : { id };
        }));
        return {
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            // `total` は**数（`followstats#`）**。`listed` は落としたあとの
            // 一覧の長さ（`getUserFollowing` と揃える）
            body: JSON.stringify({ users, total: stats?.followers ?? list.length, listed: visible.length }),
        };
    } catch (e) {
        console.error("getUserFollowers error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

/**
 * GET /user/following — 自分がフォロー中の userId 一覧（認証必要・feed/ボタン用）。
 *
 * **ここには `withoutHidden` を当てない。意図的。**
 *
 * 「一覧を返す口は3つあるのに2つしか直していない」＝片方の入口、に見えるが、
 * この口だけは落とすと悪くなる:
 *
 *   - この一覧は**フォローボタンの状態の出どころ**（`lib/hooks/useFollow.ts`）。
 *     ここで隠すと `following#` に行が残ったまま画面は「フォローしていない」に
 *     なり、**本人が解除できなくなって残骸が永久に残る**
 *   - 「自分をブロックした人」の筋は**そもそも発生しない**——`blockUser` は
 *     `unfollowQuietly` を両向きに呼ぶので、相手が自分をブロックした時点で
 *     `following#<自分>` からその人は消える
 *   - 残るのは `unfollowQuietly` の `.catch` が握って落ちた回だけ。そのとき
 *     フォロー中フィードにその人の写真が出るが、**画面から解除できる**ので
 *     行き止まりにならない
 *
 * ＝「見せない」より「直せる」を採る。他人の一覧（`getUserFollowing` /
 * `getUserFollowers`）にはその人を直す手段が無いので、あちらは落とす。
 */
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
