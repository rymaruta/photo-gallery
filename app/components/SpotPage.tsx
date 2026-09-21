// app/components/SpotPage.tsx（サーバーコンポーネント）
//
// **撮影スポット詳細。`/location/<スラッグ>` の本体。**
//
// `/spot/...` という2つ目の「場所のページ」は作らない——同じものを二度
// 作る形で、このリポジトリが何度も踏んでいる。既にある集約ページを育てる。
//
// **SEO の判定には一切触っていない。** `generateStaticParams` /
// `generateMetadata`（canonical・サイトマップ・`noindex`）は
// `lib/server/collections.ts` のまま、`collectEntries` /
// `isIndexableCollection` も素通り。変えたのは**画面に出る中身だけ**。
//
// タグ・カテゴリ・機材は `CollectionPage` のまま（この画面は撮影地専用）。

import { notFound } from "next/navigation";
import SpotPageClient from "./SpotPageClient";
import { loadAllPhotos } from "@/lib/server/photos";
import {
    photosInCollection,
    labelForSlug,
    collectionCopy,
    collectionPath,
    canonicalCollectionPath,
    relatedEntries,
} from "@/lib/utils/collections";
import { relatedCollectionPhotos, slimForGrid } from "@/lib/utils/related";
import { spotDetail } from "@/lib/utils/spot";
import { siteConfig, generateStructuredData, generateBreadcrumbStructuredData } from "@/lib/utils/seo";

/** 「ほかにこんな写真も」を出す枚数の線。これ未満のページにだけ足す（`CollectionPage` と同じ） */
const RELATED_PHOTOS_WHEN_FEWER_THAN = 6;

const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");

export default async function SpotPage({ slug }: { slug: string }) {
    const photos = await loadAllPhotos();
    const matched = photosInCollection(photos, "location", slug);
    if (matched.length === 0) notFound();

    const label = labelForSlug(photos, "location", slug);
    const { heading, description, breadcrumb } = collectionCopy("location", label, matched.length);
    const pageUrl = `${siteConfig.url}${canonicalCollectionPath("location", slug)}`;

    // **材料は1本の純関数から受け取る**（`initialRelatedFor` と同じ立場）。
    // ここで組み立てると、絞り込みを1つ消しても誰も気づかない形になる
    const { facts, coords, broader, narrower, nearby } = spotDetail(photos, label, matched);

    const link = (e: { slug: string; label: string; count: number }) => ({
        label: e.label, count: e.count, path: collectionPath("location", e.slug),
    });

    // 同タイプの他ページへの相互リンク（孤立防止・回遊・SEO）。**既存のまま**
    const related = relatedEntries(photos, "location", slug, 12).map(link);

    const nearbyPhotos = matched.length < RELATED_PHOTOS_WHEN_FEWER_THAN
        ? relatedCollectionPhotos(matched, photos, 6)
        : [];

    // **クライアントへ渡すのはグリッドが読む項目だけ**（`CollectionPage` と同じ）。
    // **JSON-LD は絞る前の `matched` から作る**（あちらが項目を増やした日に
    // 構造化データだけ黙って痩せるのを避ける）
    const galleryData = generateStructuredData(matched, { name: heading, description, url: pageUrl });
    const breadcrumbData = generateBreadcrumbStructuredData([
        { name: "ホーム", url: siteConfig.url },
        { name: breadcrumb, url: pageUrl },
    ]);

    return (
        <>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(galleryData) }} />
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbData) }} />
            <SpotPageClient
                slug={slug}
                name={label}
                heading={heading}
                description={description}
                breadcrumb={breadcrumb}
                photos={matched.map(slimForGrid)}
                nearbyPhotos={nearbyPhotos.map(slimForGrid)}
                facts={facts}
                coords={coords}
                broader={broader.map(link)}
                narrower={narrower.map(link)}
                nearby={nearby.map((n) => ({ ...link(n), km: n.km, approx: n.approx }))}
                related={related}
            />
        </>
    );
}
