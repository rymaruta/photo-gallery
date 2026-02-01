import type { Photo } from "../../data/photos";
import RAW_PHOTOS from "../../data/photos";
import PhotoPageClient from "./PhotoPageClient";
import type { Metadata } from "next";
import { siteConfig } from "../../../lib/utils/seo";
import { getLocalized, getLocalizedParagraphs } from "../../data/photos";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

// 写真データを読み込む関数
async function loadPhoto(id: string): Promise<Photo | null> {
    const photosDataPath = path.join(process.cwd(), "app", "data", "dev-photos.json");
    
    if (existsSync(photosDataPath)) {
        const data = await readFile(photosDataPath, "utf-8");
        const photos: Photo[] = JSON.parse(data);
        return photos.find((p) => p.id === id) || null;
    }
    
    return (RAW_PHOTOS as Photo[]).find((p) => p.id === id) || null;
}

// 静的生成用のパラメータ生成関数
export async function generateStaticParams() {
    const photosDataPath = path.join(process.cwd(), "app", "data", "dev-photos.json");
    let photos: Photo[];
    
    if (existsSync(photosDataPath)) {
        const data = await readFile(photosDataPath, "utf-8");
        photos = JSON.parse(data);
    } else {
        photos = RAW_PHOTOS as Photo[];
    }
    
    return photos
        .filter((photo) => photo.published !== false)
        .map((photo) => ({
            id: photo.id,
        }));
}

// メタデータ生成
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
    const { id } = await params;
    const photo = await loadPhoto(id);
    
    if (!photo) {
        return {
            title: "Photo Not Found",
            description: "The photo you are looking for does not exist.",
        };
    }
    
    const title = getLocalized(photo.title, "ja") || getLocalized(photo.title, "en") || "Untitled";
    const descriptionParagraphs = getLocalizedParagraphs(photo.description, "ja");
    const description = descriptionParagraphs.length > 0
        ? descriptionParagraphs.join(" ")
        : getLocalizedParagraphs(photo.description, "en").join(" ") || siteConfig.description;
    
    const imageUrl = photo.src.startsWith("http") 
        ? photo.src 
        : `${siteConfig.url}${photo.src}`;
    
    const pageUrl = `${siteConfig.url}/photo/${id}`;
    
    return {
        title: `${title} | ${siteConfig.name}`,
        description: description,
        keywords: [
            ...(photo.tags || []),
            photo.category || "",
            photo.location || "",
        ].filter(Boolean),
        authors: photo.photographer ? [{ name: photo.photographer }] : undefined,
        openGraph: {
            type: "website",
            locale: "ja_JP",
            url: pageUrl,
            siteName: siteConfig.name,
            title: title,
            description: description,
            images: [
                {
                    url: imageUrl,
                    width: photo.width || 1200,
                    height: photo.height || 630,
                    alt: getLocalized(photo.alt, "ja") || getLocalized(photo.alt, "en") || title,
                },
            ],
        },
        twitter: {
            card: "summary_large_image",
            title: title,
            description: description,
            images: [
                {
                    url: imageUrl,
                    alt: getLocalized(photo.alt, "ja") || getLocalized(photo.alt, "en") || title,
                },
            ],
            creator: siteConfig.twitterHandle,
        },
        alternates: {
            canonical: pageUrl,
            languages: {
                ja: pageUrl,
                en: pageUrl,
            },
        },
    };
}

type PageProps = {
    params: Promise<{ id: string }>;
};

export default async function PhotoPage({ params }: PageProps) {
    const { id } = await params;
    return <PhotoPageClient photoId={id} />;
}
