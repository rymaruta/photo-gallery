import type { Metadata } from "next";
import { siteConfig, generateBreadcrumbStructuredData } from "../../lib/utils/seo";

const breadcrumbData = generateBreadcrumbStructuredData([
    { name: "ホーム", url: siteConfig.url },
    { name: "ギャラリー", url: `${siteConfig.url}/gallery` },
]);

export const metadata: Metadata = {
    title: `ギャラリー | ${siteConfig.name}`,
    description: "写真ギャラリー一覧",
    keywords: ["ギャラリー", "写真", "一覧", "gallery", "photography"],
    alternates: {
        canonical: `${siteConfig.url}/gallery`,
        languages: {
            ja: `${siteConfig.url}/gallery`,
            en: `${siteConfig.url}/gallery`,
        },
    },
    openGraph: {
        type: "website",
        locale: "ja_JP",
        url: `${siteConfig.url}/gallery`,
        siteName: siteConfig.name,
        title: `ギャラリー | ${siteConfig.name}`,
        description: "写真ギャラリー一覧",
        images: [
            {
                url: `${siteConfig.url}${siteConfig.ogImage}`,
                width: 1200,
                height: 630,
                alt: siteConfig.name,
            },
        ],
    },
    twitter: {
        card: "summary_large_image",
        title: `ギャラリー | ${siteConfig.name}`,
        description: "写真ギャラリー一覧",
        images: [`${siteConfig.url}${siteConfig.ogImage}`],
        creator: siteConfig.twitterHandle,
    },
    robots: {
        index: false, // 準備中のためインデックスしない
        follow: true,
    },
};

export default function GalleryLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbData) }}
            />
            {children}
        </>
    );
}
