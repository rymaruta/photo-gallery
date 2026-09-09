import type { Metadata } from "next";
import { appPageMetadata } from "../../lib/utils/seo";

// 招待ページは**私的なリンク**。検索結果に出さない
// （`appPageMetadata` が `robots: { index: false, follow: true }` を付ける）。
// sitemap にも載せない——`app/sitemap.ts` は写真と集約ページだけを列挙する。
export const metadata: Metadata = appPageMetadata("/j", "アルバムへの招待");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
