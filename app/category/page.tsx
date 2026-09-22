import type { Metadata } from "next";
import CollectionIndexPage from "@/app/components/CollectionIndexPage";
import { collectionIndexMetadata } from "@/lib/server/collections";

// 「すべて見る」の行き先。個別ページ（`app/category/[category]/page.tsx`）と同居する
// ——`/category` と `/category/<slug>` は静的書き出しでも別のファイルになる
// （`out/category.html` と `out/category/<slug>.html`。`/search` が前から同じ形）
export async function generateMetadata(): Promise<Metadata> {
    return collectionIndexMetadata("category");
}

export default function Page() {
    return <CollectionIndexPage type="category" />;
}
