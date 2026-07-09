import { describe, it, expect } from "vitest";
import { mixWithWhite, themeRingGradient } from "../color";

describe("mixWithWhite", () => {
    it("ratio=0 で元の色のまま", () => {
        expect(mixWithWhite("#336699", 0)).toBe("#336699");
    });
    it("ratio=1 で白になる", () => {
        expect(mixWithWhite("#336699", 1)).toBe("#ffffff");
    });
    it("黒を半分混ぜるとグレー", () => {
        expect(mixWithWhite("#000000", 0.5)).toBe("#808080");
    });
    it("不正な色はそのまま返す", () => {
        expect(mixWithWhite("red", 0.5)).toBe("red");
        expect(mixWithWhite("#12345", 0.5)).toBe("#12345");
    });
});

describe("themeRingGradient", () => {
    it("テーマカラーがあればその色のグラデーション", () => {
        const g = themeRingGradient("#f472b6");
        expect(g).toContain("#f472b6");
        expect(g).toContain("conic-gradient");
    });
    it("未設定なら既定の旅パレット", () => {
        expect(themeRingGradient(undefined)).toContain("#38bdf8");
        expect(themeRingGradient(undefined)).toContain("#34d399");
    });
    it("不正な値なら既定にフォールバック", () => {
        expect(themeRingGradient("javascript:alert(1)")).toContain("#38bdf8");
    });
});
