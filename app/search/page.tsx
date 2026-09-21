import GalleryPageClient from "../GalleryPageClient";
import ColorJourney from "./ColorJourney";

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
 *
 * **色でさがす（Color Journey）は別の部品として上に足す。**
 * `GalleryPageClient` には手を入れない——あの部品はトップと共用している
 * （`surface` で面を切り替える形）。色が1つも立たないときは
 * `ColorJourney` が丸ごと何も描かないので、ここに置いても空の枠は出ない。
 */
export default function SearchPage() {
    return (
        <>
            <ColorJourney />
            <GalleryPageClient surface="search" />
        </>
    );
}
