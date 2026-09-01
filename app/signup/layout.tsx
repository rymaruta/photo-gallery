import type { Metadata } from "next";
import { appPageMetadata } from "../../lib/utils/seo";

// このセグメントのページは "use client" なので metadata を持てず、
// ルートのメタデータをそのまま継承していた（canonical がトップを指す）。
// ここで上書きする。
export const metadata: Metadata = appPageMetadata("/signup", "新規登録");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
