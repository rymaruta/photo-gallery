import type { Metadata } from "next";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { Photo } from "@/lib/data/photos";
import { siteConfig } from "@/lib/utils/seo";
import UserProfileClient from "../UserProfileClient";

// ユーザープロフィールの静的生成版（/users/<userId>）。
// ビルド時点の photos.json に投稿があるユーザーごとにページを生成し、
// 表示名・投稿数・最新作品を使ったユーザー個別の OGP カードを付ける。
// ビルド後に登録された新規ユーザーは /users?id=<userId>（クエリ版）で表示される。

async function loadPhotos(): Promise<Photo[]> {
    const photosDataPath = path.join(process.cwd(), "app", "data", "photos.json");
    if (existsSync(photosDataPath)) {
        const data = await readFile(photosDataPath, "utf-8");
        return JSON.parse(data) as Photo[];
    }
    return [];
}

type UserSummary = {
    displayName: string;
    photoCount: number;
    latestPhotoSrc?: string;
};

async function loadUserSummary(userId: string): Promise<UserSummary | null> {
    const photos = await loadPhotos();
    const userPhotos = photos
        .filter((p) => p.userId === userId && p.published !== false)
        .sort((a, b) => String(b.createdAt ?? b.date ?? "").localeCompare(String(a.createdAt ?? a.date ?? "")));
    if (userPhotos.length === 0) return null;
    return {
        displayName: userPhotos.find((p) => p.displayName)?.displayName ?? "ユーザー",
        photoCount: userPhotos.length,
        latestPhotoSrc: userPhotos[0]?.src,
    };
}

export async function generateStaticParams() {
    const photos = await loadPhotos();
    const ids = new Set<string>();
    for (const p of photos) {
        if (p.userId && p.published !== false) ids.add(p.userId);
    }
    return Array.from(ids).map((id) => ({ id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
    const { id } = await params;
    const summary = await loadUserSummary(id);

    if (!summary) {
        return { title: "プロフィール", description: siteConfig.description };
    }

    const title = `${summary.displayName}の旅フォト`;
    const description = `${summary.displayName}さんが Journey Photo で旅の写真を${summary.photoCount}枚公開中。旅先の風景やスナップをお楽しみください。`;
    const url = `${siteConfig.url}/users/${id}`;
    const images = summary.latestPhotoSrc
        ? [{ url: summary.latestPhotoSrc, width: 1200, height: 800, alt: title }]
        : undefined;

    return {
        title,
        description,
        alternates: { canonical: url },
        openGraph: {
            type: "profile",
            url,
            siteName: siteConfig.name,
            title: `${title} | Journey Photo`,
            description,
            ...(images ? { images } : {}),
        },
        twitter: {
            card: "summary_large_image",
            title: `${title} | Journey Photo`,
            description,
            ...(summary.latestPhotoSrc ? { images: [summary.latestPhotoSrc] } : {}),
        },
    };
}

export default async function UserProfilePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const summary = await loadUserSummary(id);

    // ProfilePage 構造化データ（検索結果でのプロフィール理解を助ける）
    const jsonLd = summary
        ? {
            "@context": "https://schema.org",
            "@type": "ProfilePage",
            mainEntity: {
                "@type": "Person",
                name: summary.displayName,
                url: `${siteConfig.url}/users/${id}`,
                ...(summary.latestPhotoSrc ? { image: summary.latestPhotoSrc } : {}),
            },
        }
        : null;

    return (
        <>
            {jsonLd && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c").replace(/>/g, "\\u003e") }}
                />
            )}
            <UserProfileClient key={id} userId={id} />
        </>
    );
}
