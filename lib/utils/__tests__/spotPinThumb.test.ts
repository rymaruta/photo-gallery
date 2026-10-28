import { describe, it, expect } from "vitest";
import { SPOT_THUMB_BASE, spotPinThumbSrc } from "../spotPinThumb";

// 地図の撮影スポットのピンの写真。決まった場所なら「在る」の印だけで届く（ページ本体を軽くする）
describe("spotPinThumbSrc", () => {
    it("印（true）なら決まった場所", () => {
        expect(spotPinThumbSrc({ slug: "abukumado", thumb: true })).toBe(`${SPOT_THUMB_BASE}abukumado.jpg`);
    });
    it("文字列ならその場所", () => {
        expect(spotPinThumbSrc({ slug: "a", thumb: "/images/spots/thumb/other.jpg" })).toBe("/images/spots/thumb/other.jpg");
    });
    it("無ければ undefined（真鍮の丸にカメラ）", () => {
        expect(spotPinThumbSrc({ slug: "a" })).toBeUndefined();
        expect(spotPinThumbSrc({ slug: "a", thumb: "" })).toBeUndefined();
    });
});
