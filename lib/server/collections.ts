// lib/server/collections.ts
// 集約（ランディング）ページの generateStaticParams / generateMetadata 共通実装。
// fs（loadAllPhotos）を使うためサーバー（ルート）からのみ import すること。

import type { Metadata } from "next";
import { loadAllPhotos } from "./photos";
import {
    collectEntries,
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
        // 万一該当0件のページが生成されてもインデックスさせない
        robots: matched.length === 0 ? { index: false, follow: true } : undefined,
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
