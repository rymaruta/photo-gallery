import type { Metadata } from "next";
import { noindexMetadata } from "../../lib/utils/seo";

// このセグメントのページは "use client" なので metadata を持てず、
// ルートのメタデータをそのまま継承していた（canonical がトップを指す）。
// ここで上書きする。
// canonical はここで持たない。レイアウトのメタデータは子のページにも
// 継承されるので、/admin/xxx の全ページが「/admin」を正規URLとして名乗ってしまう
// （しかも /admin というページは存在しない）。
// ここでは「検索結果に出さない」だけを指定する。
export const metadata: Metadata = noindexMetadata("管理");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
