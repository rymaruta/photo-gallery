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
export function useFocusTrap(active: boolean, containerRef: RefObject<HTMLElement | null>): void {
    useEffect(() => {
        if (!active) return;
        const container = containerRef.current;
        if (!container) return;

        // 閉じたときに戻す先。開いた瞬間の位置を控える
        const restoreTo = document.activeElement as HTMLElement | null;

        // 中に既にフォーカスがあるなら動かさない（autoFocus を尊重する）
        if (!container.contains(document.activeElement)) {
            container.querySelector<HTMLElement>(FOCUSABLE)?.focus();
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
    }, [active, containerRef]);
}
