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
    const pageUrl = `${siteConfig.url}${collectionPath(type, slug)}`;

    const galleryData = generateStructuredData(matched);
    const breadcrumbData = generateBreadcrumbStructuredData([
        { name: "ホーム", url: siteConfig.url },
        { name: breadcrumb, url: pageUrl },
    ]);

    return (
        <>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(galleryData) }} />
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbData) }} />
            <CollectionPageClient photos={matched} heading={heading} description={description} breadcrumb={breadcrumb} />
        </>
    );
}
