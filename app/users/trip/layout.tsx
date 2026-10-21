import type { Metadata } from "next";
import { appPageMetadata } from "../../../lib/utils/seo";

// 旅の一冊（`/users/trip?id=<userId>&p=<写真の id>`）。中身はその人の公開写真から
// 画面でまとめるので、ページは1枚だけ建てる（静的書き出し）。検索結果には出さない
// ——同じ写真は写真ページと撮影地ページが既に載せている。リンクは辿らせる
export const metadata: Metadata = appPageMetadata("/users/trip", "旅の一冊");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
