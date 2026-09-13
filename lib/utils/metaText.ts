/**
 * 検索結果・SNS のプレビュー・フィードに出す「1行の文」にする。
 *
 * **利用者が書いた説明には改行が入る**（段落の中で改行する人がいる）。
 * それを `<meta name="description">` や `og:description` に素で入れると、
 * 属性値の中に生の改行が残る。実ビルドで数えた:
 *
 *     description / og: / twitter:   15 / 420（写真ページ5枚 × 3）
 *     JSON-LD の description・caption 8
 *     sitemap-images.xml の caption   4
 *     feed.xml の description         4
 *
 * **同じ規則が既にリポジトリにある**——`app/users/[id]/page.tsx` は
 * 自己紹介を `replace(/\s+/g, " ").trim()` してから説明文にしている。
 * 写真の説明を通す4経路だけ素通りだった（台帳の型「隣に正しい形があるのに
 * 片方だけ」）。規則が散らばると静かにずれるので、ここ1つに置く。
 *
 * **何も import しない。** `seo.ts` も `feed.xml` も `sitemap-images.xml` も
 * 写真ページも読むので、依存を持つと輪になりうる
 * （`nameVariants.ts`・`exifDisplay.ts` と同じ理由）。
 *
 * **`\s` が畳むのは空白の類だけ**——半角/全角スペース・改行・タブのほか
 * NBSP と BOM も含む。ZWSP（U+200B）は `\s` に入らないので残る。
 * 台帳が「ZWSP・NBSP・BOM は保存する値からは落とさない」と決めたのは
 * **入口**の話で、ここは**出口**（1行に均す表示）なので畳んでよい。
 */
export function metaText(input: string): string {
    return (input ?? "").replace(/\s+/gu, " ").trim();
}
