import type { Metadata } from "next";
import { appPageMetadata } from "../../../lib/utils/seo";

// 本人だけの画面（Pro の光と天気の知らせ）。検索結果には出さない（設定と同じ形）
export const metadata: Metadata = appPageMetadata("/user/light", "光と天気の知らせ");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
