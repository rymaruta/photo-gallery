import type { Metadata } from "next";
import { siteConfig, generateHomeStructuredData, generateOrganizationStructuredData, FEED_ALTERNATE, shareOgImage, shareImageUrl } from "../lib/utils/seo";
import { loadAllPhotos } from "../lib/server/photos";
import GalleryPageClient from "./GalleryPageClient";
import { homeSeasonalSpots } from "../lib/data/spotTopics";

// OGP 画像は**固定の代表画像**（`SHARE_IMAGE`・2026-10-31 #432）。利用者の最新の投稿
// （2026-10-31 はスーパーのぶどう）が共有カードと Google の検索結果に出ていた
export async function generateMetadata(): Promise<Metadata> {
    return {
        title: siteConfig.name,
        description: siteConfig.description,
        keywords: [
            "旅行写真", "旅フォト", "旅の写真", "旅行記", "フォトギャラリー",
            "風景写真", "スナップ写真", "海外旅行", "国内旅行",
            "travel photography", "photo gallery", "journey", "landscape",
        ],
        alternates: {
            canonical: siteConfig.url,
            // **`alternates` はオブジェクトごと差し替わる。** ここで
            // `canonical` だけ書くと、レイアウトのフィード宣言が消える
            // （実際そうなっていて、フィードはどのページからも辿れなかった）
            ...FEED_ALTERNATE,
        },
        openGraph: {
            type: "website",
            locale: "ja_JP",
            url: siteConfig.url,
            siteName: siteConfig.name,
            title: siteConfig.name,
            description: siteConfig.description,
            images: [shareOgImage()],
        },
        // 子が `twitter` を書かないとルートの値が残る。ここでも同じ1枚を明示する
        twitter: {
            card: "summary_large_image",
            title: siteConfig.name,
            description: siteConfig.description,
            images: [shareImageUrl()],
            creator: siteConfig.twitterHandle,
        },
    };
}

export default async function Page() {
    // 実データはビルド時に生成される app/data/photos.json 側にある。
    // lib/data/photos の既定エクスポート（BASE_PHOTOS）は空配列なので、
    // そのまま渡すと構造化データの image が常に空になっていた。
    const photos = await loadAllPhotos();
    // 代表の1枚（`primaryImageOfPage`・`image` の先頭）は固定の代表画像。ギャラリーの並びはそのあと
    const structuredData = generateHomeStructuredData(photos.filter((p) => p.published !== false));
    const organizationData = generateOrganizationStructuredData();

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c").replace(/>/g, "\\u003e") }}
            />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationData).replace(/</g, "\\u003c").replace(/>/g, "\\u003e") }}
            />
            {/* いまの季節の撮影スポット（数件）は**ビルド時に選んで焼く**（`homeSeasonalSpots`）。
                台帳はクライアントへ渡さない——渡すのは名前・場所・写真の場所だけ */}
            <GalleryPageClient seasonalSpots={homeSeasonalSpots(new Date())} />
        </>
    );
}
