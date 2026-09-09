import type { Metadata } from "next";
import { appPageMetadata } from "../../../lib/utils/seo";

// 本人だけの画面。検索結果には出さない
export const metadata: Metadata = appPageMetadata("/user/albums", "共同アルバム");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
