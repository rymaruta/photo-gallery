import type { Metadata } from "next";
import { siteConfig, generateStructuredData, generateOrganizationStructuredData } from "../lib/utils/seo";
import { loadAllPhotos } from "../lib/server/photos";
import GalleryPageClient from "./GalleryPageClient";

export const metadata: Metadata = {
    title: siteConfig.name,
    description: siteConfig.description,
    keywords: [
        "旅行写真", "旅フォト", "旅の写真", "旅行記", "フォトギャラリー",
        "風景写真", "スナップ写真", "海外旅行", "国内旅行",
        "travel photography", "photo gallery", "journey", "landscape",
    ],
    alternates: {
        canonical: siteConfig.url,
    },
    openGraph: {
        type: "website",
        locale: "ja_JP",
        url: siteConfig.url,
        siteName: siteConfig.name,
        title: siteConfig.name,
        description: siteConfig.description,
        images: [
            {
                url: siteConfig.ogImage.startsWith("http")
                    ? siteConfig.ogImage
                    : `${siteConfig.url}${siteConfig.ogImage}`,
                width: 1200,
                height: 630,
                alt: siteConfig.name,
            },
        ],
    },
};

export default async function Page() {
    // 実データはビルド時に生成される app/data/photos.json 側にある。
    // lib/data/photos の既定エクスポート（BASE_PHOTOS）は空配列なので、
    // そのまま渡すと構造化データの image が常に空になっていた。
    const photos = await loadAllPhotos();
    const structuredData = generateStructuredData(photos.filter((p) => p.published !== false));
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
            <GalleryPageClient />
        </>
    );
}
