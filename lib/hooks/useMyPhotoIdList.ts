import { useCallback, useEffect, useState } from "react";
import { userFetch } from "../utils/api";
import { log } from "../utils/log";

/**
 * 「自分の◯◯した一覧」をサーバーから引く共通部。
 *
 * ## なぜ共通なのか
 *
 * いいね（`likes#<uid>`）・保存（`saves#<uid>`）・行きたい場所
 * （`spots#<uid>`）は、サーバー側では**同じ形の1行**
 * （新しい順のリスト＋`rev`）で、書き込みの規則も
 * `api-user/src/userList.ts` 1つに寄せてある。引く側だけ3つ書くと、
 * 「まだ／失敗／0件」の扱いが1つだけ直って静かにずれる。
 *
 * 保存を足すときに `useMyServerLikes` を丸ごと写しかけたので、
 * **写す前にここへ切り出した**（サーバーで `userList.ts` を切り出したのと
 * 同じ理由）。それでも**3つ目の写しが後から入っていた**
 * （`useSavedSpots`——切り出しと同じ回に書かれたので、間に合わなかった）。
 * 今はあれも包み。
 *
 * ## 「写真のID」に限らない
 *
 * 名前は切り出した当時のまま（`photoIds`）だが、**中身は文字列のID一覧**で、
 * 行きたい場所は撮影地のスラッグを入れる。呼び出し側の包みが
 * `slugs` のような名前に付け替えるので、画面はこの名前を見ない。
 *
 * ## 状態を混ぜない
 *
 * 「まだ聞いていない」「聞けなかった」「0件」を1つにしない。
 * 混ぜると、通信に失敗しただけの人に「まだありません」と言い切ることに
 * なる（この台帳が何度も踏んでいる形）。
 */
export type MyPhotoIdList = {
    /** 取れたぶん（取れていなければ空） */
    photoIds: readonly string[];
    /** まだ分からない（ログイン確認中・取得中） */
    pending: boolean;
    /** 聞きに行って失敗した。**0件と混ぜない** */
    failed: boolean;
    /** もう一度聞く */
    retry: () => void;
};

/**
 * 読むだけの形に、**書き込みの応答を映す口**を足したもの。
 *
 * いいねと保存は「押す側」が別のフック（`usePhotoLikes` / `usePhotoSave`）で、
 * 一覧の更新は `retry()`（もう一度引く）で足りている。行きたい場所は
 * 押す口が一覧と同じフックにあり、**サーバーが返した一覧をそのまま映す**
 * （自分で足し引きすると、失敗した回や上限で溢れた回に嘘の状態が残る）。
 * そのために1つだけ口を開ける。
 *
 * **読むだけの包みはこれを返さない**（`MySaves` / `MyServerLikes` は
 * `MyPhotoIdList` のまま）——書き換える口を、書き換えない画面に見せない。
 */
export type MyPhotoIdListWithApply = MyPhotoIdList & {
    /** サーバーが返した一覧に置き換える（`failed` は下りる） */
    apply: (ids: readonly string[]) => void;
};

const EMPTY: readonly string[] = [];

/**
 * 応答は**どの条件で投げたぶんか**を添えて持つ。
 *
 * エフェクトの中で同期的に `setState` すると、条件が変わるたびに
 * 余分な描画が1回増える（`react-hooks/set-state-in-effect`）。
 * 投げた条件（`token`）を一緒に持てば、**古い応答は描画のときに捨てられる**
 * ので、状態を戻すための同期 `setState` が要らない。
 */
type Fetched = { token: string; photoIds: readonly string[]; failed: boolean };

/**
 * @param path ユーザーAPI の経路（`/user/likes`・`/user/saves`・`/user/spots`）
 * @param label 失敗をログに残すときの言い方
 * @param field 応答のどの欄に一覧が入っているか。既定は `photoIds`
 *              （`/user/spots` だけ `slugs` を返す）。
 *
 *              **候補を型で絞る。** `string` にしていると `"slug"`（複数形
 *              忘れ）が型検査を通り、`data[field]` が `undefined` →
 *              `failed: true` になる——画面には「取得できませんでした」と
 *              再試行ボタンが出て、**押しても永久に直らない**。通信障害と
 *              見分けが付かないので調べる側も遠回りする。ついでに
 *              `"constructor"` のようなプロトタイプ鎖の名前も塞がる
 */
export function useMyPhotoIdList(
    path: string,
    label: string,
    isAuthenticated: boolean,
    authLoading: boolean,
    field: "photoIds" | "slugs" = "photoIds",
): MyPhotoIdListWithApply {
    const [fetched, setFetched] = useState<Fetched | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    // **経路も条件に入れる。** 入れないと、同じ画面で2つ使ったときに
    // 片方の応答をもう片方が「自分のぶん」として描きうる
    const token = `${path}|${authLoading ? "?" : isAuthenticated ? "in" : "out"}|${reloadKey}`;

    const retry = useCallback(() => { setReloadKey((k) => k + 1); }, []);

    /**
     * 書き込みの応答を映す。**いま投げている条件（`token`）で置く**
     * ——置かないと、ログインが確定した瞬間に古い条件で得た一覧を
     * 描くことになる（取得の側と同じ判断）。
     */
    const apply = useCallback((ids: readonly string[]) => {
        setFetched({ token, photoIds: ids, failed: false });
    }, [token]);

    useEffect(() => {
        // 聞きに行くのはログイン中と決まったときだけ。
        // 「まだ分からない」「未ログイン」は**描画のときに決める**
        // ——ここで同期的に state を戻すと描画が1回増える
        // （`react-hooks/set-state-in-effect`）
        if (authLoading || !isAuthenticated) return;

        let aborted = false;
        const controller = new AbortController();
        void (async () => {
            try {
                const res = await userFetch(path, { signal: controller.signal });
                if (aborted) return;
                if (!res.ok) { setFetched({ token, photoIds: EMPTY, failed: true }); return; }
                const data = await res.json() as Record<string, unknown>;
                if (aborted) return;
                // 形が違う応答で画面ごと落とさない（`usableRows` と同じ判断）
                const raw = data[field];
                const list = Array.isArray(raw)
                    ? raw.filter((x): x is string => typeof x === "string")
                    : null;
                setFetched(list === null
                    ? { token, photoIds: EMPTY, failed: true }
                    : { token, photoIds: list, failed: false });
            } catch (e) {
                if (aborted) return;
                log.warn(`${label}を取得できませんでした:`, e);
                setFetched({ token, photoIds: EMPTY, failed: true });
            }
        })();
        return () => { aborted = true; controller.abort(); };
    }, [path, label, field, isAuthenticated, authLoading, token]);

    // **古い条件で得た答えは使わない**（ログインが確定した瞬間に、
    // 未ログインとして得た結果を出さない）
    const current = fetched && fetched.token === token ? fetched : null;
    // 未ログインは「聞くまでもなく0件」＝待たせない。
    // ログイン確認中は「まだ」——ここを未ログインと同じに倒すと、
    // セッション復元の往復中に「まだありません」と出る
    const signedOut = !authLoading && !isAuthenticated;
    return {
        photoIds: current?.photoIds ?? EMPTY,
        pending: !signedOut && current === null,
        failed: current?.failed ?? false,
        retry,
        apply,
    };
}
