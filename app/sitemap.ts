import type { MetadataRoute } from "next";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { siteConfig } from "../lib/utils/seo";
import { collectEntries, collectionPath, photosInCollection, type CollectionType } from "../lib/utils/collections";
import RAW_PHOTOS from "@/lib/data/photos";
import type { Photo } from "@/lib/data/photos";

export const dynamic = "force-static";

// サイトマップはビルドごとに最新の photos.json（DynamoDB から同期）で再生成される。
// deploy.yml の毎日 03:00 JST の再ビルドにより、新しい写真・ユーザーは
// 少なくとも1日1回自動的に検索エンジンへ通知される内容に反映される。

async function loadPhotos(): Promise<Photo[]> {
    const photosDataPath = path.join(process.cwd(), "app", "data", "photos.json");
    if (existsSync(photosDataPath)) {
        const data = await readFile(photosDataPath, "utf-8");
        return JSON.parse(data) as Photo[];
    }
    return RAW_PHOTOS as Photo[];
}

function toAbsolute(src: string): string {
    return src.startsWith("http") ? src : `${siteConfig.url}${src}`;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const baseUrl = siteConfig.url;
    const now = new Date().toISOString();
    const photos = (await loadPhotos()).filter((p) => p.published !== false);

    // 写真ページ: 画像サイトマップ付き（Google 画像検索への露出を強化）
    const photoUrls: MetadataRoute.Sitemap = photos.map((p) => ({
        url: `${baseUrl}/photo/${p.id}`,
        lastModified: p.updatedAt ?? p.createdAt ?? now,
        changeFrequency: "monthly",
        priority: 0.8,
        images: [toAbsolute(p.src)],
    }));

    // ユーザープロフィール: 投稿があるユーザーごと。lastmod は最新投稿日時
    const byUser = new Map<string, string>();
    for (const p of photos) {
        if (!p.userId) continue;
        const t = String(p.updatedAt ?? p.createdAt ?? p.date ?? "");
        const cur = byUser.get(p.userId);
        if (!cur || t > cur) byUser.set(p.userId, t);
    }
    const userUrls: MetadataRoute.Sitemap = Array.from(byUser.entries()).map(([userId, last]) => ({
        url: `${baseUrl}/users/${userId}`,
        lastModified: last || now,
        changeFrequency: "weekly",
        priority: 0.6,
    }));

    // 集約（ランディング）ページ: タグ / 撮影地 / カテゴリ。ロングテール検索の受け皿。
    // lastModified は「その集約内で最も新しい写真」の日時、代表画像も添える。
    const collectionUrls: MetadataRoute.Sitemap = (["tag", "location", "category"] as CollectionType[])
        .flatMap((type) =>
            collectEntries(photos, type).map((e) => {
                const matched = photosInCollection(photos, type, e.slug);
                const last = matched
                    .map((p) => String(p.updatedAt ?? p.createdAt ?? p.date ?? ""))
                    .reduce((a, b) => (b > a ? b : a), "");
                const rep = matched[0]?.src;
                return {
                    url: `${baseUrl}${collectionPath(type, e.slug)}`,
                    lastModified: last || now,
                    changeFrequency: "weekly" as const,
                    priority: 0.5,
                    ...(rep ? { images: [toAbsolute(rep)] } : {}),
                };
            })
        );

    return [
        {
            url: baseUrl,
            lastModified: now,
            changeFrequency: "daily",
            priority: 1.0,
        },
        ...photoUrls,
        ...userUrls,
        ...collectionUrls,
    ];
}
