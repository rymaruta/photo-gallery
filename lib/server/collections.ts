// lib/server/collections.ts
// 集約（ランディング）ページの generateStaticParams / generateMetadata 共通実装。
// fs（loadAllPhotos）を使うためサーバー（ルート）からのみ import すること。

import type { Metadata } from "next";
import { loadAllPhotos } from "./photos";
import {
    collectEntries,
    isIndexableCollection,
    photosInCollection,
    labelForSlug,
    collectionCopy,
    collectionPath,
    type CollectionType,
} from "../utils/collections";
import { siteConfig } from "../utils/seo";

/** 静的エクスポート用: そのタイプの全 slug を列挙（列挙外のパスは 404） */
export async function collectionStaticParams(type: CollectionType, paramKey: string) {
    const photos = await loadAllPhotos();
    return collectEntries(photos, type).map((e) => ({ [paramKey]: e.slug }));
}

/** ランディングページのメタデータ（title/description/canonical/OG/Twitter） */
export async function collectionMetadata(type: CollectionType, slug: string): Promise<Metadata> {
    const photos = await loadAllPhotos();
    const matched = photosInCollection(photos, type, slug);
    const label = labelForSlug(photos, type, slug);
    const { title, description } = collectionCopy(type, label, matched.length);
    const url = `${siteConfig.url}${collectionPath(type, slug)}`;

    const first = matched[0];
    const rawImage = first?.thumbSrc || first?.src;
    const image = rawImage ? (rawImage.startsWith("http") ? rawImage : `${siteConfig.url}${rawImage}`) : undefined;

    return {
        title,
        description,
        keywords: [label, "旅", "写真", "フォトギャラリー"].filter(Boolean),
        alternates: { canonical: url },
        // 写真が少ないページは検索エンジンに載せない。
        // 写真1〜2枚＋定型文だけのページを大量に作ると「中身の薄いサイト」と
        // 判断され、サイト全体の評価が下がる。サイト内から辿る分には見られる。
        robots: isIndexableCollection(matched.length) ? undefined : { index: false, follow: true },
        openGraph: {
            type: "website",
            locale: siteConfig.locale.ja,
            url,
            siteName: siteConfig.name,
            title,
            description,
            images: image ? [{ url: image }] : undefined,
        },
        twitter: {
            card: "summary_large_image",
            title,
            description,
            images: image ? [image] : undefined,
            creator: siteConfig.twitterHandle,
        },
    };
}
