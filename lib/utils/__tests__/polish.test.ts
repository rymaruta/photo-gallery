import { describe, it, expect, vi, afterEach } from "vitest";
import { averagePixelsToHex } from "../image";
import { hapticTap } from "../haptics";

describe("averagePixelsToHex", () => {
    it("単色ピクセルはその色を返す", () => {
        // 2ピクセル分の RGBA (赤)
        const data = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255]);
        expect(averagePixelsToHex(data)).toBe("#ff0000");
    });

    it("複数色は平均される", () => {
        // 黒 + 白 → グレー
        const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
        expect(averagePixelsToHex(data)).toBe("#808080");
    });

    it("ほぼ透明なピクセルは無視する", () => {
        // 透明な白 + 不透明な赤 → 赤
        const data = new Uint8ClampedArray([255, 255, 255, 0, 255, 0, 0, 255]);
        expect(averagePixelsToHex(data)).toBe("#ff0000");
    });

    it("全ピクセル透明なら null", () => {
        const data = new Uint8ClampedArray([255, 255, 255, 0]);
        expect(averagePixelsToHex(data)).toBeNull();
    });

    it("各成分は2桁の16進にゼロ埋めされる", () => {
        const data = new Uint8ClampedArray([1, 2, 3, 255]);
        expect(averagePixelsToHex(data)).toBe("#010203");
    });
});

describe("hapticTap", () => {
    afterEach(() => vi.restoreAllMocks());

    it("navigator.vibrate があれば呼ぶ", () => {
        const vibrate = vi.fn();
        Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
        hapticTap(15);
        expect(vibrate).toHaveBeenCalledWith(15);
    });

    it("vibrate 非対応（iOS等）でも例外を投げない", () => {
        Object.defineProperty(navigator, "vibrate", { value: undefined, configurable: true });
        expect(() => hapticTap()).not.toThrow();
    });
});
