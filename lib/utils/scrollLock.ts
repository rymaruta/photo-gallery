// 背景スクロールのロック（開いている数を数える）。
//
// **1つに寄せた。** もとは `app/components/GalleryModal/` にあり、
// `StoryViewer` と `HeaderNav` はそれぞれ `body.style.overflow = "hidden"`
// だけの自前実装を持っていた——**この実装のコメント自身が「overflow だけ
// では Instagram/Facebook の内蔵ブラウザや iOS Safari で背景スクロールが
// 止まらない」と書いている**方式で、しかも解除は無条件に `""` を書くので、
// 数えているこちらと同時に動くと整合しない（同じものを二度作らない）。
//
let _openModalCount = 0;
let _prevBodyOverflow: string | null = null;
let _prevBodyPaddingRight: string | null = null;
let _prevScrollY = 0;

export function lockBodyScroll() {
    if (_openModalCount === 0) {
        _prevScrollY = window.scrollY || window.pageYOffset || 0;
        _prevBodyOverflow = document.body.style.overflow ?? "";
        _prevBodyPaddingRight = document.body.style.paddingRight ?? "";

        // スクロールバーが消えることによる水平レイアウトシフトを防ぐ
        const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
        if (scrollBarWidth > 0) {
            document.body.style.paddingRight = `${scrollBarWidth}px`;
        }

        // position:fixed アプローチ:
        // overflow:hidden のみではInstagram/Facebook IABやiOS Safariで
        // バックグラウンドスクロールが止まらないケースに対応する
        document.body.style.overflow = "hidden";
        document.body.style.position = "fixed";
        document.body.style.top = `-${_prevScrollY}px`;
        document.body.style.left = "0";
        document.body.style.right = "0";
    }
    _openModalCount += 1;
}

export function unlockBodyScroll() {
    _openModalCount = Math.max(0, _openModalCount - 1);
    if (_openModalCount === 0) {
        document.body.style.overflow = _prevBodyOverflow ?? "";
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.left = "";
        document.body.style.right = "";
        document.body.style.paddingRight = _prevBodyPaddingRight ?? "";

        // position:fixed 解除後にスクロール位置を復元。
        //
        // **アニメーションさせない。** `globals.css` の
        // `html { scroll-behavior: smooth }` を拾うと、復元が滑走になる
        // ——実測（実ブラウザ・390x780・1440px スクロールしてメニューを開閉）:
        // 閉じた直後 y=2 → 73 → … と約0.7秒かけて戻る。写真を1枚見て閉じる
        // たびに、見ていた場所まで景色が流れる（位置そのものは最後には戻る）。
        //
        // `scrollTo({ behavior: "instant" })` ではなく**インラインの
        // `scroll-behavior` を一時的に上書きする**。知らない `behavior` の値を
        // 渡された実装は、例外を投げずに**スクロールごと黙って無視する**
        // （Chromium で実測: `behavior:"nope"` は y が動かない）。座標は
        // 素の `scrollTo(x, y)` で渡し、止めるのは CSS 側で行う
        const html = document.documentElement;
        const prevBehavior = html.style.scrollBehavior;
        html.style.scrollBehavior = "auto";
        window.scrollTo(0, _prevScrollY);
        html.style.scrollBehavior = prevBehavior;

        _prevBodyOverflow = null;
        _prevBodyPaddingRight = null;
        _prevScrollY = 0;
    }
}
