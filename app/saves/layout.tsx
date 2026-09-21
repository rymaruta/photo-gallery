import type { Metadata } from "next";
import { appPageMetadata } from "../../lib/utils/seo";

// このセグメントのページは "use client" なので metadata を持てず、
// ルートのメタデータをそのまま継承する（canonical がトップを指す）。
// ここで上書きする。
// 題は画面の見出し・フッターのリンクと同じ言葉にする
// （`/favorites` が「いいねした写真」、こちらが「保存した写真」）。
export const metadata: Metadata = appPageMetadata("/saves", "保存した写真");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
