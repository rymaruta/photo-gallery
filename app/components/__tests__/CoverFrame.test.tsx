import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CoverFrame, coverIsMissing } from "../ProfileCover";

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

// 額縁を出すかの HEAD の読み方（2026-10-18 再見直し）: 404 だけ「無い」。200・403・圏外は出さない
describe("coverIsMissing", () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
    const answer = (status: number) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status }));

    it("404 なら無い（HEAD・控えを使わない）", async () => {
        answer(404);
        expect(await coverIsMissing("https://site.test/profiles/u/cover")).toBe(true);
        expect((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1]).toEqual({ method: "HEAD", cache: "no-store" });
    });

    it("200・403・圏外・URL なしは「無い」と言わない（403 は警告に残す）", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        answer(200);
        expect(await coverIsMissing("https://site.test/c")).toBe(false);
        answer(403);
        expect(await coverIsMissing("https://site.test/c")).toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
        expect(await coverIsMissing("https://site.test/c")).toBe(false);
        expect(await coverIsMissing("")).toBe(false);
    });
});
