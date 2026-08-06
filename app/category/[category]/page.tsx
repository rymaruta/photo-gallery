import type { Metadata } from "next";
import CollectionPage from "@/app/components/CollectionPage";
import { collectionStaticParams, collectionMetadata } from "@/lib/server/collections";

// 静的エクスポート: 列挙した slug のみ生成し、それ以外は 404
export const dynamicParams = false;

export function generateStaticParams() {
    return collectionStaticParams("category", "category");
}

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
    const { category } = await params;
    return collectionMetadata("category", category);
}

export default async function CategoryPage({ params }: { params: Promise<{ category: string }> }) {
    const { category } = await params;
    return <CollectionPage type="category" slug={category} />;
}
