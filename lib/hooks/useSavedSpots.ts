"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { userFetch } from "../utils/api";
import { log } from "../utils/log";
import { useMyPhotoIdList } from "./useMyPhotoIdList";

/**
 * 「行きたい場所」（撮影スポットの保存）。
 *
 * ## 一覧を引く部分は `useMyPhotoIdList`（3つ目の写しをやめた）
 *
 * サーバーは `spots#<uid>` を `likes#<uid>` / `saves#<uid>` と**同じ形の1行**
 * （新しい順のリスト＋`rev`）で持ち、書き込みの規則も `userList.ts` 1つに
 * 寄せてある。ところが引く側は、切り出した共通部（`useMyPhotoIdList`）と
 * `useMyServerLikes`（その薄い包み）に加えて、**ここに3つ目の写し**が
 * あった——「まだ／聞けなかった／0件」を混ぜない扱い・投げた条件を添えて
 * 持つ仕掛け・中断の後始末が、同じ形で二重に書かれていた。
 * だから**ここも包みにする**。振る舞いは変えていない。
 *
 * 違うのは2つだけ:
 *
 *  - 応答の欄が `slugs`（写真のIDではなく撮影地のスラッグ）。
 *    共通部に欄の名前を渡す
 *  - **押す口がこのフックの中にある。** いいね・保存は押す側が別のフック
 *    （`usePhotoLikes` / `usePhotoSave`）なので一覧は読むだけだが、
 *    こちらは `toggle` がサーバーの返した一覧をそのまま映す。
 *    そのための口が共通部の `apply`
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
 * `useMyServerLikes` と同じ立場——というより、**同じ実装**になった。
 * 混ぜると、通信に失敗しただけの人に「保存した場所はまだありません」と
 * 言い切ることになる。
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

export function useSavedSpots(isAuthenticated: boolean, authLoading: boolean): SavedSpots {
    // **一覧を引くのは共通部1つ。** 経路と、応答の欄（`slugs`）だけが違う
    const { photoIds: slugs, pending, failed, retry, apply } = useMyPhotoIdList(
        "/user/spots", "行きたい場所の一覧", isAuthenticated, authLoading, "slugs",
    );
    const [busy, setBusy] = useState<string | null>(null);
    /**
     * **連打の鍵は `ref` で持つ。**
     *
     * `busy`（state）で見ていたが、`toggle` の閉包が持つのは**その描画時の
     * 値**なので、同じフレームの2回押しはどちらも `busy === null` を見て
     * **2本とも飛ぶ**（`setBusy` が反映されるのは次の描画）。
     * `ref` なら同期的に立つ。state の方は**画面に出すため**に残す。
     */
    const writing = useRef<string | null>(null);

    const saved = useMemo(() => new Set(slugs), [slugs]);

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
        if (!slug || writing.current) return false;
        // **状態が分からないうちは押させない**（上と同じ理由）。
        // 失敗した回も含む——保存済みかどうかを知らずに書くと、
        // 解除のつもりの一押しが保存になる
        if (pending || failed) return false;
        const add = !saved.has(slug);
        writing.current = slug;
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
            apply(list);
            return true;
        } catch (e) {
            log.warn("行きたい場所を更新できませんでした:", e);
            return false;
        } finally {
            writing.current = null;
            setBusy(null);
        }
    }, [pending, failed, saved, apply]);

    return { slugs, pending, failed, isSaved, toggle, busy, retry };
}
