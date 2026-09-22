import type { Metadata } from "next";
import CollectionIndexPage from "@/app/components/CollectionIndexPage";
import { collectionIndexMetadata } from "@/lib/server/collections";

// 「すべて見る」の行き先。個別ページ（`app/location/[location]/page.tsx`）と同居する
// ——`/location` と `/location/<slug>` は静的書き出しでも別のファイルになる
// （`out/location.html` と `out/location/<slug>.html`。`/search` が前から同じ形）
export async function generateMetadata(): Promise<Metadata> {
    return collectionIndexMetadata("location");
}

export default function Page() {
    return <CollectionIndexPage type="location" />;
}
