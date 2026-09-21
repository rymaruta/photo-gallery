import type { Metadata } from "next";
import SpotPage from "@/app/components/SpotPage";
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

/**
 * **撮影スポット詳細。**
 *
 * 本体だけ `SpotPage` に差し替えてある（タグ・カテゴリ・機材は
 * `CollectionPage` のまま）。`generateStaticParams` と `generateMetadata`
 * ——つまり **canonical・サイトマップ・`noindex` の判定**——は
 * `lib/server/collections.ts` のままで、ここでは一切変えていない。
 */
export default async function LocationPage({ params }: { params: Promise<{ location: string }> }) {
    const { location } = await params;
    return <SpotPage slug={location} />;
}
