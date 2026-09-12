// lib/utils/photoAlt.ts
// 写真の代替テキスト（alt）を1か所で組む。

import { getLocalized, type Photo, type Locale } from "../data/photos";

/**
 * 写真の alt。**画像検索に出るかどうかは、ほぼここで決まる。**
 *
 * ## なぜ1本にしたか
 *
 * 撮影地を併記する形は `GalleryGrid`（一覧のサムネ）**だけ**に入っていて、
 * **写真ページの本体画像・モーダル・OGP は素の題のまま**だった。
 * 画像検索が実際に見て順位を付けるのは**本体画像**の方なので、
 * 効かせたい1枚にだけ効いていなかった（この台帳が何度も記録している
 * 「入口が2つあるのに片方しか直っていない」）。
 *
 * ## 組み方
 *
 * 1. 利用者が書いた `alt` があれば**それをそのまま使う**（人が書いたものが最優先）
 * 2. 無ければ題。題に撮影地が入っていなければ `（撮影地）` を添える
 * 3. 題も無ければ撮影地だけ
 *
 * **水増しはしない。** タグやカテゴリを並べて長くすると、alt は
 * 「画像の説明」ではなく検索語の羅列になり、支援技術の読み上げも壊れる。
 * 実データ30枚は alt を持つのが2枚だけ・題の中央値が8文字なので、
 * 地名を1つ足すだけで「未完の大聖堂」が「未完の大聖堂（バルセロナ）」になる。
 */
export function photoAltText(photo: Photo, locale: Locale): string {
    const own = getLocalized(photo.alt, locale);
    if (own) return own;

    const title = getLocalized(photo.title, locale) || (typeof photo.title === "string" ? photo.title : "");
    const place = typeof photo.location === "string" ? photo.location.trim() : "";
    if (!title) return place;
    // 既に地名が入っているなら重ねない（「山中湖の白鳥（山中湖）」を作らない）
    if (!place || title.includes(place)) return title;
    return `${title}（${place}）`;
}
