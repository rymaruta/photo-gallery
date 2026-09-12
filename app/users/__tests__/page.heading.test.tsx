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
// id がある枝は別のテストが見ている（UserProfileClient.*.test.tsx）
vi.mock("../UserProfileClient", () => ({ default: () => <main><h1>プロフィール</h1></main> }));
vi.mock("next/link", () => ({
    default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const UsersPage = (await import("../page")).default;

describe("/users の見出し", () => {
    it("id が無くても見出しがある", async () => {
        params.current = new URLSearchParams("");
        render(<UsersPage />);
        expect(await screen.findByText(/ユーザーIDが指定されていません/)).toBeInTheDocument();
        expect(document.querySelectorAll("h1").length, "見出しが1つでない").toBe(1);
    });

    it("id があるときはプロフィール側の見出しが1つ（二重に置かない）", async () => {
        params.current = new URLSearchParams("id=u1");
        render(<UsersPage />);
        expect(await screen.findByText("プロフィール")).toBeInTheDocument();
        expect(document.querySelectorAll("h1").length, "見出しが2つになっている").toBe(1);
    });
});
