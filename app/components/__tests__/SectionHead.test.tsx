import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SectionHead from "../SectionHead";

// 節の見出し（iOS の `JPSectionHeading`）: 眉＋消える線 → 明朝 22 → 灰の「すべて見る」
describe("SectionHead", () => {
    it("見える見出しに id。眉は読み上げに出さない", () => {
        render(<SectionHead id="h1" eyebrow="FEATURED" title="おすすめ" />);
        const h2 = screen.getByRole("heading", { level: 2, name: "おすすめ" });
        expect(h2.id).toBe("h1");
        expect(h2.className).toContain("font-serif");
        expect(h2.style.fontSize).toBe("22px");
        const eb = screen.getByText("FEATURED");
        expect(eb.getAttribute("aria-hidden")).toBe("true");
        expect(eb.className).toContain("eyebrow-line");
        expect(eb.className).toContain("text-accent");
    });

    it("行き先が無ければ「すべて見る」を出さない", () => {
        render(<SectionHead id="h1" eyebrow="FEATURED" title="おすすめ" />);
        expect(screen.queryByRole("link")).toBeNull();
    });

    it("「すべて見る」は灰（真鍮にしない）・当たり 44", () => {
        render(<SectionHead id="h1" eyebrow="GEAR" title="機材" href="/camera" moreLabel="すべて見る" />);
        const a = screen.getByRole("link", { name: "すべて見る" });
        // › は印で1つだけ（字に書かない・iOS の MoreLink・2026-10-30 束 0b C10）
        expect(a.textContent).toBe("すべて見る");
        expect(a.querySelectorAll("svg")).toHaveLength(1);
        expect(a.getAttribute("href")).toBe("/camera");
        expect(a.className).not.toContain("text-accent");
        expect(a.className).toContain("min-h-[44px]");
    });
});
