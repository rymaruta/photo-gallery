import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * **土台の値を iOS のデザイン v2 にそろえてある**ことを見張る（2026-10-15）。
 *
 * 出どころは iOS（journey.photo-ios の origin/main）の
 * `Sources/JourneyPhoto/Core/Design/BrandPalette.swift`・`WebTheme.swift`。
 * iOS の作業ツリーは CI に無いので、**値をここに写して**突き合わせる——
 * どちらかを変えたら、もう片方とこの表を同じ回に直す。
 *
 * v1 の値（#121212・#1a1a1a・#201b11・#ebebeb・白12% の線）に戻ると落ちる。
 */
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
/** `@theme` の中身（注記は落とす——注記は v1 の値を経緯として書いている） */
const theme = css.slice(css.indexOf("@theme {"), css.indexOf("}", css.indexOf("@theme {"))).replace(/\/\*[\s\S]*?\*\//g, "");
const tok = (name: string) => {
    const m = new RegExp(`--color-${name}:\\s*([^;]+);`, "i").exec(theme);
    expect(m, `--color-${name} が @theme に無い`).not.toBeNull();
    return m![1].trim().toLowerCase();
};

/** iOS の `BrandPalette`（不透明の値） */
const IOS_HEX: Array<[string, string, string]> = [
    ["bg", "#000000", "background"],
    ["surface", "#0e0e0f", "surface（札・v2 surface-1）"],
    ["surface-2", "#161617", "surface2（入力欄・シート）"],
    ["surface-3", "#1a1a1c", "surface3"],
    ["surface-4", "#1c1c1e", "surface4"],
    ["surface-5", "#1e1e20", "surface5"],
    ["surface-6", "#28282a", "surface6"],
    ["surface-7", "#2a2a2c", "surface7"],
    ["surface-8", "#2c2c2e", "surface8"],
    ["outline", "#666666", "outline"],
    ["chip-text", "#d4d4d4", "chipText"],
    ["text-2", "#b8b8b8", "text2"],
    ["text-3", "#9a9a9a", "text3"],
    ["primary", "#f0f0f0", "primary（白94%）"],
    ["ink", "#07090a", "ink"],
    ["accent", "#c9a66b", "accent"],
    ["accent-strong", "#e3c98f", "accentStrong"],
    ["accent-fill", "#b8955a", "accentFill"],
    ["accent-deep", "#796440", "accentDeep"],
    ["accent-soft", "#1c170e", "accentSoft（案内の帯・v2）"],
    ["accent-hi", "#f3dca6", "accentHighlight"],
    ["accent-lo", "#9a7a45", "accentShadow"],
    ["danger", "#f0565a", "danger"],
    ["danger-fill", "#c8323a", "dangerFill"],
    ["success", "#7fc489", "success"],
    ["location", "#9cc3e6", "location"],
];

/** iOS の `WebTheme`（白の透過で持つ値） */
const IOS_WHITE_ALPHA: Array<[string, number, string]> = [
    ["line", 0.08, "hairline（区切り線・札の縁・チップの縁）"],
    ["line-strong", 0.14, "line（線のボタン・入力欄の縁）"],
    ["chip", 0.07, "surface（チップの面）"],
];

describe("土台の値は iOS のデザイン v2 と同じ", () => {
    it.each(IOS_HEX)("--color-%s = %s（iOS の %s）", (name, hex) => {
        expect(tok(name)).toBe(hex);
    });

    it.each(IOS_WHITE_ALPHA)("--color-%s = 白 %s（iOS の %s）", (name, alpha) => {
        expect(tok(name).replace(/\s+/g, " ")).toBe(`rgb(255 255 255 / ${alpha})`);
    });

    it("面の段は暗い → 明るいの順に並ぶ（iOS の surfaceSteps と同じ並び）", () => {
        const lum = (hex: string) => {
            const n = parseInt(hex.slice(1), 16);
            return ((n >> 16) & 255) * 0.2126 + ((n >> 8) & 255) * 0.7152 + (n & 255) * 0.0722;
        };
        const steps = ["bg", "surface", "surface-2", "surface-3", "surface-4", "surface-5", "surface-6", "surface-7", "surface-8"]
            .map((n) => lum(tok(n)));
        for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    });

    it("v1 の値が @theme に残っていない", () => {
        for (const old of ["#121212", "#1a1a1a", "#201b11", "#ebebeb", "/ 0.12)"]) {
            expect(theme.toLowerCase(), old).not.toContain(old);
        }
    });
});
