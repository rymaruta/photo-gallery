import type { Metadata } from "next";
import { siteConfig, generateBreadcrumbStructuredData } from "../../lib/utils/seo";

const breadcrumbData = generateBreadcrumbStructuredData([
    { name: "ホーム", url: siteConfig.url },
    { name: "お知らせ", url: `${siteConfig.url}/news` },
]);

export const metadata: Metadata = {
    title: `お知らせ | ${siteConfig.name}`,
    description: "更新履歴とお知らせ",
    keywords: ["お知らせ", "更新履歴", "ニュース", "news", "updates"],
    alternates: {
        canonical: `${siteConfig.url}/news`,
        languages: {
            ja: `${siteConfig.url}/news`,
            en: `${siteConfig.url}/news`,
        },
    },
    openGraph: {
        type: "website",
        locale: "ja_JP",
        url: `${siteConfig.url}/news`,
        siteName: siteConfig.name,
        title: `お知らせ | ${siteConfig.name}`,
        description: "更新履歴とお知らせ",
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
        title: `お知らせ | ${siteConfig.name}`,
        description: "更新履歴とお知らせ",
        images: [`${siteConfig.url}${siteConfig.ogImage}`],
        creator: siteConfig.twitterHandle,
    },
};

export default function NewsLayout({
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
