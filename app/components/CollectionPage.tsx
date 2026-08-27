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
import { siteConfig, generateStructuredData, generateBreadcrumbStructuredData } from "@/lib/utils/seo";

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
            <CollectionPageClient photos={matched} heading={heading} description={description} breadcrumb={breadcrumb} type={type} related={related} />
        </>
    );
}
