// lib/server/collections.ts
// 集約（ランディング）ページの generateStaticParams / generateMetadata 共通実装。
// fs（loadAllPhotos）を使うためサーバー（ルート）からのみ import すること。

import type { Metadata } from "next";
import { loadAllPhotos } from "./photos";
import {
    canonicalCollectionPath,
    collectEntries,
    collectionIndexCopy,
    collectionIndexPath,
    isIndexableCollection,
    isIndexableCollectionIndex,
    legacyCategorySlugs,
    legacyTagSlugs,
    photosInCollection,
    labelForSlug,
    collectionCopy,
    type CollectionType,
} from "../utils/collections";
import { siteConfig, publicImageUrl } from "../utils/seo";
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
    // 出すURLはサイトのドメインに揃える（`publicImageUrl`）
    const image = rawImage ? publicImageUrl(rawImage) : undefined;

    return {
        title,
        description,
        keywords: [label, "旅", "写真", "フォトギャラリー"].filter(Boolean),
        alternates: { canonical: url },
        // 写真が少ないページは検索エンジンに載せない。定型文だけのページを
        // 大量に作ると「中身の薄いサイト」と判断され、サイト全体の評価が
        // 下がる。サイト内から辿る分には見られる。
        // **線は種別で違う**（タグ・カテゴリ・機材は3枚、撮影地は2枚）ので、
        // 枚数の条件はここに書かず `isIndexableCollection` に集めてある。
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

/**
 * **索引ページ**（`/category` `/location` `/camera`）のメタデータ。
 *
 * `robots` の線は `isIndexableCollectionIndex`（載せる中身が何件あるか）で
 * 決める。**枚数ではなく件数**——索引の中身はエントリの一覧なので、
 * 1〜2件しか無い索引は個別ページと中身がほぼ同じになる。
 */
export async function collectionIndexMetadata(type: CollectionType): Promise<Metadata> {
    const photos = await loadAllPhotos();
    const entries = collectEntries(photos, type);
    const { title, description } = collectionIndexCopy(type, entries.length);
    const url = `${siteConfig.url}${collectionIndexPath(type)}`;
    const first = photosInCollection(photos, type, entries[0]?.slug ?? "")[0];
    const rawImage = first?.thumbSrc || first?.src;
    const image = rawImage ? publicImageUrl(rawImage) : undefined;

    return {
        title,
        description,
        alternates: { canonical: url },
        robots: isIndexableCollectionIndex(entries.length) ? undefined : { index: false, follow: true },
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
