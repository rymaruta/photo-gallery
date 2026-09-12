// app/components/CollectionPage.tsx（サーバーコンポーネント）
// JSON-LD（ImageGallery / パンくず）を静的HTMLに出力し、本体は CollectionPageClient に委譲する。

import { notFound } from "next/navigation";
import CollectionPageClient from "./CollectionPageClient";
import { loadAllPhotos } from "@/lib/server/photos";
import {
    photosInCollection,
    labelForSlug,
    collectionCopy,
    collectionPath,
    canonicalCollectionPath,
    relatedEntries,
    type CollectionType,
} from "@/lib/utils/collections";
import { relatedCollectionPhotos, slimForGrid } from "@/lib/utils/related";
import { siteConfig, generateStructuredData, generateBreadcrumbStructuredData } from "@/lib/utils/seo";

/** 「ほかにこんな写真も」を出す枚数の線。これ未満のページにだけ足す */
const RELATED_PHOTOS_WHEN_FEWER_THAN = 6;

const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

export default async function CollectionPage({ type, slug }: { type: CollectionType; slug: string }) {
    const photos = await loadAllPhotos();
    const matched = photosInCollection(photos, type, slug);
    if (matched.length === 0) notFound();

    const label = labelForSlug(photos, type, slug);
    const { heading, description, breadcrumb } = collectionCopy(type, label, matched.length);
    // canonical と同じURLを名乗る（旧カテゴリなら統合後）。
    // 別々に組んでいた頃は、/category/風景 の canonical が
    // /category/landscape なのに JSON-LD は /category/風景 を名乗っていた。
    const pageUrl = `${siteConfig.url}${canonicalCollectionPath(type, slug)}`;
    // 同タイプの他ページへの相互リンク（孤立防止・回遊・SEO）
    const related = relatedEntries(photos, type, slug, 12).map((e) => ({
        label: e.label,
        count: e.count,
        path: collectionPath(type, e.slug),
    }));

    // **薄いページを、読む価値のあるページにする。**
    // 実データの `/location/*` は14ページ中10ページが2枚以下だった。
    // 写真が少ないページにだけ足す——たくさん並ぶページに足すと、
    // 主役（そのページの写真）が薄まるだけで得が無い。
    const nearby = matched.length < RELATED_PHOTOS_WHEN_FEWER_THAN
        ? relatedCollectionPhotos(matched, photos, 6)
        : [];

    // **クライアントへ渡すのはグリッドが読む項目だけ。**
    // 丸ごと渡すと、説明も EXIF もタグも付いた写真が RSC ペイロードに載る
    // （実測 `/category/landscape` で description 19回・exif 15回）。
    // **JSON-LD は絞る前の `matched` から作る。**
    // 今は結果が同じ（`generateStructuredData` が読むのは `id` / `title` /
    // `src` の3つで、どれも絞ったあとにも在る＝**この選択は等価**・変異でも
    // 落ちない）。それでも絞る前から作るのは、**あちらが項目を増やした日に
    // 構造化データだけ黙って痩せる**のを避けるため（例: 画像ごとに説明を
    // 足すのは素直な改善で、そのとき `gridPhotos` からでは出せない）
    const gridPhotos = matched.map(slimForGrid);
    const gridNearby = nearby.map(slimForGrid);

    const galleryData = generateStructuredData(matched, {
        name: heading,
        description,
        url: pageUrl,
    });
    const breadcrumbData = generateBreadcrumbStructuredData([
        { name: "ホーム", url: siteConfig.url },
        { name: breadcrumb, url: pageUrl },
    ]);

    return (
        <>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(galleryData) }} />
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbData) }} />
            <CollectionPageClient photos={gridPhotos} heading={heading} description={description} breadcrumb={breadcrumb} type={type} related={related} nearby={gridNearby} />
        </>
    );
}
