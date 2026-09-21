import type { Metadata } from "next";
import { noindexMetadata } from "../../lib/utils/seo";

// このセグメントのページは "use client" なので metadata を持てず、
// ルートのメタデータをそのまま継承してしまう（canonical がトップを指す）。
//
// **`noindexMetadata` を使う**——本人だけが見られる一覧なので、
// 検索結果に出す意味が無い（`/favorites` と同じ立場）。
// canonical も出さない（理由は `noindexMetadata` のコメント）。
export const metadata: Metadata = noindexMetadata("行きたい場所");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
