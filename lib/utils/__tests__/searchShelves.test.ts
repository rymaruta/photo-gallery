import { describe, it, expect } from "vitest";
import type { Photo } from "@/lib/data/photos";
import { focalMillimeters, gearGroupOf, gearShelves, colorFamilyOf, colorAllows, colorShelves } from "../searchShelves";

const P = (id: string, extra: Partial<Photo>) => ({ id, src: `${id}.jpg`, ...extra } as Photo);

/** 2026-10-31 束 1 S7・S8: iOS の `GearGroups`・`ColorFamilies` と同じ分け方 */
describe("機材の棚（広角・標準・望遠）", () => {
    it("焦点距離の数を読む（「f=35 mm」「24mm」）・読めなければ null", () => {
        expect(focalMillimeters("24mm")).toBe(24);
        expect(focalMillimeters("f=35 mm")).toBe(35);
        expect(focalMillimeters("")).toBeNull();
        expect(focalMillimeters(undefined)).toBeNull();
    });
    it("〜35 広角・36〜70 標準・71〜 望遠（iOS の境目と同じ）", () => {
        expect(gearGroupOf({ exif: { focalLength: "35mm" } } as Photo)).toBe("wide");
        expect(gearGroupOf({ exif: { focalLength: "36mm" } } as Photo)).toBe("standard");
        expect(gearGroupOf({ exif: { focalLength: "70mm" } } as Photo)).toBe("standard");
        expect(gearGroupOf({ exif: { focalLength: "71mm" } } as Photo)).toBe("telephoto");
        expect(gearGroupOf({} as Photo)).toBeNull();
    });
    it("写真の無い群は出さない・いいねの多い順", () => {
        const shelves = gearShelves([
            P("a", { exif: { focalLength: "24mm" }, likes: 1 }),
            P("b", { exif: { focalLength: "16mm" }, likes: 5 }),
            P("c", { exif: { focalLength: "200mm" } }),
        ]);
        expect(shelves.map((s) => s.group)).toEqual(["wide", "telephoto"]);
        expect(shelves[0].photos.map((p) => p.id)).toEqual(["b", "a"]);
    });
});

describe("色の棚", () => {
    it("色味（iOS と同じ境目）。暗すぎる・彩度の低い暗い色は振らない", () => {
        expect(colorFamilyOf("#3a7bd5")).toBe("blue");
        expect(colorFamilyOf("#2e8b57")).toBe("green");
        expect(colorFamilyOf("#ff8c00")).toBe("orange");
        expect(colorFamilyOf("#ff69b4")).toBe("pink");
        expect(colorFamilyOf("#f0f0f0")).toBe("white");
        expect(colorFamilyOf("#101010")).toBeNull();
        expect(colorFamilyOf("#555555")).toBeNull();
        expect(colorFamilyOf("zzz")).toBeNull();
    });
    it("外の景色の分類だけ（料理は入れない）・白は風景と自然だけ", () => {
        expect(colorAllows({ category: "food" } as Photo, "orange")).toBe(false);
        expect(colorAllows({ category: "建築" } as Photo, "orange")).toBe(true);
        expect(colorAllows({ category: "architecture" } as Photo, "white")).toBe(false);
        expect(colorAllows({ category: "landscape" } as Photo, "white")).toBe(true);
    });
    it("1枚も無い色味は出さず、数は棚の全部", () => {
        const shelves = colorShelves([
            P("a", { dominantColor: "#3a7bd5", category: "landscape" }),
            P("b", { dominantColor: "#3a7bd5", category: "food" }),
            P("c", { dominantColor: "#f0f0f0", category: "nature" }),
        ]);
        expect(shelves.map((s) => [s.family, s.count])).toEqual([["blue", 1], ["white", 1]]);
    });
});
