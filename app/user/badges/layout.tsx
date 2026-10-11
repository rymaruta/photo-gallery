import type { Metadata } from "next";
import { appPageMetadata } from "../../../lib/utils/seo";

// 本人だけの画面（`/user/settings` と同じ形）。`robots.txt` は `/user/` を丸ごと拒否している
export const metadata: Metadata = appPageMetadata("/user/badges", "メダル");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
