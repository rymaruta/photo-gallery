import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import InspiredByLine from "../InspiredByLine";

// 「この写真を見て撮影」の行の題（2026-10-18）。元の写真に題が無い（「無題」を含む）と
// 「無題」と出していた。いまは「写真」/ Photo（この行は撮影地を持たない）
describe("この写真を見て撮影: 元の写真の題", () => {
    const src = (title: unknown) => ({ id: "s1", thumb: "https://cdn.example.com/s1.webp", title } as never);
    for (const [name, title] of [["欄が無い", undefined], ["空白だけ", "  "], ["{ ja: 無題, en: Untitled }", { ja: "無題", en: "Untitled" }]] as const) {
        it(`${name} → 「写真」`, () => {
            const { container } = render(<InspiredByLine source={src(title)} locale="ja" />);
            expect(screen.getByText("写真")).toBeTruthy();
            expect(container.innerHTML).not.toMatch(/無題|Untitled/);
        });
    }
    it("英語の画面では Photo", () => {
        render(<InspiredByLine source={src({ ja: "無題", en: "Untitled" })} locale="en" />);
        expect(screen.getByText("Photo")).toBeTruthy();
    });
    it("題があればその題", () => {
        render(<InspiredByLine source={src({ ja: "朝の湖" })} locale="ja" />);
        expect(screen.getByText("朝の湖")).toBeTruthy();
    });
});
