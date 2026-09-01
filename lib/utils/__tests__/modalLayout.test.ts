import { describe, it, expect } from "vitest";
import { resolvedMinHeights, minHeightsFitViewport, IMAGE_MIN_HEIGHT, CAPTION_MIN_HEIGHT } from "../modalLayout";

// **横向きでキャプションの下部に指が届かなかった（TAP-7）。**
// 画像 300px + キャプション 200px の固定下限が、外枠（95vh）を超えていた。
// 実測（修正前）: 667x375 で最後の行が画面外に118px、568x320 で169px。
describe("モーダルの高さの下限は画面に収まる", () => {
    // 横向きのスマホの高さ（320〜430）と、縦向き（568〜932）
    it.each([320, 360, 375, 390, 414, 430, 568, 667, 736, 844, 932])(
        "高さ %ipx で収まる", (vh) => {
            expect(minHeightsFitViewport(vh), `下限の合計が ${vh}px の枠を超えている`).toBe(true);
        });

    // **固定 px に戻すと落ちること**を、同じ式で確かめる（この不変条件が
    // 「たまたま満たされている」のではないことを示す）
    it("固定 300px + 200px は低い画面で収まらない", () => {
        const fixedFits = (vh: number) => 300 + 200 <= vh * 0.95;
        expect(fixedFits(375), "修正前の値で 375px に収まってしまっている").toBe(false);
        expect(fixedFits(320)).toBe(false);
        // 527px 以上なら固定値でも収まる（縦向きで問題が出なかった理由）
        expect(fixedFits(667)).toBe(true);
    });

    // 縦向きでは見た目を変えない（min() が固定値を選ぶ）
    it("高さ 667px 以上では今までと同じ下限", () => {
        expect(resolvedMinHeights(667)).toEqual({ image: 300, caption: 200 });
        expect(resolvedMinHeights(932)).toEqual({ image: 300, caption: 200 });
    });

    it("低い画面では両方が小さくなる", () => {
        const m = resolvedMinHeights(375);
        expect(m.image).toBeCloseTo(168.75);
        expect(m.caption).toBeCloseTo(112.5);
    });

    // CSS 側と定数がずれていないか（実装が読む値そのもの）
    it("CSS の式と一致している", () => {
        expect(IMAGE_MIN_HEIGHT).toBe("min(300px, 45vh)");
        expect(CAPTION_MIN_HEIGHT).toBe("min(200px, 30vh)");
    });
});
