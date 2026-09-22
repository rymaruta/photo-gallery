import { useCallback, useEffect, useState } from "react";

/**
 * 画面下に固定したバーの**実際の高さ**を CSS 変数 `--bottom-bar-h` に出す。
 *
 * **決め打ちの 80px が合っていなかった。** `MiniPlayer` は
 * 「`p-4` + ボタン44px + 枠線 ≒ 80px」と見積もった定数で自分を持ち上げて
 * いたが、幅320px ではボタンのラベルが折り返してバーが 95px になり、
 * **3px 重なる**（同じ z-40 でミニプレイヤーが後に描かれるので、
 * 「公開」を押したつもりでプレイヤーのボタンが反応する）。
 *
 * 見積もりをやめて測る。あわせて `PAGES_WITH_BOTTOM_BAR` というページ名の
 * 一覧も要らなくなる——**バーがあるページかどうかは、バー自身が知っている**。
 * 二重管理が1つ減る（一覧に足し忘れると、静かに重なる）。
 *
 * `ResizeObserver` が無い環境（古いブラウザ・jsdom）では、マウント時に
 * 1回だけ測る。0 のままより、その高さのぶん逃がせる方がまし。
 *
 * **一度これを汎用化して `--mini-player-h` も出していたが、戻した。**
 * 読み手は画面右下に浮いていた「＋」だけで、それを撤去したので
 * 参照0になった（`c1361795` の次のコミット）。読み手の無い変数と、
 * 呼び手が1つしか無い汎用版は、次に読む人に嘘をつく。
 */
function usePublishedHeight(ref: React.RefObject<HTMLElement | null>, varName: string): void {
    useEffect(() => {
        const el = ref.current;
        if (!el || typeof document === "undefined") return;
        const root = document.documentElement;
        const publish = () => {
            root.style.setProperty(varName, `${el.offsetHeight}px`);
        };
        publish();
        const RO = typeof ResizeObserver !== "undefined" ? ResizeObserver : null;
        const ro = RO ? new RO(publish) : null;
        ro?.observe(el);
        return () => {
            ro?.disconnect();
            // **必ず消す。** 残すと、バーの無いページでミニプレイヤーが
            // 宙に浮いたままになる
            root.style.removeProperty(varName);
        };
    }, [ref, varName]);
}

export function useBottomBarHeight(ref: React.RefObject<HTMLElement | null>): void {
    usePublishedHeight(ref, "--bottom-bar-h");
}

/**
 * **画面ごとの下の帯**（「保存」「削除」「投稿する」）の高さを
 * `--page-bar-h` に出す。`body` がそのぶんも下に空ける（`globals.css`）。
 *
 * 🔴 **`--bottom-bar-h` とは別の変数にする。** 1つの変数に2人が書くと、
 * **あとから描いた方の高さで `MiniPlayer` が浮く**——`app/user/upload/page.tsx`
 * のコメントが名指ししている形で、実際に `app/user/edit/page.tsx` が
 * 書き手の2人目になっていた。
 *
 * **なぜ要るか（2026-09-22 に実測して足した）。** 帯を `bottom-0` から
 * タブバーの上へ逃がしたら、**今度はフッターの最後の行を覆った**
 * ——`body` の下の余白はタブバーのぶんしか無く、その上に乗った帯のぶんが
 * 足りない。いちばん下まで送った状態で、フッターの7本とも
 * `elementFromPoint` が帯を返した（`/user/highlights` と `/user/edit`）。
 * **押せない操作を1つ直して、別の押せない操作を作っていた。**
 *
 * 呼び手は3つ（投稿作成・写真の編集・ハイライト編集）。
 * このファイルの上の注記（「呼び手が1つしか無い汎用版は嘘をつく」）に
 * 照らしても、2つ目の名前を置く理由がある。
 */
export function usePageBarHeight(): (el: HTMLElement | null) => void {
    /**
     * 🔴 **ref ではなく「付いた瞬間に呼ばれる関数」を返す。**
     *
     * 最初 `useBottomBarHeight` と同じ形（`useRef` を渡す）で書いたら、
     * **変数が一度も出なかった**（実測: `--page-bar-h` が未設定のまま、
     * フッターは覆われたまま）。この3画面の帯は**読み込みが済んでから／
     * 写真を選んでから**描かれるので、マウント時の effect では
     * `ref.current` が `null` で、依存が変わらないので二度と走らない。
     * `BottomNav` は常に描かれるので、あちらは ref のままで足りる。
     *
     * 消えたときに変数を落とせるのも、この形の効き目
     * （投稿作成の帯は写真が0枚になると消える）。
     */
    const [el, setEl] = useState<HTMLElement | null>(null);
    useEffect(() => {
        if (!el || typeof document === "undefined") return;
        const root = document.documentElement;
        const publish = () => { root.style.setProperty("--page-bar-h", `${el.offsetHeight}px`); };
        publish();
        const RO = typeof ResizeObserver !== "undefined" ? ResizeObserver : null;
        const ro = RO ? new RO(publish) : null;
        ro?.observe(el);
        return () => {
            ro?.disconnect();
            root.style.removeProperty("--page-bar-h");
        };
    }, [el]);
    return useCallback((node: HTMLElement | null) => setEl(node), []);
}
