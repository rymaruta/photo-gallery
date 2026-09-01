// 静的エクスポート（output: "export"）での generateStaticParams の共通処理。

/**
 * 動的ルートの静的パラメータが空にならないようにする。
 *
 * Next.js の `output: "export"` は、動的ルートの `generateStaticParams()` が
 * **空配列を返すと「関数が定義されていない」扱いにしてビルドを落とす**:
 *
 *   Error: Page "/category/[category]" is missing "generateStaticParams()"
 *          so it cannot be used with "output: export" config.
 *
 * つまり「写真が1枚も無い状態ではサイトをビルドできない」。
 * 作りたての staging で実際に踏んだが、本番でも全写真を非公開にすれば同じ。
 *
 * 中身の無いページを1枚だけ出して、ビルドを通す。そのページは
 *   - 集約ページ … `CollectionPage` が該当0枚で `notFound()` を呼ぶので、
 *     `out/tag/_none.html` などの**中身は404ページ**になる。S3 は 200 で
 *     返すので「200 で 404 の本文」だが、404ページのクライアント側
 *     リダイレクトが `/?tags=_none` へ振るため行き止まりにはならない
 *   - 写真/ユーザー … 既存の「見つかりません」の分岐に落ちる
 * ので、実害は無い（誰もリンクしていない）。写真が1枚でもあれば
 * この分岐には入らない。
 *
 * ※ 以前ここには「該当0枚として『まだ写真がありません』を描画」と
 *   書いてあったが、実装は `notFound()` で**そうなっていない**。
 *   コメントを信じて0枚時の挙動を判断すると間違える。
 */
export const EMPTY_PARAM_PLACEHOLDER = "_none";

export function withPlaceholderParam<K extends string>(
    params: Array<Record<K, string>>,
    key: K,
): Array<Record<K, string>> {
    if (params.length > 0) return params;
    return [{ [key]: EMPTY_PARAM_PLACEHOLDER } as Record<K, string>];
}
