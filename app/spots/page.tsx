import type { Metadata } from "next";
import SpotIndexClient from "@/app/components/SpotIndexClient";
import { SPOTS } from "@/lib/data/spots";
import { spotIndexItems } from "@/lib/data/spotLink";
import { publishableSpots } from "@/lib/utils/spotGuide";
import { siteConfig } from "@/lib/utils/seo";

/**
 * **公式撮影地ガイドの索引。**
 *
 * `/location`（写真から作る撮影地の索引）とは別の面。あちらは維持する。
 *
 * **公開できるスポットが少ないうちは索引に載せない**——名前が数個並ぶだけの
 * ページを検索に出しても、見た人の役に立たない（`/location` の索引が
 * `isIndexableCollectionIndex` で同じ判断をしている）。
 */
const MIN_INDEXABLE_SPOTS = 3;

export async function generateMetadata(): Promise<Metadata> {
    const n = publishableSpots(SPOTS).length;
    const title = "撮影スポットをさがす";
    const description = n > 0
        ? `写真を撮りに行ける場所のガイド（${n}件）。見どころ・季節・時間帯・アクセスまで。`
        : "写真を撮りに行ける場所のガイド。";
    return {
        title,
        description,
        alternates: { canonical: `${siteConfig.url}/spots` },
        robots: n >= MIN_INDEXABLE_SPOTS ? undefined : { index: false, follow: true },
        openGraph: { type: "website", url: `${siteConfig.url}/spots`, siteName: siteConfig.name, title, description },
    };
}

export default function SpotIndexPage() {
    // **台帳をそのまま渡さない。** クライアント部品への props は HTML に
    // 埋め込まれるので、渡したぶんが訪問のたびに落ちる
    // （`lib/data/spotLink.ts` の `SpotIndexItem` の注記に実測がある）
    return <SpotIndexClient spots={spotIndexItems()} />;
}
