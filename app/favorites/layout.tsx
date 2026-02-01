import type { Metadata } from "next";
import { siteConfig, generateBreadcrumbStructuredData } from "../../lib/utils/seo";

const breadcrumbData = generateBreadcrumbStructuredData([
    { name: "ホーム", url: siteConfig.url },
    { name: "お気に入り", url: `${siteConfig.url}/favorites` },
]);

export const metadata: Metadata = {
    title: `お気に入り | ${siteConfig.name}`,
    description: "お気に入りの写真一覧",
    keywords: ["お気に入り", "写真", "ギャラリー", "favorites", "gallery"],
    alternates: {
        canonical: `${siteConfig.url}/favorites`,
        languages: {
            ja: `${siteConfig.url}/favorites`,
            en: `${siteConfig.url}/favorites`,
        },
    },
    openGraph: {
        type: "website",
        locale: "ja_JP",
        url: `${siteConfig.url}/favorites`,
        siteName: siteConfig.name,
        title: `お気に入り | ${siteConfig.name}`,
        description: "お気に入りの写真一覧",
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
        title: `お気に入り | ${siteConfig.name}`,
        description: "お気に入りの写真一覧",
        images: [`${siteConfig.url}${siteConfig.ogImage}`],
        creator: siteConfig.twitterHandle,
    },
    robots: {
        index: false, // ユーザー固有のページのためインデックスしない
        follow: true,
    },
};

export default function FavoritesLayout({
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
