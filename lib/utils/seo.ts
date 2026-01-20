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
 * 構造化データ（JSON-LD）を生成 - ギャラリーページ用
 */
export function generateStructuredData(photos: Array<{ id: string; title?: string | { ja?: string; en?: string }; src: string }>) {
    return {
        "@context": "https://schema.org",
        "@type": "ImageGallery",
        name: siteConfig.name,
        description: siteConfig.description,
        url: siteConfig.url,
        image: photos
            .filter((photo) => photo.id && photo.src)
            .map((photo) => {
                const imageUrl = photo.src.startsWith("http") 
                    ? photo.src 
                    : `${siteConfig.url}${photo.src}`;
                return {
                    "@type": "ImageObject",
                    "@id": `${siteConfig.url}/photo/${photo.id}`,
                    contentUrl: imageUrl,
                    name: typeof photo.title === "string" 
                        ? photo.title 
                        : photo.title?.ja || photo.title?.en || "",
                };
            }),
    };
}

/**
 * 個別写真ページ用の構造化データを生成
 */
export function generatePhotoStructuredData(photo: {
    id: string;
    title?: string | { ja?: string; en?: string };
    description?: string | { ja?: string[]; en?: string[] };
    src: string;
    photographer?: string;
    location?: string;
    coords?: { lat: number; lng: number };
    createdAt?: string;
    updatedAt?: string;
    width?: number;
    height?: number;
}, locale: "ja" | "en" = "ja") {
    const title = typeof photo.title === "string" 
        ? photo.title 
        : photo.title?.[locale] || photo.title?.ja || photo.title?.en || "";
    
    const description = Array.isArray(photo.description?.[locale])
        ? photo.description[locale]?.join(" ") || ""
        : Array.isArray(photo.description?.ja)
            ? photo.description.ja.join(" ")
            : typeof photo.description === "string"
                ? photo.description
                : "";
    
    const imageUrl = photo.src.startsWith("http") 
        ? photo.src 
        : `${siteConfig.url}${photo.src}`;
    
    const structuredData: any = {
        "@context": "https://schema.org",
        "@type": "ImageObject",
        "@id": `${siteConfig.url}/photo/${photo.id}`,
        contentUrl: imageUrl,
        name: title,
        description: description || siteConfig.description,
        url: `${siteConfig.url}/photo/${photo.id}`,
    };
    
    if (photo.photographer) {
        structuredData.creator = {
            "@type": "Person",
            name: photo.photographer,
        };
    }
    
    if (photo.location) {
        structuredData.contentLocation = {
            "@type": "Place",
            name: photo.location,
        };
        
        if (photo.coords) {
            structuredData.contentLocation.geo = {
                "@type": "GeoCoordinates",
                latitude: photo.coords.lat,
                longitude: photo.coords.lng,
            };
        }
    }
    
    if (photo.width && photo.height) {
        structuredData.width = photo.width;
        structuredData.height = photo.height;
    }
    
    if (photo.createdAt) {
        structuredData.dateCreated = photo.createdAt;
    }
    
    if (photo.updatedAt) {
        structuredData.dateModified = photo.updatedAt;
    }
    
    return structuredData;
}

/**
 * サイト全体の構造化データ（Organization）を生成
 */
export function generateOrganizationStructuredData() {
    return {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: siteConfig.name,
        url: siteConfig.url,
        description: siteConfig.description,
        logo: `${siteConfig.url}${siteConfig.ogImage}`,
    };
}
