import type { Metadata } from "next";
import { siteConfig } from "../../lib/utils/seo";

// このセグメントのページは "use client" なので metadata を持てない。
// `appPageMetadata` は noindex を付ける（ログイン後の画面用）が、
// 撮影地マップは**公開の入口**なので検索に出してよい。canonical だけ揃える。
export const metadata: Metadata = {
    title: "撮影地マップ",
    description: "旅の写真を撮影地の地図から探す。ピンの位置は約1kmの粒度に丸めています。",
    alternates: { canonical: `${siteConfig.url}/map` },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
