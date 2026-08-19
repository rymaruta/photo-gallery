import { describe, it, expect } from "vitest";
import { isImageReady } from "../imageReady";

// 静的HTMLの <img> は、再訪時にハイドレーション前へ読み込みが終わることがある。
// React は取り逃した load を再発火しないため、画像が透明のまま残る回帰を防ぐ。
const img = (complete: boolean, naturalWidth: number) =>
    ({ complete, naturalWidth }) as HTMLImageElement;

describe("isImageReady", () => {
    it("読み込み済みなら true", () => {
        expect(isImageReady(img(true, 800))).toBe(true);
    });
    it("読み込み中は false", () => {
        expect(isImageReady(img(false, 0))).toBe(false);
    });
    it("complete でも実体が無ければ false（読み込み失敗）", () => {
        expect(isImageReady(img(true, 0))).toBe(false);
    });
    it("ref が外れた（null）ときは false", () => {
        expect(isImageReady(null)).toBe(false);
    });
});
