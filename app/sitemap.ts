import type { MetadataRoute } from "next";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { siteConfig } from "../lib/utils/seo";
import RAW_PHOTOS from "./data/photos";
import type { Photo } from "./data/photos";

export const dynamic = "force-static";

async function loadPhotos(): Promise<Photo[]> {
    const photosDataPath = path.join(process.cwd(), "app", "data", "photos.json");
    if (existsSync(photosDataPath)) {
        const data = await readFile(photosDataPath, "utf-8");
        return JSON.parse(data) as Photo[];
    }
    return RAW_PHOTOS as Photo[];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const baseUrl = siteConfig.url;
    const now = new Date().toISOString();
    const photos = await loadPhotos();

    const photoUrls: MetadataRoute.Sitemap = photos
        .filter((p) => p.published !== false)
        .map((p) => ({
            url: `${baseUrl}/photo/${p.id}`,
            lastModified: p.updatedAt ?? p.createdAt ?? now,
            changeFrequency: "monthly",
            priority: 0.8,
        }));

    return [
        {
            url: baseUrl,
            lastModified: now,
            changeFrequency: "daily",
            priority: 1.0,
        },
        {
            url: `${baseUrl}/about`,
            lastModified: now,
            changeFrequency: "monthly",
            priority: 0.5,
        },
        ...photoUrls,
    ];
}
