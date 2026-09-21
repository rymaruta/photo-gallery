"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { userFetch } from "../utils/api";
import { log } from "../utils/log";

/**
 * 「行きたい場所」（撮影スポットの保存）。
 *
 * ## 写真の「保存」とは別物
 *
 * 保存するのが写真ではなく**場所**（`/location/<スラッグ>`）なので、
 * 入れ物も口も別（`api-user/src/savedSpots.ts` の `spots#<uid>`）。
 *
 * ## 端末の控えを持たない
 *
 * いいね（`useFavorites`）は未ログインでも押せるよう `localStorage` に
 * 控えを持ち、サーバーと**和**を取っている。こちらは持たない:
 *
 *  - 行きたい場所は**本人だけが見られる**もので、端末に残すと
 *    「同じ端末を使う別の人」に見える
 *  - 和を取る形は「サーバーから消えたのに端末には残る」が直らない
 *    （いいねはマーカーで直せるが、こちらは一覧が唯一の状態）
 *
 * 未ログインでは押せない。押すとログインへ送る（呼び出し側の役目）。
 *
 * ## 「まだ」「聞けなかった」「0件」を混ぜない
 *
 * `useMyServerLikes` と同じ立場。混ぜると、通信に失敗しただけの人に
 * 「保存した場所はまだありません」と言い切ることになる。
 */
export type SavedSpots = {
    /** 保存済みのスラッグ（新しい順）。取れていなければ空 */
    slugs: readonly string[];
    /** まだ分からない（ログイン確認中・取得中） */
    pending: boolean;
    /** 聞きに行って失敗した。**0件と混ぜない** */
    failed: boolean;
    /** そのスポットが保存済みか。**まだ分からない間は false を返さない** */
    isSaved: (slug: string) => boolean | undefined;
    /** 保存／解除を切り替える。返るのは「切り替えられたか」 */
    toggle: (slug: string) => Promise<boolean>;
    /** いま書き込み中のスラッグ（連打を止める） */
    busy: string | null;
    /** もう一度聞く */
    retry: () => void;
};

const EMPTY: readonly string[] = [];

/** 応答は**どの条件で投げたぶんか**を添えて持つ（`useMyServerLikes` と同形） */
type Fetched = { token: string; slugs: readonly string[]; failed: boolean };

export function useSavedSpots(isAuthenticated: boolean, authLoading: boolean): SavedSpots {
    const [fetched, setFetched] = useState<Fetched | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const [busy, setBusy] = useState<string | null>(null);
    const token = `${authLoading ? "?" : isAuthenticated ? "in" : "out"}|${reloadKey}`;

    const retry = useCallback(() => { setReloadKey((k) => k + 1); }, []);

    useEffect(() => {
        // 聞きに行くのはログイン中と決まったときだけ。「まだ分からない」
        // 「未ログイン」は**描画のときに決める**（ここで同期的に state を
        // 戻すと描画が1回増える——`react-hooks/set-state-in-effect`）
        if (authLoading || !isAuthenticated) return;

        let aborted = false;
        const controller = new AbortController();
        void (async () => {
            try {
                const res = await userFetch("/user/spots", { signal: controller.signal });
                if (aborted) return;
                if (!res.ok) { setFetched({ token, slugs: EMPTY, failed: true }); return; }
                const data = await res.json() as { slugs?: unknown };
                if (aborted) return;
                // 形が違う応答で画面ごと落とさない
                const list = Array.isArray(data.slugs)
                    ? data.slugs.filter((x): x is string => typeof x === "string")
                    : null;
                setFetched(list === null
                    ? { token, slugs: EMPTY, failed: true }
                    : { token, slugs: list, failed: false });
            } catch (e) {
                if (aborted) return;
                log.warn("行きたい場所の一覧を取得できませんでした:", e);
                setFetched({ token, slugs: EMPTY, failed: true });
            }
        })();
        return () => { aborted = true; controller.abort(); };
    }, [isAuthenticated, authLoading, token]);

    // **古い条件で得た答えは使わない**（ログインが確定した瞬間に、
    // 未ログインとして得た結果を出さない）
    const current = fetched && fetched.token === token ? fetched : null;
    const signedOut = !authLoading && !isAuthenticated;
    const pending = !signedOut && current === null;
    const slugs = current?.slugs ?? EMPTY;
    const saved = useMemo(() => new Set(slugs), [slugs]);

    const failed = current?.failed ?? false;

    /**
     * **分からない間は `false` を返さない。**
     *
     * `false` を返すと、ボタンが一瞬「行きたい」に見えてから「保存済み」に
     * 変わる——その一瞬に押すと**解除ではなく保存**が飛ぶ（サーバーは
     * 冪等なので壊れないが、押した人には何も起きていないように見える）。
     * `undefined` を返して、呼び出し側が「まだ」を描けるようにする。
     *
     * **聞きに行って失敗した回も `undefined`。** 一度 `pending` だけを見て
     * いたので、失敗すると `slugs` が空＝**保存済みのスポットが「行きたい」と
     * 表示され**、`aria-pressed=false` と読み上げられ、押すと解除ではなく
     * 保存が飛んでいた（＝その場で解除できない）。**「聞けなかった」と
     * 「保存していない」を混ぜない**、というこのファイルの宣言そのもの。
     */
    const isSaved = useCallback(
        (slug: string) => (pending || failed ? undefined : saved.has(slug)),
        [pending, failed, saved],
    );

    const toggle = useCallback(async (slug: string): Promise<boolean> => {
        if (!slug || busy) return false;
        // **状態が分からないうちは押させない**（上と同じ理由）。
        // 失敗した回も含む——保存済みかどうかを知らずに書くと、
        // 解除のつもりの一押しが保存になる
        if (pending || failed) return false;
        const add = !saved.has(slug);
        setBusy(slug);
        try {
            const res = add
                ? await userFetch("/user/spots", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ slug }),
                })
                : await userFetch(`/user/spots/${encodeURIComponent(slug)}`, { method: "DELETE" });
            if (!res.ok) return false;
            const data = await res.json() as { slugs?: unknown };
            // **サーバーが返した一覧をそのまま映す。** 自分で足し引きすると、
            // 失敗した回や上限で溢れた回に嘘の状態が残る
            const list = Array.isArray(data.slugs)
                ? data.slugs.filter((x): x is string => typeof x === "string")
                : null;
            if (list === null) return false;
            setFetched({ token, slugs: list, failed: false });
            return true;
        } catch (e) {
            log.warn("行きたい場所を更新できませんでした:", e);
            return false;
        } finally {
            setBusy(null);
        }
    }, [busy, pending, failed, saved, token]);

    return { slugs, pending, failed, isSaved, toggle, busy, retry };
}
