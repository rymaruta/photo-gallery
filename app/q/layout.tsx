import type { Metadata } from "next";
import { noindexMetadata } from "../../lib/utils/seo";

// **検索結果に出さない。** 中身は日ごとに変わり、HTML には問題が入っていない
// （画面が日付のファイルを読む）ので、検索に出しても空の殻が載るだけ。
// 共有されたリンクの見出しと説明だけ付ける。
export const metadata: Metadata = {
    ...noindexMetadata("今日の一問"),
    description: "毎日1枚、撮影スポットの写真。4つの中からどこかを当てる。",
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
