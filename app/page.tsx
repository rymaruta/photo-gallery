import type { Metadata } from "next";
import { siteConfig, generateStructuredData, generateOrganizationStructuredData } from "../lib/utils/seo";
import PHOTOS from "./data/photos";
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

export default function Page() {
    const structuredData = generateStructuredData(PHOTOS);
    const organizationData = generateOrganizationStructuredData();

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
            />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationData) }}
            />
            <GalleryPageClient />
        </>
    );
}
