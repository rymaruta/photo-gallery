import type { Metadata } from "next";
import { appPageMetadata } from "../../../lib/utils/seo";

// 本人だけの画面。検索結果には出さない（`/favorites` と同じ形）。
// `robots.txt` 側は追記不要——`app/robots.ts` の disallow に `/user/` が
// 既に入っているので、この下は丸ごとクロール対象外。
export const metadata: Metadata = appPageMetadata("/user/settings", "設定");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
