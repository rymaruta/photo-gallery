import type { Metadata } from "next";
import CollectionIndexPage from "@/app/components/CollectionIndexPage";
import { collectionIndexMetadata } from "@/lib/server/collections";

// 「すべて見る」の行き先。個別ページ（`app/camera/[camera]/page.tsx`）と同居する
// ——`/camera` と `/camera/<slug>` は静的書き出しでも別のファイルになる
// （`out/camera.html` と `out/camera/<slug>.html`。`/search` が前から同じ形）
export async function generateMetadata(): Promise<Metadata> {
    return collectionIndexMetadata("camera");
}

export default function Page() {
    return <CollectionIndexPage type="camera" />;
}
