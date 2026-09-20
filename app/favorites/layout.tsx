import type { Metadata } from "next";
import { appPageMetadata } from "../../lib/utils/seo";

// このセグメントのページは "use client" なので metadata を持てず、
// ルートのメタデータをそのまま継承していた（canonical がトップを指す）。
// ここで上書きする。
// 題は画面の見出し・フッターのリンクと同じ言葉にする（ここだけ「お気に入り」だった）
export const metadata: Metadata = appPageMetadata("/favorites", "いいねした写真");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
