import type { Metadata } from "next";
import { appPageMetadata } from "../../lib/utils/seo";

// このページは "use client" なので metadata を持てず、**ルートのメタデータを
// そのまま継承していた**——canonical がトップページを指し、robots は
// index, follow。兄弟（/users/search・/favorites・/login・/signup・
// /user/*・/admin/*）は全部 layout で手当て済みで、ここだけ抜けていた。
//
// `/users?id=<userId>` は、静的ページを持たない新規ユーザーの救済先
// （lib/utils/notFoundRedirect.ts）。静的な /users/<id> と中身が重なるので
// 検索結果には出さず、リンクは辿らせる（/users/search と同じ扱い）。
export const metadata: Metadata = appPageMetadata("/users", "ユーザー");

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
