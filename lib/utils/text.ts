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
    return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
