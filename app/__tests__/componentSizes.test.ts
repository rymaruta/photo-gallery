import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHIP_SIZE } from "../components/chipStyles";
import { BTN_FILL, BTN_LINE } from "../components/buttonStyles";

/**
 * **部品の高さを iOS のデザイン v2 にそろえる**（2026-10-15・板 Components 01・02）。
 *   チップ 34 ／ 塗りの主ボタン 50 ／ 線の副ボタン 44（iOS の `JPHeight`）
 * jsdom は寸法を計算しないので、**定数の値と、それを使っている画面**を見る。
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("チップは高さ 34・字 13（v2 の .chip）", () => {
    it("CHIP_SIZE の値", () => {
        expect(CHIP_SIZE).toEqual({ fontSize: "13px", lineHeight: "18px", padding: "7px 14px", minHeight: "34px" });
    });

    it.each([
        ["app/components/FilterBar.tsx", 2],
        ["app/components/SpotIndexClient.tsx", 2],
        ["app/components/DiscoverRail.tsx", 2],
        ["app/search/DiscoverSections.tsx", 1],
        ["app/components/SpotGuideClient.tsx", 1],
        ["app/components/SpotTopicLists.tsx", 1],
        ["app/components/SpotAreaIndexClient.tsx", 1],
    ] as const)("%s は CHIP_SIZE で寸法を取る（%i か所）", (file, n) => {
        const src = read(file);
        expect(count(src, "...CHIP_SIZE") + count(src, "style={CHIP_SIZE}")).toBe(n);
    });
});

describe("塗りの主ボタンは高さ 50、線の副ボタンは高さ 44（v2 の .bw / .bb / .bo）", () => {
    it("定数の値（px で持つ——rem の段に頼らない）", () => {
        const f = BTN_FILL.split(/\s+/);
        expect(f).toEqual(expect.arrayContaining(["min-h-[50px]", "text-[16px]", "font-semibold", "rounded-full"]));
        const l = BTN_LINE.split(/\s+/);
        expect(l).toEqual(expect.arrayContaining(["min-h-[44px]", "text-[15px]", "font-semibold", "rounded-full", "ring-1", "ring-line-strong"]));
        // 色は持たない（写真のある画面は白、無い画面は真鍮——画面が決める）
        expect(BTN_FILL).not.toMatch(/\bbg-/);
    });

    it.each([
        ["app/login/page.tsx", 4],
        ["app/signup/page.tsx", 3],
        ["app/admin/login/page.tsx", 1],
        ["app/user/profile/page.tsx", 1],
        ["app/user/edit/page.tsx", 1],
        ["app/NotFoundClient.tsx", 1],
        ["app/components/ErrorBoundary.tsx", 1],
        ["app/components/LegalGate.tsx", 1],
    ] as const)("%s の主ボタンは BTN_FILL（%i か所）で、py-3 の古い形が残っていない", (file, n) => {
        const src = read(file);
        expect(count(src, "${BTN_FILL}")).toBe(n);
        const old = src.split("\n").filter((l) => /\bbg-accent-fill\b/.test(l) && /\bpy-3(\.5)?\b/.test(l));
        expect(old).toEqual([]);
    });

    it.each([
        ["app/q/DailyQuizClient.tsx", 1],
        ["app/user/light/page.tsx", 1],
    ] as const)("%s の線のボタンは BTN_LINE（%i か所）", (file, n) => {
        expect(count(read(file), "${BTN_LINE}")).toBe(n);
    });
});
