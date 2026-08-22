import type { Metadata } from "next";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import type { Photo } from "@/lib/data/photos";
import { siteConfig } from "@/lib/utils/seo";
import UserProfileClient from "../UserProfileClient";
import { withPlaceholderParam } from "../../../lib/server/staticParams";

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
        // ここで作れるのは「公開写真が1枚以上ある人」のページだけ。
        // 入力の photos.json が生成時に非公開とストーリーを落としている
        // （scripts/sync-photos-from-ddb.js の filter）ので、この行で
        // 絞りを緩めても、全部を非公開にした人の userId はそもそも来ない。
        // ※以前ここに「公開写真の有無で絞らない（全非公開でもページを残す）」
        //   というコメントがあったが、上記の理由で**効いていなかった**。
        // 全非公開にした人のページは次のビルドで消えるが、ハード404には
        // ならない: 404ページ（app/not-found.tsx → notFoundRedirect.ts）が
        // /users?id=<userId> のクエリ版へ振り替え、中身は API から描ける。
        // 静的な枠を全員分残したければ、ビルド入力に「全ユーザーのID一覧」を
        // 別途書き出す必要がある（photos.json からは決められない）。
        if (p.userId) ids.add(p.userId);
    }
    // ユーザーが0人でも1件は返す（空だと output: export がビルドを落とす）
    return withPlaceholderParam(Array.from(ids).map((id) => ({ id })), "id");
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
