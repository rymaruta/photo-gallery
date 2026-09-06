import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ROUTES } from "@/lib/routes";

vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));

const Footer = (await import("../Footer")).default;

describe("フッターの導線", () => {
    it("撮影地マップへのリンクを出す（メニューの中にしか無かった）", () => {
        render(<Footer />);
        const links = screen.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);
        expect(links).toContainEqual(["撮影地マップ", ROUTES.MAP]);
        // 既存の並びを壊さない
        expect(links).toContainEqual(["作品", ROUTES.HOME]);
        expect(links).toContainEqual(["いいねした写真", ROUTES.FAVORITES]);
        expect(links).toContainEqual(["プライバシーポリシー", ROUTES.PRIVACY]);
    });
});
