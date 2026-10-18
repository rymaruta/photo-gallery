import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CoverFrame } from "../ProfileCover";

// カバーが無いときの自分のページの額縁（#304・板 52）
describe("CoverFrame", () => {
    it("真鍮の細い縁と「ここにあなたの1枚」。押すとカバーの候補へ", () => {
        render(<CoverFrame href="/user/profile#cover-pick" locale="ja" />);
        const a = screen.getByTestId("cover-frame");
        expect(a.getAttribute("href")).toBe("/user/profile#cover-pick");
        expect(a.className).toContain("border-accent");
        expect(a.textContent).toContain("ここにあなたの1枚");
        expect(a.getAttribute("aria-label")).toBe("カバーを選ぶ。ここにあなたの1枚");
    });
});
