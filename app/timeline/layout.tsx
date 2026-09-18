import type { Metadata } from "next";
import { appPageMetadata } from "../../lib/utils/seo";

// ページ本体は "use client" なので metadata を持てない。`/favorites` と同じ形で
// ここに置く（noindex・canonical は自分）。ログインした人だけの面で、
// `robots.txt` でも取りに来させない
export const metadata: Metadata = appPageMetadata("/timeline", "タイムライン");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
