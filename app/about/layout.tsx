import type { Metadata } from "next";
import { siteConfig, generateBreadcrumbStructuredData } from "../../lib/utils/seo";
import getContent from "../i18n/about";

const breadcrumbData = generateBreadcrumbStructuredData([
    { name: "ホーム", url: siteConfig.url },
    { name: "About", url: `${siteConfig.url}/about` },
]);

export async function generateMetadata(): Promise<Metadata> {
    const aboutJa = getContent("ja");
    
    return {
        title: `${aboutJa.title} | ${siteConfig.name}`,
        description: aboutJa.description || siteConfig.description,
        keywords: ["About", "写真", "ギャラリー", "photography", "gallery"],
        alternates: {
            canonical: `${siteConfig.url}/about`,
            languages: {
                ja: `${siteConfig.url}/about`,
                en: `${siteConfig.url}/about`,
            },
        },
        openGraph: {
            type: "website",
            locale: "ja_JP",
            url: `${siteConfig.url}/about`,
            siteName: siteConfig.name,
            title: aboutJa.title,
            description: aboutJa.description || siteConfig.description,
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
            title: aboutJa.title,
            description: aboutJa.description || siteConfig.description,
            images: [`${siteConfig.url}${siteConfig.ogImage}`],
            creator: siteConfig.twitterHandle,
        },
    };
}

export default function AboutLayout({
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
