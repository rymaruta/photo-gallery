import type { Metadata } from "next";
import CollectionPage from "@/app/components/CollectionPage";
import { collectionStaticParams, collectionMetadata } from "@/lib/server/collections";

// 静的エクスポート: 列挙した slug のみ生成し、それ以外は 404
export const dynamicParams = false;

export function generateStaticParams() {
    return collectionStaticParams("tag", "tag");
}

export async function generateMetadata({ params }: { params: Promise<{ tag: string }> }): Promise<Metadata> {
    const { tag } = await params;
    return collectionMetadata("tag", tag);
}

export default async function TagPage({ params }: { params: Promise<{ tag: string }> }) {
    const { tag } = await params;
    return <CollectionPage type="tag" slug={tag} />;
}
