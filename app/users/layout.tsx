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
// **`title` を素の文字列で置くと、ルートの `template` をここで食う。**
// Next はセグメントごとに `template` を「消費」するので、素の文字列を
// 置いた時点で子（`/users/<id>`・`/users/search`）にはテンプレートが
// 降りない——実ビルドで、134ページ中この2つだけ `<title>` からサイト名が
// 落ちていた（`og:title` は各ページが自分で足していたので、同じページの
// 中で `<title>` と `og:title` が食い違っていた）。
// `default` で自分のぶんを保ち、`template` を子へ渡し直す。
export const metadata: Metadata = {
    ...appPageMetadata("/users", "ユーザー"),
    title: {
        // `default` にするとルートの template が**この行にも**掛かって
        // サイト名が2回入る（実ビルドで確認）。自分のぶんは `absolute`。
        absolute: "ユーザー | Journey Photo 旅フォトギャラリー",
        template: "%s | Journey Photo 旅フォトギャラリー",
    },
};

export default function Layout({ children }: { children: React.ReactNode }) {
    return children;
}
