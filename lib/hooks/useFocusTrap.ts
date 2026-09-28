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
 * `audio[controls]` も同じ理由で入れる（今は `controls` 付きの audio は
 * 無いが、足したときに同じ穴が開く）。`controls` の無いメディアは入れない
 * ——操作するものが無いので、空のタブストップが増えるだけ。
 *
 * **注意1: メディア要素を容器の末尾に置かないこと。** ブラウザは
 * `<video controls>` の再生・シーク・音量を shadow DOM の別々のタブストップに
 * するが、`document.activeElement` はどれも `<video>` 本体を返す。末尾に
 * 置くと、その中を進む Tab が「末尾からの折り返し」と誤判定されて
 * `preventDefault` され、**コントロールがキーボードから消える**——今回
 * 直した穴が向きを変えて再発する。先頭にある今の配置なら前向きは素通り。
 *
 * **注意2: `iframe` を入れても、クロスオリジンの埋め込みは閉じ込められない。**
 * このフックは親文書の keydown を見ているだけで、埋め込みの中に入った Tab は
 * 親に届かない。このサイトの埋め込み（Spotify・YouTube・Apple Music）は
 * 全部クロスオリジンなので、**埋め込みが入る容器ではトラップは保証できない**。
 * セレクタに `iframe` があることを「置いても大丈夫」と読まないこと。
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
 * **GalleryModal も含めて8か所すべてがこのフックを使う**（`7b2a4df` で移した。
 * 移す前に今の挙動を7本のテストに写し取り、それが旧実装で緑になることを
 * 確かめてから置き換えてある）。自前のトラップはもう残っていない。
 */
/**
 * **開いている閉じ込めの一覧**（開いた順）。Tab を扱うのは**最前面の1つだけ**。
 *
 * 全部が document の keydown を聞いているので、2つ同時に開くと取り合う
 * ——片方が「中に居ない」と引き戻し、もう片方も引き戻す。写真の拡大表示
 * （`?photo=` で開く）の上に「はじめる前に」が出ると、Tab を押すたびに
 * 同意画面の先頭へ戻され、**「同意してはじめる」にキーボードで届かなかった**
 * （閉じる手段はそれだけなので、出られない）。
 *
 * 最前面の決め方:
 *   - **優先度**が高い方（同意画面のように、何が後から開いても一番上に居るもの）
 *   - 片方がもう片方の中にある → **内側**が扱う（ストーリーの中の通報など。
 *     親子が同じコミットで開くと、effect は子が先に走るので「開いた順」は逆になる）
 *   - どちらも相手の中に無い → **後から開いた方**が扱う
 *
 * 優先度が要るのは、**クリックなしで裏に開くもの**があるから。新しく投稿した
 * 写真の共有リンクは、一覧が届いてから拡大表示が開く——同意画面より後に
 * 開くことがあり、「後から開いた方」だけで決めると裏の拡大表示が Tab を取った。
 */
const openTraps: Array<{ token: object; priority: number; getEl: () => HTMLElement | null }> = [];

/**
 * **優先度のある閉じ込め（同意画面）が開いているか。**
 *
 * 裏に開いている画面が自前で持つキー操作（拡大表示の矢印・Escape・`h` の
 * いいね、ストーリーの送り）は、これが真の間は何もしないこと。
 * 同意画面の裏で `h` を押すと、**見えない写真にいいねが付いていた**。
 */
export function isBehindPriorityOverlay(): boolean {
    return openTraps.some((t) => t.priority > 0);
}

function isFrontmost(token: object, el: HTMLElement): boolean {
    const mine = openTraps.findIndex((t) => t.token === token);
    const myPriority = openTraps[mine]?.priority ?? 0;
    for (let i = 0; i < openTraps.length; i++) {
        if (i === mine) continue;
        const other = openTraps[i].getEl();
        if (!other || other === el) continue;
        if (openTraps[i].priority !== myPriority) {
            if (openTraps[i].priority > myPriority) return false;
            continue;
        }
        if (el.contains(other)) return false;        // 内側に別の閉じ込めがある
        if (other.contains(el)) continue;            // 自分が内側
        if (i > mine) return false;                  // 後から開いた別の閉じ込め
    }
    return true;
}

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
    /**
     * 優先度（既定 0）。高いものが開いている間は、低いものは Tab を扱わず、
     * 開いたときにフォーカスも奪わない。**同意画面（`LegalGate`）だけが 1**
     */
    priority: number = 0,
): void {
    useEffect(() => {
        if (!active) return;
        // **容器がまだ無くても購読はする**（ここで早期 return しない）。
        // deps は `[active, ...]` なので、あとから容器が来ても再実行されない
        // ——つまり早期 return すると、そのモーダルは開いている間ずっと
        // トラップ無しで動く（Tab がオーバーレイの裏へ抜ける）。
        //
        // **ただし、今のこのリポジトリでこの分岐に入る呼び出しは無い。**
        // 全8か所は `{open && <div ref={...}>}` の形で、`active` が true に
        // なるコミットと容器が付くコミットが同じ。フックの中に一時的な
        // 目印を仕込んで**フルスイート1,913件を通したが0回**だった。
        // ここは「将来 `active` と容器が別コミットに割れたときに、
        // 静かに無効化されない」ための保険であって、実在の不具合の修正ではない。
        // （`02f2525` のコミットメッセージはこれを StoriesBar のフレークの
        // 原因だと書いたが、**測って外れていた**。フレークの原因は別。）
        //
        // 容器は**ハンドラの中で読み直す**。保険としてはこちらが本体で、
        // 容器が差し替わった場合にも正しい方を見る。
        const container = containerRef.current;

        // 閉じたときに戻す先。指定があればそちら、無ければ開いた瞬間の位置
        const restoreTo = restoreRef?.current ?? (document.activeElement as HTMLElement | null);

        // **上に優先度の高い閉じ込めが開いているなら、フォーカスを奪わない。**
        // 同意画面の裏で拡大表示が開いた瞬間に、見えない「前へ」へ移っていた
        const shadowed = openTraps.some((t) => t.priority > priority);
        // 中に既にフォーカスがあるなら動かさない（autoFocus を尊重する）
        if (container && !shadowed && !container.contains(document.activeElement)) {
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

        const token = {};
        openTraps.push({ token, priority, getEl: () => containerRef.current });
        const onKey = (e: KeyboardEvent) => {
            // 毎回読み直す。エフェクトの時点では空でも、押されるときには
            // 付いている（差し替わっていても正しい方を見る）
            const el = containerRef.current;
            if (!el) return;
            if (e.key !== "Tab") return;
            // 最前面の閉じ込めだけが扱う（上の `openTraps` を見よ）
            if (!isFrontmost(token, el)) return;
            // Ctrl+Tab / Cmd+Tab はブラウザやOSの操作。0件のときは境界に
            // 関係なく全部の Tab を止めるので、そこだけ当たりが広くなる
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            // **`offsetParent` で絞らない。** 「見えている要素だけ」に
            // したくなるが、`offsetParent` は `position: fixed` の要素でも
            // null になる——このモーダル群はまさに `fixed inset-0` なので、
            // 中身が全部「見えていない」と判定されて閉じ込めが効かなくなる。
            // （jsdom はレイアウトしないので常に null で、テストでも気づける）
            const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
            if (items.length === 0) {
                // **押せるものが無くても外へ出さない。** ここを素通しにして
                // いたので、上の「容器そのものへ入れる」分岐が
                // **その対象にした場面でトラップになっていなかった**
                // （コメントは「その後の Tab は下の閉じ込めが効く」と
                // 書いていたが、`el.contains(el)` は true なので
                // 引き戻しは発火せず、そのまま既定の Tab が通っていた）。
                // 押せるものが無くなるのは2つ:
                //   - HeaderNav を認証の判定中に開いたとき（中身が空）
                //   - 削除中・退会処理中（中のボタンが全部 disabled）
                // 後者は「削除中に Tab で裏の一覧へ抜ける」なので、
                // このフックを入れた動機そのもの。
                e.preventDefault();
                el.tabIndex = -1;
                el.focus({ preventScroll: true });
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            // **中に居ないときは先頭へ引き戻す。** ポータルで body の末尾に
            // 出るモーダルは、外から Tab で入ってくることがある
            if (!el.contains(document.activeElement)) {
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
            const i = openTraps.findIndex((t) => t.token === token);
            if (i >= 0) openTraps.splice(i, 1);
            // **トラップが実際に働いた時だけ戻す。** 容器が無いまま
            // `active` が false に戻った場合、フォーカスは一度も動かして
            // いないので、ここで戻すと**ユーザーが今いる場所から奪う**
            // （早期 return を外したことで新しく作った失敗。上の保険が
            // 逆向きに倒れる形）。容器があったなら、上の分岐のどちらかで
            // 必ずフォーカスは中に入っている（既に中にあったか、移したか）。
            if (!container) return;
            if (restoreTo && typeof restoreTo.focus === "function") restoreTo.focus();
        };
    }, [active, containerRef, restoreRef, initialFocusRef, priority]);
}
