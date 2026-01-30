// app/metadata.ts
// メインページ用のメタデータ生成関数

import type { Metadata } from "next";
import { siteConfig } from "../lib/utils/seo";

export function generateHomeMetadata(): Metadata {
    return {
        title: {
            default: siteConfig.name,
            template: `%s | ${siteConfig.name}`,
        },
        description: siteConfig.description,
        keywords: ["写真", "ギャラリー", "作品", "photography", "gallery", "works", "風景", "landscape"],
        authors: [{ name: siteConfig.author }],
        creator: siteConfig.author,
        openGraph: {
            type: "website",
            locale: siteConfig.locale.ja,
            alternateLocale: siteConfig.locale.en,
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
        twitter: {
            card: "summary_large_image",
            title: siteConfig.name,
            description: siteConfig.description,
            images: [siteConfig.ogImage.startsWith("http") 
                ? siteConfig.ogImage 
                : `${siteConfig.url}${siteConfig.ogImage}`],
            creator: siteConfig.twitterHandle,
        },
        alternates: {
            canonical: siteConfig.url,
            languages: {
                ja: siteConfig.url,
                en: siteConfig.url,
                "x-default": siteConfig.url,
            },
        },
        robots: {
            index: true,
            follow: true,
            googleBot: {
                index: true,
                follow: true,
                "max-video-preview": -1,
                "max-image-preview": "large",
                "max-snippet": -1,
            },
        },
    };
}
