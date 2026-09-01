import type { Metadata } from "next";
import { noindexMetadata } from "../../lib/utils/seo";

// このセグメントのページは "use client" なので metadata を持てず、
// ルートのメタデータをそのまま継承していた（canonical がトップを指す）。
// ここで上書きする。
// canonical はここで持たない。レイアウトのメタデータは子のページにも
// 継承されるので、/user/xxx の全ページが「/user」を正規URLとして名乗ってしまう
// （しかも /user というページは存在しない）。
// ここでは「検索結果に出さない」だけを指定する。
export const metadata: Metadata = noindexMetadata("マイページ");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
