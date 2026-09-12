// lib/server/collections.ts
// 集約（ランディング）ページの generateStaticParams / generateMetadata 共通実装。
// fs（loadAllPhotos）を使うためサーバー（ルート）からのみ import すること。

import type { Metadata } from "next";
import { loadAllPhotos } from "./photos";
import {
    canonicalCollectionPath,
    collectEntries,
    isIndexableCollection,
    legacyCategorySlugs,
    legacyTagSlugs,
    photosInCollection,
    labelForSlug,
    collectionCopy,
    type CollectionType,
} from "../utils/collections";
import { siteConfig } from "../utils/seo";
import { withPlaceholderParam } from "./staticParams";

/** 静的エクスポート用: そのタイプの全 slug を列挙（列挙外のパスは 404） */
export async function collectionStaticParams(type: CollectionType, paramKey: string) {
    const photos = await loadAllPhotos();
    const slugs = collectEntries(photos, type).map((e) => e.slug);
    // カテゴリは日本語表記を英語キーへ統合している。統合前に公開していた
    // `/category/風景` などもページとして残す（静的エクスポートではリダイレクトが
    // 張れず、消すとハード404になるため）。中身は統合後と同じで、canonical で寄せる。
    if (type === "category") slugs.push(...legacyCategorySlugs(photos));
    // タグも同じ別名表で統合したので、同じだけ旧URLを残す
    if (type === "tag") slugs.push(...legacyTagSlugs(photos));
    // 写真が0件でも1件は返す（空だと output: export がビルドを落とす）
    return withPlaceholderParam(slugs.map((slug) => ({ [paramKey]: slug })), paramKey);
}

/** ランディングページのメタデータ（title/description/canonical/OG/Twitter） */
export async function collectionMetadata(type: CollectionType, slug: string): Promise<Metadata> {
    const photos = await loadAllPhotos();
    const matched = photosInCollection(photos, type, slug);
    const label = labelForSlug(photos, type, slug);
    const { title, description } = collectionCopy(type, label, matched.length);
    // canonical は統合後のURLに向ける。旧スラッグ（/category/風景）でも
    // 評価が統合後（/category/landscape）にまとまるようにする。
    // 組み立ては canonicalCollectionPath に一本化した（JSON-LD 側と
    // 別々に組んでいて食い違わせた）。
    const url = `${siteConfig.url}${canonicalCollectionPath(type, slug)}`;

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
        robots: isIndexableCollection(matched.length, type) ? undefined : { index: false, follow: true },
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
