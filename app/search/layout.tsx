import type { Metadata } from "next";
import { appPageMetadata } from "../../lib/utils/seo";

// この配下は "use client" なので metadata を持てない。ここで上書きする
// （書かないとルートのメタデータを継いで canonical がトップを指す）。
//
// **検索結果に出さない。** いまはトップと同じ絞り込みと一覧を出しているので、
// 索引に入れると同じ中身が2つの URL に載る。リンクは辿ってよい
// （`appPageMetadata` は `index:false, follow:true`）。
export const metadata: Metadata = appPageMetadata("/search", "さがす");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
