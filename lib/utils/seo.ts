// lib/utils/seo.ts
// SEO設定と構造化データ生成用のユーティリティ

export const siteConfig = {
    name: "PhotoGallery",
    description: "小さな写真サイトへようこそ。",
    url: process.env.NEXT_PUBLIC_SITE_URL || "https://your-domain.com",
    ogImage: "/images/og-image.jpg",
    twitterHandle: "@PhotoGallery",
};

/**
 * 構造化データ（JSON-LD）を生成
 */
export function generateStructuredData(photos: Array<{ id: string; title?: string | { ja?: string; en?: string }; src: string }>) {
    return {
        "@context": "https://schema.org",
        "@type": "ImageGallery",
        name: siteConfig.name,
        description: siteConfig.description,
        url: siteConfig.url,
        image: photos.map((photo) => ({
            "@type": "ImageObject",
            "@id": `${siteConfig.url}/photo/${photo.id}`,
            contentUrl: `${siteConfig.url}${photo.src}`,
            name: typeof photo.title === "string" ? photo.title : photo.title?.ja || photo.title?.en || "",
        })),
    };
}
