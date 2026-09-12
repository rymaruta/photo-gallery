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
 *
 * **通す字は「日本語の姓名に出る字」で決める。** 仮名の塊
 * （`\u3040-\u30ff`）をそのまま通すと、濁点記号（゛゜）・区切りの中黒（・）・
 * 二重ハイフン（゠）まで入る＝「仮名・漢字だけ」という説明と食い違う。
 *
 * **漢字は基本の面だけでは足りない。** 実測:
 *
 *     山﨑  﨑 = U+FA11（互換漢字。Windows の IME が普通に出す）
 *     𠮷田  𠮷 = U+20BB7（CJK拡張B＝サロゲートペア）
 *     〇〇  〇 = U+3007（名前を伏せるときに使う）
 *
 * どれも `\u4e00-\u9fff` の外で、**弾いた側は静かに何も出ない**
 * （気づく手がかりが無い）。`u` フラグ付きなので `\u{...}` で書ける。
 */
const JAPANESE_NAME = new RegExp(
    "^[" +
    "\\u3041-\\u3096\\u309d\\u309e" +       // ひらがな（ゝゞ を含む。゛゜ は入れない）
    "\\u30a1-\\u30fa\\u30fc\\u30fd\\u30fe" + // カタカナ・長音符（・ ゠ は入れない）
    "\\u3005-\\u3007" +                     // 々 〆 〇
    "\\u3400-\\u4dbf\\u4e00-\\u9fff" +      // 漢字（拡張A・基本）
    "\\uf900-\\ufaff" +                     // 互換漢字（﨑 髙 など）
    "\\u{20000}-\\u{3ffff}" +               // 拡張B以降（𠮷 𩸽 など）
    "]+$",
    "u",
);

export function spacelessName(displayName: string): string | undefined {
    const name = (displayName ?? "").trim();
    const packed = name.replace(/\s+/gu, "");
    // 空白が無ければ別表記は生まれない。**空文字もここで返る**——`name` は
    // trim 済みなので、空なら `packed` も空で `packed === name` が成り立つ
    // （`!packed` を別に見る枝は到達しない）
    if (packed === name) return undefined;
    return JAPANESE_NAME.test(packed) ? packed : undefined;
}
