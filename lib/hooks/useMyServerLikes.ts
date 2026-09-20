import { useCallback, useEffect, useState } from "react";
import { userFetch } from "../utils/api";
import { log } from "../utils/log";

/**
 * 自分がいいねした写真のID一覧（サーバー側）。
 *
 * ## なぜ要るか
 *
 * 「いいねした写真」のページは**この端末の localStorage しか見ていなかった**
 * （`useFavorites`）。スマホで押して PC で開くと0件で、しかも同じ写真の
 * ページは**マーカーを見る**ので「いいね済み」と出る——同じアカウントで
 * 画面どうしが食い違っていた（owner の報告）。
 *
 * サーバーは `likes#<uid>` に新しい順のIDを1行で持つ（`api-user/src/likes.ts`）。
 * 引くのは GetItem 1回。
 *
 * ## 状態を混ぜない
 *
 * 「まだ聞いていない」「聞けなかった」「0件」を1つにしない。
 * 混ぜると、通信に失敗しただけの人に「いいねした写真はまだありません」と
 * 言い切ることになる（この台帳が何度も踏んでいる形）。
 */
export type MyServerLikes = {
    /** 取れたぶん（取れていなければ空） */
    photoIds: readonly string[];
    /** まだ分からない（ログイン確認中・取得中） */
    pending: boolean;
    /** 聞きに行って失敗した。**0件と混ぜない** */
    failed: boolean;
    /** もう一度聞く */
    retry: () => void;
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

export function useMyServerLikes(isAuthenticated: boolean, authLoading: boolean): MyServerLikes {
    const [fetched, setFetched] = useState<Fetched | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const token = `${authLoading ? "?" : isAuthenticated ? "in" : "out"}|${reloadKey}`;

    const retry = useCallback(() => { setReloadKey((k) => k + 1); }, []);

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
                const res = await userFetch("/user/likes", { signal: controller.signal });
                if (aborted) return;
                if (!res.ok) { setFetched({ token, photoIds: EMPTY, failed: true }); return; }
                const data = await res.json() as { photoIds?: unknown };
                if (aborted) return;
                // 形が違う応答で画面ごと落とさない（`usableRows` と同じ判断）
                const list = Array.isArray(data.photoIds)
                    ? data.photoIds.filter((x): x is string => typeof x === "string")
                    : null;
                setFetched(list === null
                    ? { token, photoIds: EMPTY, failed: true }
                    : { token, photoIds: list, failed: false });
            } catch (e) {
                if (aborted) return;
                log.warn("いいねした写真の一覧を取得できませんでした:", e);
                setFetched({ token, photoIds: EMPTY, failed: true });
            }
        })();
        return () => { aborted = true; controller.abort(); };
    }, [isAuthenticated, authLoading, token]);

    // **古い条件で得た答えは使わない**（ログインが確定した瞬間に、
    // 未ログインとして得た結果を出さない）
    const current = fetched && fetched.token === token ? fetched : null;
    // 未ログインは「聞くまでもなく0件」＝待たせない（端末の控えが答え）。
    // ログイン確認中は「まだ」——ここを未ログインと同じに倒すと、
    // セッション復元の往復中に「いいねした写真はまだありません」と出る
    const signedOut = !authLoading && !isAuthenticated;
    return {
        photoIds: current?.photoIds ?? EMPTY,
        pending: !signedOut && current === null,
        failed: current?.failed ?? false,
        retry,
    };
}
