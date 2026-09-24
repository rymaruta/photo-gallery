import type { Metadata } from "next";
import { noindexMetadata } from "../../lib/utils/seo";

// このセグメントのページは "use client" なので metadata を持てず、
// ルートのメタデータをそのまま継承してしまう（canonical がトップを指す）。
//
// **`noindexMetadata` を使う**——本人だけが見られる中身なので、検索結果に
// 出す意味が無い（`/favorites`・`/saved-spots` と同じ立場）。
export const metadata: Metadata = noindexMetadata("旅行プラン");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
