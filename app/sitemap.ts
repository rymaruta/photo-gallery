import { MetadataRoute } from "next";
import { siteConfig } from "../lib/utils/seo";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { BASE_PHOTOS } from "./data/photos";
import type { Photo } from "./data/photos";

// 静的エクスポートではビルド時に実行されるため、force-staticを設定
export const dynamic = "force-static";

async function getAllPhotos(): Promise<Photo[]> {
    const photosDataPath = path.join(process.cwd(), "app", "data", "dev-photos.json");
    
    if (existsSync(photosDataPath)) {
        const data = await readFile(photosDataPath, "utf-8");
        return JSON.parse(data);
    }
    
    return [...BASE_PHOTOS];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const photos = await getAllPhotos();
    const baseUrl = siteConfig.url;
    
    // 静的ページ
    const staticPages: MetadataRoute.Sitemap = [
        {
            url: baseUrl,
            lastModified: new Date(),
            changeFrequency: "daily",
            priority: 1.0,
        },
        {
            url: `${baseUrl}/about`,
            lastModified: new Date(),
            changeFrequency: "monthly",
            priority: 0.8,
        },
        {
            url: `${baseUrl}/favorites`,
            lastModified: new Date(),
            changeFrequency: "weekly",
            priority: 0.7,
        },
        {
            url: `${baseUrl}/history`,
            lastModified: new Date(),
            changeFrequency: "weekly",
            priority: 0.7,
        },
        {
            url: `${baseUrl}/gallery`,
            lastModified: new Date(),
            changeFrequency: "weekly",
            priority: 0.7,
        },
        {
            url: `${baseUrl}/news`,
            lastModified: new Date(),
            changeFrequency: "weekly",
            priority: 0.7,
        },
    ];
    
    // 写真ページ
    const photoPages: MetadataRoute.Sitemap = photos
        .filter((photo) => photo.published !== false)
        .map((photo) => ({
            url: `${baseUrl}/photo/${photo.id}`,
            lastModified: photo.updatedAt 
                ? new Date(photo.updatedAt) 
                : photo.createdAt 
                    ? new Date(photo.createdAt) 
                    : new Date(),
            changeFrequency: "monthly" as const,
            priority: 0.6,
        }));
    
    return [...staticPages, ...photoPages];
}
