import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { userPublicFetch, userFetch, readApiError, AUTH_REQUIRED_MESSAGE } from "../utils/api";
import { log } from "../utils/log";

// フォロー。フォロー中の userId 集合はセッション内キャッシュ（useGoTo の goSet と同型）。

let followingCache: Set<string> | null = null;
let followingPromise: Promise<Set<string>> | null = null;
// リセットの世代。resetFollowingCache が進める。
// 取得の途中でリセットをまたいだら（＝ログアウトして別の人になったかも
// しれない）、その結果を**キャッシュに書かない**。これが無いと、
// 取得中にログアウト → リセット → 取得完了、の順で**前の人の
// フォロー一覧が空にしたはずのキャッシュへ書き戻り**、同じタブで
// 次にログインした人にそのまま使われる。
let cacheGen = 0;

/**
 * フォロー中の userId 集合。**失敗は投げる**（空 Set で誤魔化さない）。
 * 空 Set を返していた頃は、取得失敗が「誰もフォローしていない」と
 * 区別できず、フォロー中フィードが「0件」の空表示に化けていた（SW-b1）。
 * 呼び出し側が catch して見せ方を選ぶ:
 *   - useFollow のボタン: 失敗しても resolved を立てる（永久に押せない
 *     ボタンにしない——既存テストで固定済みの判断）
 *   - フォロー中フィード: 読み込み失敗＋再試行を出す
 */
export async function fetchFollowingSet(): Promise<Set<string>> {
    if (followingCache) return followingCache;
    if (!followingPromise) {
        const genAtStart = cacheGen;
        // finally 内で自分自身（p）と比較する。async 本体は先頭の await で
        // 必ずサスペンドするため、finally が走る時点で p は初期化済み。
        // ※ const の自己参照は tsc が TS2454 で弾く（実測）ので let + ! を使う
        let p!: Promise<Set<string>>;
        // eslint-disable-next-line prefer-const
        p = (async () => {
            try {
                const res = await userFetch("/user/following");
                if (!res.ok) throw new Error(`following fetch ${res.status}`);
                const data = await res.json() as { userIds?: string[] };
                const set = new Set(Array.isArray(data.userIds) ? data.userIds : []);
                if (genAtStart === cacheGen) followingCache = set;
                return set;
            } finally {
                // 自分がまだ「実行中の取得」である場合だけ下ろす。
                // 無条件に null にすると、リセット後に始まった**新しい取得**の
                // 参照を古い取得の完了が消してしまい、次の呼び出しが
                // 3本目の重複リクエストを投げる。
                if (followingPromise === p) followingPromise = null;
            }
        })();
        followingPromise = p;
    }
    return followingPromise;
}

/**
 * ログアウト時に必ず呼ぶこと。
 * これを呼ばないと、同じタブで別の人がログインしたときに
 * 前の人のフォロー一覧がそのまま使われる（ログアウトはクライアント遷移なので
 * モジュールの状態が生き残る）。
 */
export function resetFollowingCache() {
    cacheGen++;   // 走っている取得の結果を書き戻させない
    followingCache = null;
    followingPromise = null;
    counts.clear();
    // **購読は消さない。** 消すと、マウントされたままのコンポーネントは
    // targetUserId が変わるまで再購読せず、以後フォロー数が永久に
    // 更新されなくなる（購読の解除は useSyncExternalStore の cleanup が
    // 面倒を見るので、こちらから消す必要はそもそも無い）。
    // 今はログイン・ログアウトが必ずページ遷移を伴うので実害は出ていないが、
    // モーダルログインを入れた瞬間に踏む地雷だった。
    // 代わりに、いま購読している全員へ「値が変わった」と伝える
    // （counts を空にしたので、読み直すと 0 になる）。
    for (const [, fns] of listeners) {
        for (const fn of fns) fn();
    }
}

// ────────────────────────────────
// フォロー数の共有ストア
//
// 同じ相手について複数のコンポーネントが useFollow を呼ぶ（プロフィールでは
// 数字のピルとフォローボタンが別コンポーネント）。それぞれが自前の state を
// 持つと、押しても数が変わらないうえに同じ問い合わせが2回飛ぶ。
// targetUserId 単位で1つの値を共有する。
// ────────────────────────────────
type Counts = { followers: number; following: number };

const counts = new Map<string, Counts>();
const listeners = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<void>>();
/**
 * フォロー操作の結果。**理由まで返す。**
 *
 * 以前は `"error"` の一語だけだったので、サーバーが返し分けている
 * 503「確認できませんでした。時間をおいて…」・404「ユーザーが見つかりません」・
 * 400「自分はフォローできません」が全部「うまくいきませんでした」になっていた。
 * 別タブでログアウトしたときの「認証が必要です」も同じ扱いで、押し直しても
 * 直らないのに直りそうな文言が出ていた。
 */
export type FollowToggle = {
    result: "followed" | "unfollowed" | "auth-required" | "error";
    /** 出す文言（サーバー由来を優先）。auth-required では未設定のこともある */
    message?: string;
};

const FOLLOW_FAILED = "フォローの操作に失敗しました。時間をおいてもう一度お試しください";

const EMPTY: Counts = { followers: 0, following: 0 };

function emit(userId: string) {
    for (const fn of listeners.get(userId) ?? []) fn();
}

function setCounts(userId: string, next: Counts) {
    const cur = counts.get(userId);
    if (cur && cur.followers === next.followers && cur.following === next.following) return;
    counts.set(userId, next);
    emit(userId);
}

function subscribe(userId: string, fn: () => void): () => void {
    let set = listeners.get(userId);
    if (!set) { set = new Set(); listeners.set(userId, set); }
    set.add(fn);
    return () => { set?.delete(fn); };
}

/**
 * 相手のフォロー数を取り込む。同時に複数から呼ばれても問い合わせは1回。
 *
 * 中断（signal）は受け取らない。以前は呼び出し側の AbortSignal を
 * 渡していたが、問い合わせは共有しているのに signal は**最初の呼び出し元の
 * ものだけ**が効いていた。その1人が片付けを走らせると、まだ待っている
 * 他の購読者の分ごと中断される。しかも inflight の掃除は1マイクロタスク
 * 遅れるので、直後の再実行は「実行中」と見なされて何も投げ直さない。
 * 結果、フォロー数が 0 のまま固まる（リロードするまで直らない）。
 *
 * 結果は共有ストアに書くだけでコンポーネントの状態には触らないので、
 * 中断しなくても不整合は起きない。
 */
/**
 * 取り込みのやり直し。**一度落ちたら二度と出ない、を避ける。**
 *
 * 数は「取れるまで出さない」ようにしたので（`countsKnown`）、落ちたまま
 * だとピルが**永久に出ない**——このフックの effect は
 * `[targetUserId, isAuthenticated, withCounts]` でしか回らないので、
 * 再取得の契機が無い。失敗表示と再試行ボタンを持つ他の画面
 * （`followingError` / `followingReloadKey`）と違い、ここには導線が無い。
 * 画面を増やさずに直せるところ——待ってから撃ち直す——だけやる。
 * `releaseUsername`（api-user）と同じ、指数バックオフの起点。
 */
const COUNTS_RETRIES = 2;
const COUNTS_RETRY_BASE_MS = 400;

/**
 * 取り込みの世代。**押したあとに、押す前の数で上書きしない。**
 *
 * `loadCounts` が飛んでいる間にフォロー/解除すると、遅れて着地した
 * 「押す前の数」が楽観更新とサーバー確定値を巻き戻す（いいね側で
 * `touchedRef` を入れて潰したのと同じ形）。世代が進んでいたら書かない。
 */
const countsGen = new Map<string, number>();

function bumpCountsGen(userId: string): void {
    countsGen.set(userId, (countsGen.get(userId) ?? 0) + 1);
    // 走っている取り込みは**もう古い**ので、次の呼び出しが待たされない
    // ように札を外す（走っている方の書き込みは世代で弾かれる）
    inflight.delete(userId);
}

function loadCounts(userId: string): Promise<void> {
    const running = inflight.get(userId);
    if (running) return running;
    const gen = countsGen.get(userId) ?? 0;
    const p = (async () => {
        try {
            for (let attempt = 0; attempt <= COUNTS_RETRIES; attempt++) {
                try {
                    const res = await userPublicFetch(`/users/${encodeURIComponent(userId)}/follow`);
                    if (!res.ok) throw new Error(`status ${res.status}`);
                    const data = await res.json() as { followers?: number; following?: number };
                    // 押されたあとなら書かない（上の countsGen を見よ）
                    if ((countsGen.get(userId) ?? 0) !== gen) return;
                    setCounts(userId, {
                        followers: typeof data.followers === "number" ? data.followers : 0,
                        following: typeof data.following === "number" ? data.following : 0,
                    });
                    return;
                } catch {
                    if (attempt === COUNTS_RETRIES) return;   // 取れなければ出さない（0 とは言わない）
                    await new Promise((r) => setTimeout(r, COUNTS_RETRY_BASE_MS * 2 ** attempt));
                }
            }
        } finally {
            inflight.delete(userId);
        }
    })();
    inflight.set(userId, p);
    return p;
}

/**
 * @param withCounts フォロワー/フォロー中の数を取りに行くか。
 *   数を描かない呼び出し元（FollowAction＝ボタン単体）は false を渡す。
 *   以前は無条件に GET /users/<id>/follow を投げていて、ユーザー検索の
 *   結果一覧では**検索1回につき結果の件数ぶん**の問い合わせが飛んでいた
 *   （結果は画面のどこにも描かれない）。プロフィールでは数のピル
 *   （FollowButton）が別に true で呼ぶので、そちらの表示は変わらない。
 */
export function useFollow(targetUserId: string | undefined, isAuthenticated: boolean, withCounts = true) {
    const [isFollowing, setIsFollowing] = useState(false);
    const [pending, setPending] = useState(false);
    // フォロー中かどうかが**まだ分かっていない**間を表す。
    // 初期値の false を「未フォロー」と同じ扱いにしていた頃は、
    // 一覧を取り終える前にボタンが「フォロー」と出て、押すと
    // 既にフォロー済みなのに冪等の 200 が返る（画面は変わらない）。
    // ログイン済みなのに「ログインしてください」が出る場面もあった。
    // 分かるまでは押させない。
    const [resolved, setResolved] = useState(false);
    const busyRef = useRef(false);

    // 数は共有ストアから読む（同じ相手を見ている他のコンポーネントと同期する）。
    //
    // **「まだ分からない」と「0人」を混ぜない。** `?? EMPTY` で 0/0 を
    // 返していたので、取得が落ちた人のプロフィールは「フォロワー 0 /
    // フォロー中 0」と**言い切って**いた（失敗の印も再試行の導線も無い）。
    // 未取得は `undefined` のまま返し、描くかどうかは呼び出し側が決める
    // ——`usePhotos.loaded`・`followingLoaded`・この下の `resolved` と同じ形。
    const known = useSyncExternalStore(
        useCallback((fn) => (targetUserId ? subscribe(targetUserId, fn) : () => {}), [targetUserId]),
        useCallback(() => (targetUserId ? counts.get(targetUserId) : undefined), [targetUserId]),
        useCallback(() => undefined, []),
    );
    const { followers, following } = known ?? EMPTY;

    useEffect(() => {
        if (!targetUserId) return;
        let aborted = false;
        setResolved(false);
        if (withCounts) void loadCounts(targetUserId);
        if (isAuthenticated) {
            void fetchFollowingSet()
                .then((set) => { if (!aborted) setIsFollowing(set.has(targetUserId)); })
                // 失敗しても resolved は立てる（永久に押せないボタンに
                // しない）。fetchFollowingSet は失敗を投げるようになったが、
                // ボタン側のこの判断は変えない
                .catch(() => { /* 既定の「未フォロー」のまま */ })
                .finally(() => { if (!aborted) setResolved(true); });
        } else {
            // 未ログインなら「フォローしていない」が確定している
            setIsFollowing(false);
            setResolved(true);
        }
        return () => { aborted = true; };
    }, [targetUserId, isAuthenticated, withCounts]);

    const toggle = useCallback(async (): Promise<FollowToggle> => {
        if (!targetUserId) return { result: "error", message: FOLLOW_FAILED };
        if (!isAuthenticated) return { result: "auth-required" };
        if (busyRef.current) return { result: "error", message: FOLLOW_FAILED };
        busyRef.current = true;
        setPending(true);

        const was = isFollowing;
        // **知らない数を書かない。** `?? EMPTY` で 0/0 を土台にすると、
        // 数を描かない画面（ユーザー検索の `FollowAction`＝`withCounts=false`）
        // からフォローしただけで、共有ストアに `following: 0` が焼き付く
        // ——その足でプロフィールを開くと「フォロワー 501 / フォロー中 0」
        // と出る（実際は87人）。未取得なら触らないでおく。
        const before = counts.get(targetUserId);
        setIsFollowing(!was);
        // 楽観的更新。共有ストア経由なので数字のピルもその場で動く
        // 押した＝取り込み中の「押す前の数」はもう古い
        bumpCountsGen(targetUserId);
        if (before) {
            setCounts(targetUserId, { ...before, followers: Math.max(0, before.followers + (was ? -1 : 1)) });
        }

        try {
            const res = await userFetch(`/users/${encodeURIComponent(targetUserId)}/follow`, {
                method: was ? "DELETE" : "POST",
            });
            // サーバーは断る理由を返し分けている（503「確認できませんでした。
            // 時間をおいて…」/ 404「ユーザーが見つかりません」/ 400「自分は
            // フォローできません」）。番号だけ投げると全部「うまくいきません
            // でした」になり、直せるものも直せない案内になる。
            if (!res.ok) throw new Error(await readApiError(res, FOLLOW_FAILED));
            const data = await res.json() as { followers?: number };
            // ここも同じ——`following` を知らないまま `followers` だけ書くと、
            // 知らない方が 0 として残る
            const cur = counts.get(targetUserId) ?? before;
            if (typeof data.followers === "number" && cur) {
                setCounts(targetUserId, { ...cur, followers: data.followers });
            } else if (withCounts) {
                // **数を知らないまま押したときは、押したあとに取り直す。**
                // サーバーが返すのは `followers` だけで `following` は
                // 分からないので、片方だけ書くと知らない方が 0 で残る。
                // 取り込み中に押した場合もここに来る（走っていた取り込みは
                // 世代で弾かれるので、取り直さないと永久に出ない）。
                void loadCounts(targetUserId);
            }
            if (followingCache) {
                if (was) followingCache.delete(targetUserId); else followingCache.add(targetUserId);
            }
            return { result: was ? "unfollowed" : "followed" };
        } catch (e) {
            log.error("follow toggle error:", e);
            setIsFollowing(was);
            if (before) setCounts(targetUserId, before);
            // トークンが取れない（別タブでログアウト・リフレッシュ失効）は
            // 「うまくいきませんでした」では直らない。押し直させない
            const msg = e instanceof Error ? e.message : "";
            if (msg === AUTH_REQUIRED_MESSAGE) return { result: "auth-required", message: msg };
            return { result: "error", message: msg || FOLLOW_FAILED };
        } finally {
            busyRef.current = false;
            setPending(false);
        }
    }, [targetUserId, isFollowing, isAuthenticated, withCounts]);

    // `countsKnown` が false の間は followers/following を描かないこと
    // （0 と言い切らない）。
    return { isFollowing, followers, following, countsKnown: known !== undefined, pending, resolved, toggle };
}
