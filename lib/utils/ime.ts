/**
 * 日本語入力（IME）の変換中に来たキーか。
 *
 * **変換確定の Enter は、ページには普通の Enter として届く。**
 * Chromium で実測した形:
 *
 *     変換中の確定 Enter … keydown key="Enter" keyCode=13 isComposing=true
 *     確定後の Enter     … keydown key="Enter" keyCode=13 isComposing=false
 *
 * つまり `e.key === "Enter"` だけを見るコードは、**「きょう」を「今日」に
 * 変換した瞬間にも動く**。日本語で入力する人は必ず踏む——このサイトの
 * 主対象が日本語なので、実質すべての利用者が対象になる。
 * Escape も同じで、変換中の Escape は「変換の取り消し」なのに、
 * ページからは普通の Escape に見える。
 *
 * **`keyCode === 229` は保険ではない。Safari（mac / iOS）ではこちらが本命。**
 * Safari は確定の Enter を `compositionend` の**あと**に送るので、そのときは
 * `isComposing=false`・`keyCode=229` になる。`isComposing` だけに簡略化すると、
 * Safari で変換を確定した瞬間に送信される。両方見ること（#37）。
 *
 * **ネイティブのイベントを渡すこと。** React の合成イベントは
 * `isComposing` を持たないので、`onKeyDown={(e) => ... isImeKey(e.nativeEvent)}`
 * の形で使う（`document.addEventListener` 側はそのまま渡せる）。
 *
 * 既に正しく書けている場所（`FilterBar` と `/users/search` の検索欄）は
 * `compositionstart`/`compositionend` を自分で持っている。あちらは
 * 「変換中は流さない・確定したら流す」という**打鍵ごとの制御**が要るので
 * 形が違う。この関数は「このキーで実行してよいか」を見るためのもの。
 */
export function isImeKey(e: { isComposing: boolean; keyCode: number }): boolean {
    return e.isComposing || e.keyCode === 229;
}
