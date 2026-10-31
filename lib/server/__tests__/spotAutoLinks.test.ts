import { describe, it, expect, beforeEach } from "vitest";
import type { Photo } from "../../data/photos";
import PROD48 from "../../utils/__tests__/spotAutoLink.prod48.json";
import { autoLinksFor, autoSpotIdForPhoto, resetSpotAutoLinkCache } from "../spotAutoLinks";

/**
 * 静的な生成で使う口（journey.photo-ios#425）。
 * 表は読み込みごとに1回だけ作り、中身が前の読み込みと同じなら前の表を返す（頁ごとに作り直さない）。
 * 写真の詳細の自動の結びは、表と同じく公開の写真だけ。
 */
const photos = () => (PROD48 as Photo[]).map((p) => ({ ...p }));
const FOX = "ec059fb7-7727-516a-bfb6-fd64835d89ad";

beforeEach(() => resetSpotAutoLinkCache());

describe("autoLinksFor", () => {
    it("同じ中身の読み込みなら、前の表をそのまま返す（作り直さない）", () => {
        const first = autoLinksFor(photos());
        expect(Object.keys(first)).toHaveLength(16);
        expect(autoLinksFor(photos())).toBe(first);
    });

    it("中身が変われば作り直す（本人が外した・非公開にした）", () => {
        const first = autoLinksFor(photos());
        const off = photos().map((p) => (p.id === FOX ? { ...p, spotAuto: "off" as const } : p));
        const second = autoLinksFor(off);
        expect(second).not.toBe(first);
        expect(second[FOX]).toBeUndefined();
        const hidden = photos().map((p) => (p.id === FOX ? { ...p, published: false } : p));
        expect(autoLinksFor(hidden)[FOX]).toBeUndefined();
    });
});

describe("autoSpotIdForPhoto", () => {
    it("非公開の写真は結ばない（表と同じ守り）", () => {
        const fox = photos().find((p) => p.id === FOX)!;
        expect(autoSpotIdForPhoto(fox)).toMatch(/^sp_/);
        expect(autoSpotIdForPhoto({ ...fox, published: false })).toBeNull();
    });
});
