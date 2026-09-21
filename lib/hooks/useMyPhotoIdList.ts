import { useCallback, useEffect, useState } from "react";
import { userFetch } from "../utils/api";
import { log } from "../utils/log";

/**
 * 「自分の◯◯した写真のID一覧」をサーバーから引く共通部。
 *
 * ## なぜ共通なのか
 *
 * いいね（`likes#<uid>`）と保存（`saves#<uid>`）は、サーバー側では
 * **同じ形の1行**（新しい順のリスト＋`rev`）で、書き込みの規則も
 * `api-user/src/userList.ts` 1つに寄せてある。引く側だけ2つ書くと、
 * 「まだ／失敗／0件」の扱いが片方だけ直って静かにずれる。
 *
 * 保存を足すときに `useMyServerLikes` を丸ごと写しかけたので、
 * **写す前にここへ切り出した**（サーバーで `userList.ts` を切り出したのと
 * 同じ理由）。
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
 * @param path ユーザーAPI の経路（`/user/likes`・`/user/saves`）
 * @param label 失敗をログに残すときの言い方
 */
export function useMyPhotoIdList(
    path: string,
    label: string,
    isAuthenticated: boolean,
    authLoading: boolean,
): MyPhotoIdList {
    const [fetched, setFetched] = useState<Fetched | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    // **経路も条件に入れる。** 入れないと、同じ画面で2つ使ったときに
    // 片方の応答をもう片方が「自分のぶん」として描きうる
    const token = `${path}|${authLoading ? "?" : isAuthenticated ? "in" : "out"}|${reloadKey}`;

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
                const res = await userFetch(path, { signal: controller.signal });
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
                log.warn(`${label}を取得できませんでした:`, e);
                setFetched({ token, photoIds: EMPTY, failed: true });
            }
        })();
        return () => { aborted = true; controller.abort(); };
    }, [path, label, isAuthenticated, authLoading, token]);

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
    };
}
