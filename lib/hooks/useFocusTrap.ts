"use client";

import { useEffect, type RefObject } from "react";

/** Tab で辿れる要素（GalleryModal が使っている並びと同じ） */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 開いている間、Tab をその中に閉じ込める。
 *
 * `aria-modal="true"` を付けたモーダルが5つあるが、Tab で外へ出られる。
 * オーバーレイの裏のボタンにフォーカスが行って、見えないまま Enter で
 * 押せてしまう（`/user/edit` の確認シートの裏は「保存する」）。
 * Escape は `useEscapeKey` で塞いだが、そちらは「出られない」問題で、
 * これは「外へ漏れる」問題。
 *
 * 併せて、開いたら中へフォーカスを移し、閉じたら元の要素へ戻す。
 * 戻さないとフォーカスが body に落ち、次の Tab がページ先頭からになる。
 *
 * **GalleryModal は移していない。** あちらは同じことを自前で持っているが、
 * 守っているテストが2本（いいねの POST/DELETE）しか無く、置き換えると
 * 壊しても気づけない。移すなら先に今の挙動を写し取るテストを書くこと。
 */
export function useFocusTrap(
    active: boolean,
    containerRef: RefObject<HTMLElement | null>,
    /**
     * 閉じたときの戻り先。渡さなければ「開いた瞬間にフォーカスがあった要素」。
     *
     * 明示できるところは明示する。ブラウザはボタンをクリックすると
     * フォーカスも当てるので既定でもたいてい合うが、**それに寄りかかると
     * 環境差で崩れる**（jsdom の click はフォーカスを当てない）。
     * メニューのように「戻る先が1つに決まっている」ものは渡すこと。
     */
    restoreRef?: RefObject<HTMLElement | null>,
): void {
    useEffect(() => {
        if (!active) return;
        const container = containerRef.current;
        if (!container) return;

        // 閉じたときに戻す先。指定があればそちら、無ければ開いた瞬間の位置
        const restoreTo = restoreRef?.current ?? (document.activeElement as HTMLElement | null);

        // 中に既にフォーカスがあるなら動かさない（autoFocus を尊重する）
        if (!container.contains(document.activeElement)) {
            const first = container.querySelector<HTMLElement>(FOCUSABLE);
            if (first) {
                first.focus();
            } else {
                // **押せるものが1つも無いときは容器そのものへ。**
                // HeaderNav は認証の判定中（Cognito のセッション確認）だと
                // 中身が空で、そこで開くとフォーカスが移らず「開いても
                // 入れない」が残っていた。容器に入れておけば、その後の Tab は
                // 下の閉じ込めが効く（activeElement が中に居るため）。
                container.tabIndex = -1;
                container.focus();
            }
        }

        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Tab") return;
            // **`offsetParent` で絞らない。** 「見えている要素だけ」に
            // したくなるが、`offsetParent` は `position: fixed` の要素でも
            // null になる——このモーダル群はまさに `fixed inset-0` なので、
            // 中身が全部「見えていない」と判定されて閉じ込めが効かなくなる。
            // （jsdom はレイアウトしないので常に null で、テストでも気づける）
            const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
            if (items.length === 0) return;
            const first = items[0];
            const last = items[items.length - 1];
            // **中に居ないときは先頭へ引き戻す。** ポータルで body の末尾に
            // 出るモーダルは、外から Tab で入ってくることがある
            if (!container.contains(document.activeElement)) {
                e.preventDefault();
                first.focus();
                return;
            }
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };

        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("keydown", onKey);
            if (restoreTo && typeof restoreTo.focus === "function") restoreTo.focus();
        };
    }, [active, containerRef, restoreRef]);
}
