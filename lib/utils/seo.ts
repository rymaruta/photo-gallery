// lib/utils/seo.ts
// SEO設定と構造化データ生成用のユーティリティ

export const siteConfig = {
    name: "Journey Photo | 旅フォトギャラリー",
    description: "旅の記憶を写真で残す。国内外の旅行写真・風景写真・スナップ写真を集めたフォトギャラリー。旅先の景色や日常のひとこまを届けます。",
    descriptionEn: "A travel photography gallery capturing journeys, landscapes, and everyday moments.",
    url: process.env.NEXT_PUBLIC_SITE_URL || "https://journey-photo.com",
    ogImage: "/images/og-image.jpg",
    twitterHandle: "@JourneyPhoto",
    author: "Journey Photo",
    locale: {
        ja: "ja_JP",
        en: "en_US",
    },
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
    
    let description = "";
    if (typeof photo.description === "string") {
        description = photo.description;
    } else if (photo.description && typeof photo.description === "object") {
        if (Array.isArray(photo.description[locale])) {
            description = photo.description[locale]?.join(" ") || "";
        } else if (Array.isArray(photo.description.ja)) {
            description = photo.description.ja.join(" ");
        }
    }
    
    const imageUrl = photo.src.startsWith("http") 
        ? photo.src 
        : `${siteConfig.url}${photo.src}`;
    
    const structuredData: Record<string, unknown> = {
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
        const contentLocation: Record<string, unknown> = {
            "@type": "Place",
            name: photo.location,
        };
        
        if (photo.coords) {
            contentLocation.geo = {
                "@type": "GeoCoordinates",
                latitude: photo.coords.lat,
                longitude: photo.coords.lng,
            };
        }
        
        structuredData.contentLocation = contentLocation;
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
        logo: {
            "@type": "ImageObject",
            url: `${siteConfig.url}${siteConfig.ogImage}`,
        },
        sameAs: [
            // SNSアカウントがあれば追加
            // "https://www.instagram.com/your_handle",
        ],
    };
}

/**
 * BreadcrumbList構造化データを生成
 */
export function generateBreadcrumbStructuredData(items: Array<{ name: string; url: string }>) {
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: items.map((item, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: item.name,
            item: item.url,
        })),
    };
}

/**
 * WebSite構造化データを生成（検索ボックス用）
 */
export function generateWebSiteStructuredData() {
    return {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: siteConfig.name,
        url: siteConfig.url,
        description: siteConfig.description,
        potentialAction: {
            "@type": "SearchAction",
            target: {
                "@type": "EntryPoint",
                urlTemplate: `${siteConfig.url}/?q={search_term_string}`,
            },
            "query-input": "required name=search_term_string",
        },
    };
}
