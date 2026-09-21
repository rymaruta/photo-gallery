import { describe, it, expect } from "vitest";
import {
    sanitizeStoryTexts, storyTextsCaption, clampStoryTextPos, newStoryText,
    DEFAULT_STORY_TEXT, FIRST_STORY_TEXT_POS,
    clampStoryTextSize, STORY_SIZE_MIN, STORY_SIZE_MAX, STORY_SIZE_DEFAULT,
    STORY_FONTS, STORY_COLORS, STORY_BGS,
    STORY_TEXT_MIN, STORY_TEXT_MAX, STORY_TEXTS_MAX, STORY_TEXT_LEN_MAX,
} from "../storyText";

/**
 * ストーリーの文字の見せ方。
 *
 * owner:「インスタみたいにストーリーで好きな場所で文字打てるようにしたい。
 * フォントの種類や色も豊富にしたい」
 *
 * owner:「複数のテキストを別々に置くのもやりたい」
 *
 * **受けるのは一覧に在る鍵だけ。** 任意の CSS を通さないので、他人の画面で
 * 動く値も、読めない組み合わせも作れない。
 */
describe("sanitizeStoryTexts", () => {
    const ok = { text: "朝の空", x: 0.2, y: 0.8, size: 0.05, font: "mincho", color: "sky", bg: "soft" };

    it("そのまま通る値", () => {
        expect(sanitizeStoryTexts([ok])).toEqual([ok]);
    });

    it("複数をその並びで保つ（並びが重なり順）", () => {
        const out = sanitizeStoryTexts([{ ...ok, text: "いち" }, { ...ok, text: "に" }]);
        expect(out?.map((t) => t.text)).toEqual(["いち", "に"]);
    });

    // **知らない鍵は既定へ落とす（丸ごと捨てない）。** 捨てると、字体を1つ
    // 増やした日に古いクライアントの投稿から文字の位置まで消える
    it("知らない鍵は既定へ落とす（文言と位置は残す）", () => {
        const out = sanitizeStoryTexts([{ text: "朝", x: 0.2, y: 0.8, size: "huge", font: "comic", color: "rebecca", bg: "glow" }]);
        expect(out).toEqual([{
            text: "朝", x: 0.2, y: 0.8,
            size: DEFAULT_STORY_TEXT.size, font: DEFAULT_STORY_TEXT.font,
            color: DEFAULT_STORY_TEXT.color, bg: DEFAULT_STORY_TEXT.bg,
        }]);
    });

    // **任意の CSS を通さない。** 鍵で持つ理由そのもの
    it("色や字体に生の CSS を入れても通らない", () => {
        const out = sanitizeStoryTexts([{ text: "朝", color: "red; background:url(javascript:1)", font: '"; content:"' }]);
        expect(out?.[0].color).toBe(DEFAULT_STORY_TEXT.color);
        expect(out?.[0].font).toBe(DEFAULT_STORY_TEXT.font);
    });

    // **文言が空のものは落とす。** 置き場所だけの項目は画面に何も描けない
    it("文言が空のものは落とす", () => {
        expect(sanitizeStoryTexts([{ ...ok, text: "   " }, ok])?.map((t) => t.text)).toEqual(["朝の空"]);
        expect(sanitizeStoryTexts([{ ...ok, text: "" }])).toBeUndefined();
        expect(sanitizeStoryTexts([{ x: 0.5, y: 0.5 }])).toBeUndefined();
    });

    it("配列でなければ持たない", () => {
        for (const v of [undefined, null, "x", 3, {}, true]) {
            expect(sanitizeStoryTexts(v), `${JSON.stringify(v)} を通している`).toBeUndefined();
        }
    });

    it("要素が壊れていても落ちない（その要素だけ捨てる）", () => {
        expect(sanitizeStoryTexts([null, "x", 3, [], ok])?.map((t) => t.text)).toEqual(["朝の空"]);
    });

    it("位置は必ず挟む（半分が画面の外へ出ない）", () => {
        expect(sanitizeStoryTexts([{ text: "朝" }])?.[0]).toMatchObject({ x: 0.5, y: 0.5 });
        expect(sanitizeStoryTexts([{ text: "朝", x: -5, y: 99 }])?.[0]).toMatchObject({ x: STORY_TEXT_MIN, y: STORY_TEXT_MAX });
        expect(sanitizeStoryTexts([{ text: "朝", x: "0.3", y: NaN }])?.[0]).toMatchObject({ x: 0.5, y: 0.5 });
    });

    // **多いほど読めなくなる**ので、画面が破綻しない範囲で切る
    it("上限を超えたぶんは落とす", () => {
        const many = Array.from({ length: STORY_TEXTS_MAX + 4 }, (_, i) => ({ ...ok, text: `t${i}` }));
        expect(sanitizeStoryTexts(many)).toHaveLength(STORY_TEXTS_MAX);
    });

    it("大きさは数として挟む（知らない値は既定）", () => {
        expect(sanitizeStoryTexts([{ text: "朝", size: "huge" }])?.[0].size).toBe(STORY_SIZE_DEFAULT);
        expect(sanitizeStoryTexts([{ text: "朝", size: 99 }])?.[0].size).toBe(STORY_SIZE_MAX);
        expect(sanitizeStoryTexts([{ text: "朝", size: 0.05 }])?.[0].size).toBe(0.05);
    });

    it("1つあたりの長さも切る", () => {
        const long = "あ".repeat(STORY_TEXT_LEN_MAX + 50);
        expect(sanitizeStoryTexts([{ ...ok, text: long }])?.[0].text).toHaveLength(STORY_TEXT_LEN_MAX);
    });
});

/**
 * **`caption` は文字たちから作る。** 文言を2か所で持つと静かにずれる
 * ——残したときの題（`storyKeep.ts`）も、検索に出る文章も、この1本を読む。
 */
describe("storyTextsCaption", () => {
    const t = (text: string) => ({ text, x: 0.5, y: 0.5, ...DEFAULT_STORY_TEXT });

    it("置いた順に改行で繋ぐ", () => {
        expect(storyTextsCaption([t("いち"), t("に")])).toBe("いち\nに");
    });

    it("1つならそのまま", () => {
        expect(storyTextsCaption([t("朝の空")])).toBe("朝の空");
    });

    it("空なら空", () => {
        expect(storyTextsCaption([])).toBe("");
    });
});

describe("newStoryText", () => {
    it("既定の見せ方で、文言は空", () => {
        expect(newStoryText(0.3, 0.4)).toEqual({ text: "", x: 0.3, y: 0.4, ...DEFAULT_STORY_TEXT });
    });

    it("位置は挟む", () => {
        expect(newStoryText(-1, 9)).toMatchObject({ x: STORY_TEXT_MIN, y: STORY_TEXT_MAX });
    });
});

/**
 * 大きさは**段階ではなく無段階**。4段階のチップは並べても違いが見分けられず
 * 気づかれなかった（owner:「文字の大きさも変えたいよね」）。
 */
describe("clampStoryTextSize", () => {
    it("挟む", () => {
        expect(clampStoryTextSize(0)).toBe(STORY_SIZE_MIN);
        expect(clampStoryTextSize(9)).toBe(STORY_SIZE_MAX);
        expect(clampStoryTextSize(0.06)).toBe(0.06);
    });

    it("数でなければ既定", () => {
        for (const v of [undefined, null, "0.06", NaN, Infinity, {}]) {
            expect(clampStoryTextSize(v), `${JSON.stringify(v)}`).toBe(STORY_SIZE_DEFAULT);
        }
    });

    it("小数は3桁に丸める（同じ大きさを指す長い小数で太らせない）", () => {
        expect(clampStoryTextSize(0.0781234)).toBe(0.078);
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
    it("大きさの範囲は割合として妥当", () => {
        expect(STORY_SIZE_MIN).toBeGreaterThan(0);
        expect(STORY_SIZE_MAX).toBeLessThan(0.5);
        expect(STORY_SIZE_MIN).toBeLessThan(STORY_SIZE_MAX);
        expect(STORY_SIZE_DEFAULT).toBeGreaterThanOrEqual(STORY_SIZE_MIN);
        expect(STORY_SIZE_DEFAULT).toBeLessThanOrEqual(STORY_SIZE_MAX);
    });

    it("下地は3種（無し・うす・塗り）", () => {
        expect([...STORY_BGS]).toEqual(["none", "soft", "solid"]);
    });

    it("既定は一覧の中の鍵", () => {
        expect(Object.keys(STORY_FONTS)).toContain(DEFAULT_STORY_TEXT.font);
        expect(Object.keys(STORY_COLORS)).toContain(DEFAULT_STORY_TEXT.color);
        expect([...STORY_BGS]).toContain(DEFAULT_STORY_TEXT.bg);
    });

    // **真ん中に置かない。** 下書きの画面は下半分が操作の欄で、
    // 中央に出すと打った文字が自分で見えない（実測）
    it("1枚目の既定の位置は、下書きの操作欄に隠れない高さ", () => {
        expect(FIRST_STORY_TEXT_POS.y, "既定が画面の下半分にある").toBeLessThan(0.45);
    });
});
