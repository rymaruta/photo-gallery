import type { Metadata } from "next";
import CollectionPage from "@/app/components/CollectionPage";
import { collectionStaticParams, collectionMetadata } from "@/lib/server/collections";

// 静的エクスポート: 列挙した slug のみ生成し、それ以外は 404
export const dynamicParams = false;

export function generateStaticParams() {
    return collectionStaticParams("location", "location");
}

export async function generateMetadata({ params }: { params: Promise<{ location: string }> }): Promise<Metadata> {
    const { location } = await params;
    return collectionMetadata("location", location);
}

export default async function LocationPage({ params }: { params: Promise<{ location: string }> }) {
    const { location } = await params;
    return <CollectionPage type="location" slug={location} />;
}
