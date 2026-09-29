import { describe, it, expect } from "vitest";
import { CHIP_ON, CHIP_OFF } from "../chipStyles";

/**
 * チップの定数そのもの。使う側（FilterBar など）は自分でも `focus:outline-none` を
 * 書いていることがあるので、**使う側のテストでは定数の中身を見張れない**
 * （FilterBar のテストは、定数から外しても通った）。
 */
describe("chipStyles", () => {
    const cls = (s: string) => s.split(/\s+/);

    it("どちらもブラウザ既定の輪を消し、内側 2px の輪を持つ（二重の輪にしない）", () => {
        for (const c of [CHIP_ON, CHIP_OFF]) {
            expect(cls(c)).toEqual(expect.arrayContaining(["focus:outline-hidden", "ring-inset", "focus-visible:ring-2"]));
            // outline-none だと forced-colors（ハイコントラスト）でフォーカスの印が何も残らない
            expect(cls(c)).not.toContain("focus:outline-none");
        }
    });

    it("輪の色は、非選択が真鍮・選択中が墨（白い地で真鍮は 1.93:1）", () => {
        expect(cls(CHIP_OFF)).toContain("focus-visible:ring-accent");
        expect(cls(CHIP_ON)).toContain("focus-visible:ring-ink");
        expect(cls(CHIP_ON)).not.toContain("focus-visible:ring-accent");
    });

    it("iOS の色: 非選択は bg-chip＋白12%の縁＋chip-text、選択中は primary＋墨の600", () => {
        expect(cls(CHIP_OFF)).toEqual(expect.arrayContaining(["bg-chip", "text-chip-text", "ring-1", "ring-line"]));
        expect(cls(CHIP_ON)).toEqual(expect.arrayContaining(["bg-primary", "text-ink", "font-semibold"]));
    });
});
