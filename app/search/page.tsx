import GalleryPageClient from "../GalleryPageClient";
import type { SpotDiscoveryItem } from "../components/SpotDiscoveryStrip";
import { SPOTS } from "@/lib/data/spots";
import { publishableSpots, usesMapHero, needsVisibleCredit } from "@/lib/utils/spotGuide";

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
 * 色でさがす（Color Journey）は `GalleryPageClient` の「さがす」面の中に
 * 在る（`app/components/ColorJourney.tsx`）。以前はここで上に重ねていたが、
 * それだと写真の取得が2つ動き、モーダルも絞り込みも下と食い違っていた。
 */
export default function SearchPage() {
    // サーバーで台帳を絞る。検索画面の client bundle に全スポットデータを載せない。
    // 未許諾画像・未公開スポット・架空の枚数をカードに出さない。
    const spotPreview: SpotDiscoveryItem[] = publishableSpots(SPOTS).slice(0, 3).map((spot) => {
        const cover = !usesMapHero(spot) && !needsVisibleCredit(spot) ? spot.coverImage : null;
        return {
            slug: spot.slug,
            name: spot.name,
            region: [spot.region?.prefecture, spot.region?.city].filter(Boolean).join(" ") || undefined,
            summary: spot.summary,
            coverSrc: cover?.src,
            coverAlt: cover?.alt,
        };
    });
    return <GalleryPageClient surface="search" spotPreview={spotPreview} />;
}
