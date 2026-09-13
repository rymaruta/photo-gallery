import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * **どの状態でも見出しが1つあること。**
 *
 * 全141ページを実ブラウザで走査して出た（2026-09-12）。`/users`（`?id=` の
 * 受け皿）は **id が無いときに見出しが1つも無かった**——リンクを共有する
 * 途中でクエリが落ちると、人はこの画面に着地する。読み上げは見出しで
 * ページを渡り歩くので、そこに入口が無い。
 *
 * 足したのは `sr-only` の見出し＝**見た目は変えない**。
 */
const params = vi.hoisted(() => ({ current: new URLSearchParams("") }));
vi.mock("next/navigation", () => ({ useSearchParams: () => params.current }));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));
// **見出しを持たない偽物を置く。**
//
// 以前は `<main><h1>プロフィール</h1></main>` を返す偽物だったので、
// 「二重にならない」のテストが数えていたのは**偽物が自分で描いた h1**
// だった＝`page.tsx` の id 枝に h1 を足す変異が素通りする（レビュー指摘）。
// 見出しの無い偽物にすると、**このファイルが h1 を足したかどうか**だけが
// 数に出る。本物の `UserProfileClient` が h1 を1つ持つことは
// `UserProfileClient.*.test.tsx` 側の話。
vi.mock("../UserProfileClient", () => ({ default: () => <main data-testid="profile" /> }));
vi.mock("next/link", () => ({
    default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const UsersPage = (await import("../page")).default;

describe("/users の見出し", () => {
    it("id が無くても見出しがある", async () => {
        params.current = new URLSearchParams("");
        render(<UsersPage />);
        expect(await screen.findByText(/ユーザーIDが指定されていません/)).toBeInTheDocument();
        const hs = document.querySelectorAll("h1");
        expect(hs.length, "見出しが1つでない").toBe(1);
        // 文字も見る。個数だけだと ja/en の取り違えが素通りする（レビュー指摘）
        expect(hs[0].textContent).toBe("ユーザー");
    });

    it("id があるときは、このページ自身は見出しを足さない", async () => {
        params.current = new URLSearchParams("id=u1");
        render(<UsersPage />);
        expect(await screen.findByTestId("profile")).toBeInTheDocument();
        // 本物のプロフィールは自分で h1 を1つ持つので、ここで足すと二重になる
        expect(document.querySelectorAll("h1").length, "このページが余計な見出しを足している").toBe(0);
    });
});
