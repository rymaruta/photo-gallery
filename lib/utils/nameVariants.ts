/**
 * 人名の別表記。
 *
 * **`seo.ts` からも `personEntity.ts` からも使うので、独立した置き場に置く。**
 * `personEntity.ts` は `seo.ts` の `siteConfig` を読んでいるので、あちらに
 * 置くと import が輪になる（api-user で一度踏んで `blockCheck.ts` を
 * 切り出した型）。
 */

/**
 * 空白を詰めた別表記（`alternateName`）。
 *
 * **日本語の人名は、空白あり/なしの両方で書かれる。** 実データの表示名は
 * 「丸田 竜平」（半角空白入り）だが、探す側は「丸田竜平」とも
 * 「丸田　竜平」（全角空白）とも打つ。schema.org の `alternateName` は
 * まさに「同じものの別の呼び名」の置き場所なので、そこに出す。
 *
 * **当てるのは全部が仮名・漢字の名前だけ。** ラテン文字が混じる名前から
 * 空白を落とすと `JohnSmith` のような**実在しない綴り**ができてしまい、
 * 「別表記」ではなく嘘になる。日本語の姓名にはこの問題が無い（空白は
 * 見やすさのためで、詰めた形も普通に使われる）。
 */
export function spacelessName(displayName: string): string | undefined {
    const name = (displayName ?? "").trim();
    const packed = name.replace(/\s+/gu, "");
    // 空白が無い（＝別表記が生まれない）／詰めると空になる
    if (!packed || packed === name) return undefined;
    // 仮名・漢字だけか。長音符「ー」と繰り返し記号「々〆ヶ」も人名に出る
    return /^[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\u30fc\u3005\u3006\u30f6]+$/u.test(packed)
        ? packed
        : undefined;
}
