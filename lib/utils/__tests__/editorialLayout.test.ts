import { describe, it, expect } from "vitest";
import { editorialRows, shortPlace } from "../editorialLayout";

/** 段の形だけを文字にする（hero=H、pair=P） */
const shape = (n: number) => editorialRows(Array.from({ length: n }, (_, i) => i))
    .map((r) => (r.kind === "hero" ? `H${r.item}` : `P${r.items[0]}${r.items[1]}`)).join(" ");

describe("editorialRows（iOS の EditorialLayout と同じ）", () => {
    it("大きく1枚 → 2枚 → 2枚 を繰り返す", () => {
        expect(shape(10)).toBe("H0 P12 P34 H5 P67 P89");
    });

    it("2枚の段に相方がいなければ、その1枚で横いっぱいにする", () => {
        expect(shape(2)).toBe("H0 H1");
        expect(shape(4)).toBe("H0 P12 H3");
    });

    it("空なら段も無い", () => {
        expect(editorialRows([])).toEqual([]);
    });

    it("写真を落とさず、順番も変えない", () => {
        const items = Array.from({ length: 23 }, (_, i) => i);
        const flat = editorialRows(items).flatMap((r) => (r.kind === "hero" ? [r.item] : r.items));
        expect(flat).toEqual(items);
    });
});

describe("shortPlace（iOS の HomeTileText.place と同じ）", () => {
    it.each([
        ["パリ, フランス", "パリ"],
        ["京都、日本", "京都"],
        ["東京，日本", "東京"],
        ["  山中湖  ", "山中湖"],
        ["", ""],
        [undefined, ""],
    ])("%s → %s", (input, out) => {
        expect(shortPlace(input as string | undefined)).toBe(out);
    });
});
