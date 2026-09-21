import GalleryPageClient from "../GalleryPageClient";

/**
 * 写真をさがす。**絞り込み・件数・サムネのグリッド**を持つ面。
 *
 * トップは1列のカードフィードになったので、**サムネを並べて探すのはこちら**
 * （`surface="search"`）。一覧で見るのと、流し読みで1枚ずつ見るのは別の
 * 体験なので面を分けている。集約ページの404救済もここへ振る
 * （`lib/utils/notFoundRedirect.ts`）。
 *
 * **`noindex`**（レイアウト側）。絞り込みの結果は URL の組み合わせだけ
 * 無限にあり、どれも集約ページ（`/tag/*` など）と中身が重なる。
 * 構造化データも置かない（索引に入れないページなので機械向けの申告は要らない）。
 */
export default function SearchPage() {
    return <GalleryPageClient surface="search" />;
}
