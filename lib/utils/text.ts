/**
 * 長さを切る。**サロゲートペアの途中では切らない。**
 *
 * `slice(0, max)` は UTF-16 のコードユニットで切るので、末尾が絵文字だと
 * その半分だけが残り、UTF-8 に落ちた時点で **U+FFFD（`�`）** になる。
 * 保存側は `api-user/src/sanitize.ts` の同名関数が同じことをしている
 * （2つのパッケージはビルドを共有しないので、小さく複製する方針）。
 *
 * 数えるのはコードユニットのまま。書記素で数え直すと、画面の `maxLength`
 * （HTML はコードユニットで数える仕様）と食い違う。
 */
export function truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    const cut = s.slice(0, max);
    const last = cut.charCodeAt(cut.length - 1);
    // 上位サロゲート（下位が続かないと壊れる）で終わっていたら1つ削る
    return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * 孤立サロゲート（ペアの片割れ）を落とす。
 *
 * `encodeURIComponent` はこれを見ると `URIError` で投げる。URL に載る値
 * （slug・共有テキスト）に混ざると、その場で例外になる——静的ビルドなら
 * **ビルドごと止まる**。切り詰め側（`truncate`）は入口を塞いだが、
 * **既に保存されている値には効かない**ので、URL を組む側でも落とす。
 *
 * ルックビハインドを使わない書き方にしてある。正当なペアを先に食わせて
 * そのまま返し、残った片割れだけを捨てる（Safari 16.3 以前でも動く）。
 */
export function stripLoneSurrogates(s: string): string {
    return s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g,
        (m) => (m.length === 2 ? m : ""));
}
