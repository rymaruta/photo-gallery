import type { Metadata } from "next";
import { siteConfig, generateBreadcrumbStructuredData } from "../../lib/utils/seo";

const breadcrumbData = generateBreadcrumbStructuredData([
    { name: "ホーム", url: siteConfig.url },
    { name: "閲覧履歴", url: `${siteConfig.url}/history` },
]);

export const metadata: Metadata = {
    title: `閲覧履歴 | ${siteConfig.name}`,
    description: "閲覧した写真の履歴",
    keywords: ["閲覧履歴", "写真", "ギャラリー", "history", "gallery"],
    alternates: {
        canonical: `${siteConfig.url}/history`,
        languages: {
            ja: `${siteConfig.url}/history`,
            en: `${siteConfig.url}/history`,
        },
    },
    openGraph: {
        type: "website",
        locale: "ja_JP",
        url: `${siteConfig.url}/history`,
        siteName: siteConfig.name,
        title: `閲覧履歴 | ${siteConfig.name}`,
        description: "閲覧した写真の履歴",
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
        title: `閲覧履歴 | ${siteConfig.name}`,
        description: "閲覧した写真の履歴",
        images: [`${siteConfig.url}${siteConfig.ogImage}`],
        creator: siteConfig.twitterHandle,
    },
    robots: {
        index: false, // ユーザー固有のページのためインデックスしない
        follow: true,
    },
};

export default function HistoryLayout({
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
