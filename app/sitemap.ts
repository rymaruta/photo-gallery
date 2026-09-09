import type { MetadataRoute } from "next";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { siteConfig } from "../lib/utils/seo";
import { collectEntries, collectionPath, isIndexableCollection, photosInCollection, type CollectionType } from "../lib/utils/collections";
import RAW_PHOTOS from "@/lib/data/photos";
import type { Photo } from "@/lib/data/photos";

export const dynamic = "force-static";

// サイトマップはビルドごとに最新の photos.json（DynamoDB から同期）で再生成される。
// 定期ビルドは**週1**（日曜 03:00 JST）。以前は毎日だったが 2026-09 に
// 枠の都合で週1へ変えてある（CLAUDE.md）。写真の削除・非公開は API が
// その場で再ビルドを頼むので、定期ビルド待ちにはならない。

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

/** プライバシーポリシーの本文を最後に変えた日。本文を直したらここも直す */
const PRIVACY_LAST_MODIFIED = "2026-04-01";

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
    const collectionUrls: MetadataRoute.Sitemap = (["tag", "location", "category", "camera"] as CollectionType[])
        .flatMap((type) =>
            // 写真が少ないページはサイトマップに載せない（noindex と揃える）
            collectEntries(photos, type).filter((e) => isIndexableCollection(e.count)).map((e) => {
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

    // lastmod は「中身が変わった日」。ビルド時刻を入れると、写真を1枚も
    // 足していないビルドでもトップと /privacy が「今日更新」と申告する。
    // 毎回それをやると lastmod ごと信用されなくなり、本当に増えた写真の
    // 発見が遅れる（sitemap を出している目的そのものを損なう）。
    // トップは一番新しい写真の日付、/privacy は本文を変えた日を使う。
    const newestPhoto = photos
        .map((p) => p.updatedAt ?? p.createdAt ?? "")
        .filter(Boolean)
        .sort()
        .pop();
    return [
        {
            url: baseUrl,
            lastModified: newestPhoto ?? now,
            changeFrequency: "daily",
            priority: 1.0,
        },
        {
            url: `${baseUrl}/privacy`,
            lastModified: PRIVACY_LAST_MODIFIED,
            changeFrequency: "yearly",
            priority: 0.2,
        },
        {
            // 撮影地マップ。中身は写真に連動するので lastmod もトップと同じ
            url: `${baseUrl}/map`,
            lastModified: newestPhoto ?? now,
            changeFrequency: "weekly",
            priority: 0.5,
        },
        ...photoUrls,
        ...userUrls,
        ...collectionUrls,
    ];
}
