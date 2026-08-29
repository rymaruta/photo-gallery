"use client";

import { useEffect, type RefObject } from "react";

/**
 * Tab で辿れる要素。
 *
 * **`video[controls]` を落とすと、閉じ込めが穴になる。** ストーリーの投稿
 * プレビューは `<video controls>` を容器の先頭に置いている。ここから漏れると
 *   - 前向き: 最後の要素から先頭へ折り返すので、**動画に一周しても届かない**
 *     （トラップを付ける前は、文書を一周すれば届いていた）。投稿前に動画を
 *     確かめる唯一の手段が、キーボードから消える
 *   - 後ろ向き: 動画にフォーカスがある状態の Shift+Tab は、`first` でも
 *     `last` でもないのでどの分岐にも当たらず、**そのまま外へ抜ける**
 * `audio[controls]` と `iframe` も同じ理由で入れる（今は使っていないが、
 * 足したときに同じ穴が開く）。
 */
export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], audio[controls], iframe, [tabindex]:not([tabindex="-1"])';

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
    /**
     * 開いたときに最初にフォーカスする要素。渡さなければ DOM 順の先頭。
     *
     * GalleryModal は「前へ」ボタンを指名している（先頭は別の要素）。
     * 指名を無視すると、開いた瞬間にフォーカスが当たる場所が変わる。
     */
    initialFocusRef?: RefObject<HTMLElement | null>,
): void {
    useEffect(() => {
        if (!active) return;
        const container = containerRef.current;
        if (!container) return;

        // 閉じたときに戻す先。指定があればそちら、無ければ開いた瞬間の位置
        const restoreTo = restoreRef?.current ?? (document.activeElement as HTMLElement | null);

        // 中に既にフォーカスがあるなら動かさない（autoFocus を尊重する）
        if (!container.contains(document.activeElement)) {
            const first = initialFocusRef?.current ?? container.querySelector<HTMLElement>(FOCUSABLE);
            if (first) {
                // **`preventScroll` を付ける。** `focus()` は既定でその要素が
                // 見えるまでページをスクロールする。GalleryModal は
                // このフックの**あと**に `lockBodyScroll()` を流すので、
                // ここで1pxでも動くと「開く前のスクロール位置」がずれた値で
                // 控えられ、閉じたときに違う場所へ戻る。
                first.focus({ preventScroll: true });
            } else {
                // **押せるものが1つも無いときは容器そのものへ。**
                // HeaderNav は認証の判定中（Cognito のセッション確認）だと
                // 中身が空で、そこで開くとフォーカスが移らず「開いても
                // 入れない」が残っていた。Tab も下で押さえる（そちらを
                // 素通しにしていたので、これだけでは閉じ込められなかった）。
                container.tabIndex = -1;
                container.focus({ preventScroll: true });
            }
        }

        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Tab") return;
            // Ctrl+Tab / Cmd+Tab はブラウザやOSの操作。0件のときは境界に
            // 関係なく全部の Tab を止めるので、そこだけ当たりが広くなる
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            // **`offsetParent` で絞らない。** 「見えている要素だけ」に
            // したくなるが、`offsetParent` は `position: fixed` の要素でも
            // null になる——このモーダル群はまさに `fixed inset-0` なので、
            // 中身が全部「見えていない」と判定されて閉じ込めが効かなくなる。
            // （jsdom はレイアウトしないので常に null で、テストでも気づける）
            const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
            if (items.length === 0) {
                // **押せるものが無くても外へ出さない。** ここを素通しにして
                // いたので、上の「容器そのものへ入れる」分岐が
                // **その対象にした場面でトラップになっていなかった**
                // （コメントは「その後の Tab は下の閉じ込めが効く」と
                // 書いていたが、`container.contains(container)` は true なので
                // 引き戻しは発火せず、そのまま既定の Tab が通っていた）。
                // 押せるものが無くなるのは2つ:
                //   - HeaderNav を認証の判定中に開いたとき（中身が空）
                //   - 削除中・退会処理中（中のボタンが全部 disabled）
                // 後者は「削除中に Tab で裏の一覧へ抜ける」なので、
                // このフックを入れた動機そのもの。
                e.preventDefault();
                container.tabIndex = -1;
                container.focus({ preventScroll: true });
                return;
            }
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
    }, [active, containerRef, restoreRef, initialFocusRef]);
}
