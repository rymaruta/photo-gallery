import { useEffect } from "react";

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
 */
export function useBottomBarHeight(ref: React.RefObject<HTMLElement | null>): void {
    useEffect(() => {
        const el = ref.current;
        if (!el || typeof document === "undefined") return;
        const root = document.documentElement;
        const publish = () => {
            root.style.setProperty("--bottom-bar-h", `${el.offsetHeight}px`);
        };
        publish();
        const RO = typeof ResizeObserver !== "undefined" ? ResizeObserver : null;
        const ro = RO ? new RO(publish) : null;
        ro?.observe(el);
        return () => {
            ro?.disconnect();
            // **必ず消す。** 残すと、バーの無いページでミニプレイヤーが
            // 宙に浮いたままになる
            root.style.removeProperty("--bottom-bar-h");
        };
    }, [ref]);
}
