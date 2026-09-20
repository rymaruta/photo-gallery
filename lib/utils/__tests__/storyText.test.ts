import { describe, it, expect } from "vitest";
import {
    sanitizeStoryTextStyle, clampStoryTextPos, DEFAULT_STORY_TEXT_STYLE,
    STORY_FONTS, STORY_COLORS, STORY_SIZES, STORY_BGS,
    STORY_TEXT_MIN, STORY_TEXT_MAX,
} from "../storyText";

/**
 * ストーリーの文字の見せ方。
 *
 * owner:「インスタみたいにストーリーで好きな場所で文字打てるようにしたい。
 * フォントの種類や色も豊富にしたい」
 *
 * **受けるのは一覧に在る鍵だけ。** 任意の CSS を通さないので、他人の画面で
 * 動く値も、読めない組み合わせも作れない。
 */
describe("sanitizeStoryTextStyle", () => {
    it("そのまま通る値", () => {
        expect(sanitizeStoryTextStyle({ x: 0.2, y: 0.8, size: "s", font: "mincho", color: "sky", bg: "soft" }))
            .toEqual({ x: 0.2, y: 0.8, size: "s", font: "mincho", color: "sky", bg: "soft" });
    });

    // **知らない鍵は既定へ落とす（丸ごと捨てない）。** 捨てると、字体を1つ
    // 増やした日に古いクライアントの投稿から文字の位置まで消える
    it("知らない鍵は既定へ落とす（位置は残す）", () => {
        expect(sanitizeStoryTextStyle({ x: 0.2, y: 0.8, size: "huge", font: "comic", color: "rebeccapurple", bg: "glow" }))
            .toEqual({
                x: 0.2, y: 0.8,
                size: DEFAULT_STORY_TEXT_STYLE.size,
                font: DEFAULT_STORY_TEXT_STYLE.font,
                color: DEFAULT_STORY_TEXT_STYLE.color,
                bg: DEFAULT_STORY_TEXT_STYLE.bg,
            });
    });

    // **任意の CSS を通さない。** 鍵で持つ理由そのもの
    it("色や字体に生の CSS を入れても通らない", () => {
        const out = sanitizeStoryTextStyle({ x: 0.5, y: 0.5, color: "red; background:url(javascript:1)", font: '"; content:"' });
        expect(out?.color).toBe(DEFAULT_STORY_TEXT_STYLE.color);
        expect(out?.font).toBe(DEFAULT_STORY_TEXT_STYLE.font);
    });

    it("オブジェクトでなければ持たない", () => {
        for (const v of [undefined, null, "x", 3, [], true]) {
            expect(sanitizeStoryTextStyle(v), `${JSON.stringify(v)} を通している`).toBeUndefined();
        }
    });

    it("位置は必ず挟む（半分が画面の外へ出ない）", () => {
        expect(sanitizeStoryTextStyle({})?.x).toBe(0.5);
        expect(sanitizeStoryTextStyle({ x: -5, y: 99 })).toMatchObject({ x: STORY_TEXT_MIN, y: STORY_TEXT_MAX });
        expect(sanitizeStoryTextStyle({ x: "0.3", y: NaN })).toMatchObject({ x: 0.5, y: 0.5 });
    });
});

describe("clampStoryTextPos", () => {
    it("挟む", () => {
        expect(clampStoryTextPos(0)).toBe(STORY_TEXT_MIN);
        expect(clampStoryTextPos(1)).toBe(STORY_TEXT_MAX);
        expect(clampStoryTextPos(0.5)).toBe(0.5);
    });

    // **細かすぎる値を持たない**（同じ場所を指す長い小数で項目を太らせない）
    it("小数は3桁に丸める", () => {
        expect(clampStoryTextPos(0.123456)).toBe(0.123);
    });

    it("数でなければ真ん中", () => {
        for (const v of [undefined, null, "0.3", NaN, Infinity, {}]) {
            expect(clampStoryTextPos(v), `${JSON.stringify(v)}`).toBe(0.5);
        }
    });
});

/**
 * 一覧そのものの約束。**増やすのは自由だが、壊れた値は置かない**
 * ——画面はここを直に読んで CSS にするので、空や未定義が混ざると
 * 文字が消える／既定のままになる。
 */
describe("選べるものの一覧", () => {
    it("字体はどれも CSS と太さを持つ", () => {
        const keys = Object.keys(STORY_FONTS);
        expect(keys.length, "字体が少なすぎる").toBeGreaterThanOrEqual(4);
        for (const [k, v] of Object.entries(STORY_FONTS)) {
            expect(v.css, `${k} の css が空`).toBeTruthy();
            // **総称ファミリで終わる。** 端末に無いときに何も指定が残らないと、
            // 選んだ字体が「既定のまま」になって選べていないのと同じになる
            expect(v.css, `${k} が総称ファミリで終わっていない`).toMatch(/(sans-serif|serif|monospace)$/);
            expect(v.weight, `${k} の太さが無い`).toBeGreaterThan(0);
            expect(v.label, `${k} のラベルが無い`).toBeTruthy();
        }
    });

    it("色はどれも 16進の色と、下地にしたときの文字色を持つ", () => {
        expect(Object.keys(STORY_COLORS).length, "色が少なすぎる").toBeGreaterThanOrEqual(8);
        for (const [k, v] of Object.entries(STORY_COLORS)) {
            expect(v.hex, `${k} の色が 16進でない`).toMatch(/^#[0-9a-f]{6}$/);
            expect(v.on, `${k} の反転色が 16進でない`).toMatch(/^#[0-9a-f]{6}$/);
            expect(v.label, `${k} のラベルが無い`).toBeTruthy();
        }
    });

    // **絵の幅に対する割合。** px で持つと、撮った端末と見る端末で別の大きさになる
    it("大きさは幅に対する割合（0〜1）で、小さい順", () => {
        const vals = Object.values(STORY_SIZES);
        expect(vals.every((v) => v > 0 && v < 0.5), "割合として妥当でない").toBe(true);
        expect([...vals].sort((a, b) => a - b), "小さい順に並んでいない").toEqual(vals);
    });

    it("下地は3種（無し・うす・塗り）", () => {
        expect([...STORY_BGS]).toEqual(["none", "soft", "solid"]);
    });

    it("既定は一覧の中の鍵", () => {
        expect(Object.keys(STORY_FONTS)).toContain(DEFAULT_STORY_TEXT_STYLE.font);
        expect(Object.keys(STORY_COLORS)).toContain(DEFAULT_STORY_TEXT_STYLE.color);
        expect(Object.keys(STORY_SIZES)).toContain(DEFAULT_STORY_TEXT_STYLE.size);
        expect([...STORY_BGS]).toContain(DEFAULT_STORY_TEXT_STYLE.bg);
    });

    // **真ん中に置かない。** 下書きの画面は下半分が操作の欄で、
    // 中央に出すと打った文字が自分で見えない（実測）
    it("既定の位置は、下書きの操作欄に隠れない高さ", () => {
        expect(DEFAULT_STORY_TEXT_STYLE.y, "既定が画面の下半分にある").toBeLessThan(0.45);
    });
});
