import { describe, it, expect } from "vitest";
import {
    sanitizeStoryTexts, storyTextsCaption, clampStoryTextPos, newStoryText,
    DEFAULT_STORY_TEXT, FIRST_STORY_TEXT_POS,
    clampStoryTextSize, STORY_SIZE_MIN, STORY_SIZE_MAX, STORY_SIZE_DEFAULT,
    STORY_FONTS, STORY_COLORS, STORY_BGS,
    STORY_TEXT_MIN, STORY_TEXT_MAX, STORY_TEXTS_MAX, STORY_TEXT_LEN_MAX,
    clampStoryTextRotate, normalizeStoryRotate, STORY_ROTATE_DEFAULT,
    STORY_STAMPS, STORY_STAMP_KEYS, newStoryStamp, isStoryStamp,
    DEFAULT_STORY_STAMP_SIZE,
    isStoryVote, isStoryTextItem, newStoryVote,
    STORY_VOTE_DEFAULT, STORY_VOTE_QUESTION_MAX, STORY_VOTE_OPTION_MAX, DEFAULT_STORY_VOTE_SIZE,
    type StoryTextItem, type StoryVoteItem,
} from "../storyText";

/**
 * **文字だけを見る所の絞り込み。**
 *
 * `sanitizeStoryTexts` はスタンプも返すようになったので、`text` や `font` を
 * 読むテストはここを通す。**`as` で握らない**——スタンプが混ざっていたら
 * その場で落ちるようにして、「文字のつもりで書いた検査がスタンプを
 * 素通りする」を防ぐ。
 */
const asTexts = (out: unknown): StoryTextItem[] => {
    const list = out as Array<Record<string, unknown>> | undefined;
    if (!list) throw new Error("sanitizeStoryTexts が undefined を返した");
    for (const t of list) {
        if (t.kind === "stamp") throw new Error("文字のつもりの検査にスタンプが混ざっている");
    }
    return list as unknown as StoryTextItem[];
};

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
        expect(asTexts(out).map((t) => t.text)).toEqual(["いち", "に"]);
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
        expect(asTexts(out)[0].color).toBe(DEFAULT_STORY_TEXT.color);
        expect(asTexts(out)[0].font).toBe(DEFAULT_STORY_TEXT.font);
    });

    // **文言が空のものは落とす。** 置き場所だけの項目は画面に何も描けない
    it("文言が空のものは落とす", () => {
        expect(asTexts(sanitizeStoryTexts([{ ...ok, text: "   " }, ok])).map((t) => t.text)).toEqual(["朝の空"]);
        expect(sanitizeStoryTexts([{ ...ok, text: "" }])).toBeUndefined();
        expect(sanitizeStoryTexts([{ x: 0.5, y: 0.5 }])).toBeUndefined();
    });

    it("配列でなければ持たない", () => {
        for (const v of [undefined, null, "x", 3, {}, true]) {
            expect(sanitizeStoryTexts(v), `${JSON.stringify(v)} を通している`).toBeUndefined();
        }
    });

    it("要素が壊れていても落ちない（その要素だけ捨てる）", () => {
        expect(asTexts(sanitizeStoryTexts([null, "x", 3, [], ok])).map((t) => t.text)).toEqual(["朝の空"]);
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
        expect(asTexts(sanitizeStoryTexts([{ ...ok, text: long }]))[0].text).toHaveLength(STORY_TEXT_LEN_MAX);
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

/**
 * 傾き（`rotate`）。
 *
 * ここで固定したいのは3つ:
 *
 *  1. **「無い＝0度」** ——保存済みのストーリーは `rotate` を持たない
 *  2. **1周ぶんだけ持つ**（−180〜180）——何周も回しても数字が膨らまない
 *  3. **0 は書かない** ——傾けていない文字の保存内容が、この変更の前と
 *     1バイトも変わらないこと
 */
describe("文字の傾き", () => {
    it("既定は 0 度", () => {
        expect(STORY_ROTATE_DEFAULT).toBe(0);
    });

    // **保存済みのストーリーは `rotate` を持たない。** ここが 0 を返さないと、
    // 既存の投稿が読み込んだ瞬間に傾く
    it("無い・壊れている値は 0 として読む", () => {
        for (const v of [undefined, null, "12", NaN, Infinity, {}, []]) {
            expect(clampStoryTextRotate(v), `${String(v)} が 0 にならない`).toBe(0);
        }
    });

    // **1周ぶんだけ持つ。** 畳まないと、指で何周も回したときに 3600 のような
    // 値が入り、同じ見た目を違う数字で表すことになる
    it("−180〜180 に畳む", () => {
        expect(normalizeStoryRotate(0)).toBe(0);
        expect(normalizeStoryRotate(90)).toBe(90);
        expect(normalizeStoryRotate(180)).toBe(180);
        expect(normalizeStoryRotate(181)).toBe(-179);
        expect(normalizeStoryRotate(360)).toBe(0);
        expect(normalizeStoryRotate(450)).toBe(90);
        expect(normalizeStoryRotate(-90)).toBe(-90);
        // **負の値でも畳めること。** `%` は負の数で負を返すので、
        // 素朴に書くと −270 が −270 のまま残る
        expect(normalizeStoryRotate(-270)).toBe(90);
        expect(normalizeStoryRotate(-3600)).toBe(0);
    });

    it("1度に丸める（画面で見分けられない細かさを保存しない）", () => {
        expect(clampStoryTextRotate(12.4)).toBe(12);
        expect(clampStoryTextRotate(12.6)).toBe(13);
    });

    it("何周回しても、範囲の中に収まる", () => {
        for (const v of [1e6, -1e6, 359.7, -359.7, 720, 1080.4]) {
            const got = clampStoryTextRotate(v);
            expect(got, `${v} が範囲の外`).toBeGreaterThanOrEqual(-180);
            expect(got, `${v} が範囲の外`).toBeLessThanOrEqual(180);
        }
    });

    describe("保存の形", () => {
        const base = { text: "朝", x: 0.2, y: 0.8 };

        // **0 は書かない。** 書かなければ、傾けていない文字の保存内容は
        // この変更の前と1バイトも変わらない
        it("傾けていない文字に `rotate` を足さない", () => {
            const [got] = asTexts(sanitizeStoryTexts([base]));
            expect(got, "傾き 0 なのに rotate が書かれている").not.toHaveProperty("rotate");
            expect(Object.keys(got).sort()).toEqual(["bg", "color", "font", "size", "text", "x", "y"]);
        });

        it("傾けた文字は保存する", () => {
            const [got] = asTexts(sanitizeStoryTexts([{ ...base, rotate: 15 }]));
            expect(got.rotate).toBe(15);
        });

        it("壊れた傾きは 0 扱い＝書かない", () => {
            const [got] = asTexts(sanitizeStoryTexts([{ ...base, rotate: "ななめ" }]));
            expect(got).not.toHaveProperty("rotate");
        });

        it("範囲の外の傾きは畳んで保存する", () => {
            expect(sanitizeStoryTexts([{ ...base, rotate: 450 }])![0].rotate).toBe(90);
            // 畳んだ結果が 0 なら書かない（上の規則と食い違わない）
            expect(sanitizeStoryTexts([{ ...base, rotate: 720 }])![0]).not.toHaveProperty("rotate");
        });

        // **新しく足した文字も `rotate` を持たない。** 持たせると
        // 「新しい文字だけ 0 を持って、保存で消える」という説明の付かない差ができる
        it("新しく足した文字は `rotate` を持たない", () => {
            expect(newStoryText(0.5, 0.5)).not.toHaveProperty("rotate");
            expect(DEFAULT_STORY_TEXT).not.toHaveProperty("rotate");
        });
    });
});

/**
 * スタンプ（写真の上に置く絵柄）。
 *
 * **文字と同じ並びに持つ**（`texts`）。別の配列に分けると重なり順が
 * 決まらず、動かす・回す・大きさを変えるの仕組みも2組になる。
 *
 * ここで固定したいのは4つ:
 *
 *  1. **無い＝文字**（保存済みの要素は `kind` を持たない）
 *  2. **知らない絵柄は落とす**（既定に化けさせない——字体と違い、
 *     絵柄が変わると別の意味になる）
 *  3. **スタンプは `caption` に混ざらない**（題が絵文字だけの写真にしない）
 *  4. スタンプは字体・色・下地を**持たない**
 */
describe("スタンプ", () => {
    const stampIn = { kind: "stamp", stamp: "heart", x: 0.3, y: 0.4, size: 0.1 };

    it("一覧はどれも絵柄と名前を持つ", () => {
        expect(STORY_STAMP_KEYS.length, "スタンプが少なすぎる").toBeGreaterThanOrEqual(8);
        for (const [k, v] of Object.entries(STORY_STAMPS)) {
            expect(v.glyph, `${k} の絵柄が空`).toBeTruthy();
            expect(v.label, `${k} の名前が無い`).toBeTruthy();
        }
    });

    // **無い＝文字。** 保存済みの要素は `kind` を持たない
    it("`kind` を持たない要素は文字として読む", () => {
        const [got] = sanitizeStoryTexts([{ text: "朝", x: 0.5, y: 0.5 }])!;
        expect(isStoryStamp(got)).toBe(false);
        expect(got).not.toHaveProperty("kind");
    });

    it("スタンプはそのまま通る", () => {
        const [got] = sanitizeStoryTexts([stampIn])!;
        expect(isStoryStamp(got)).toBe(true);
        expect(got).toEqual({ kind: "stamp", stamp: "heart", x: 0.3, y: 0.4, size: 0.1 });
    });

    // **字体も色も下地も持たない**（絵柄に効かない項目を保存しない）
    it("スタンプに字体・色・下地を足さない", () => {
        const [got] = sanitizeStoryTexts([{ ...stampIn, font: "mincho", color: "sky", bg: "solid" }])!;
        expect(Object.keys(got).sort()).toEqual(["kind", "size", "stamp", "x", "y"]);
    });

    /**
     * **知らない絵柄は落とす（既定に化けさせない）。**
     *
     * 字体や色は「知らない鍵 → 既定」に落とすが、絵柄は違う——
     * ハートのつもりで置いたものが炎になったら**別の意味**になる。
     */
    it("知らない絵柄は落とす（既定の絵柄に化けさせない）", () => {
        expect(sanitizeStoryTexts([{ ...stampIn, stamp: "unicorn" }])).toBeUndefined();
        expect(sanitizeStoryTexts([{ ...stampIn, stamp: 3 }])).toBeUndefined();
        expect(sanitizeStoryTexts([{ kind: "stamp", x: 0.5, y: 0.5 }])).toBeUndefined();
        // 隣の正しい要素は残る（1つ壊れても丸ごと捨てない）
        const out = sanitizeStoryTexts([{ ...stampIn, stamp: "unicorn" }, stampIn])!;
        expect(out).toHaveLength(1);
    });

    it("スタンプも位置と大きさを挟む", () => {
        const [got] = sanitizeStoryTexts([{ ...stampIn, x: -5, y: 99, size: 99 }])!;
        expect(got).toMatchObject({ x: STORY_TEXT_MIN, y: STORY_TEXT_MAX, size: STORY_SIZE_MAX });
    });

    it("スタンプも傾けられる（0 なら書かない）", () => {
        expect(sanitizeStoryTexts([{ ...stampIn, rotate: 20 }])![0].rotate).toBe(20);
        expect(sanitizeStoryTexts([{ ...stampIn, rotate: 0 }])![0]).not.toHaveProperty("rotate");
    });

    // **文字とスタンプは1つの並び**＝重なり順を置き分けられる
    it("文字とスタンプを混ぜて、その並びのまま保つ", () => {
        const out = sanitizeStoryTexts([
            { text: "朝", x: 0.5, y: 0.5 },
            stampIn,
            { text: "空", x: 0.5, y: 0.6 },
        ])!;
        expect(out.map((t) => (isStoryStamp(t) ? `stamp:${t.stamp}` : isStoryTextItem(t) ? `text:${t.text}` : "vote")))
            .toEqual(["text:朝", "stamp:heart", "text:空"]);
    });

    // 上限は合わせて数える（多いほど読めなくなるのは絵柄も同じ）
    it("上限は文字とスタンプを合わせて数える", () => {
        const many = Array.from({ length: STORY_TEXTS_MAX + 4 }, (_, i) =>
            i % 2 ? stampIn : { text: `t${i}`, x: 0.5, y: 0.5 });
        expect(sanitizeStoryTexts(many)).toHaveLength(STORY_TEXTS_MAX);
    });

    /**
     * **`caption` に混ざらない。**
     *
     * `caption` は「残したときの題」と「検索に出る文章」になる
     * （`storyKeep.ts` の `sanitizeTitle`）。絵柄は文章ではないので、
     * 入れると**題が絵文字だけの写真**ができる。
     */
    it("スタンプは caption に入らない", () => {
        const texts = sanitizeStoryTexts([{ text: "朝の空", x: 0.5, y: 0.5 }, stampIn])!;
        expect(storyTextsCaption(texts)).toBe("朝の空");
    });

    it("スタンプだけなら caption は空（題の無い写真になる）", () => {
        expect(storyTextsCaption(sanitizeStoryTexts([stampIn])!)).toBe("");
    });

    describe("newStoryStamp", () => {
        it("既定の大きさで置く（文字より大きめ＝置いた直後に掴める）", () => {
            const s = newStoryStamp("star", 0.3, 0.4);
            expect(s).toEqual({ kind: "stamp", stamp: "star", x: 0.3, y: 0.4, size: DEFAULT_STORY_STAMP_SIZE });
            expect(DEFAULT_STORY_STAMP_SIZE).toBeGreaterThan(STORY_SIZE_DEFAULT);
        });

        it("位置は挟む", () => {
            expect(newStoryStamp("star", -1, 9)).toMatchObject({ x: STORY_TEXT_MIN, y: STORY_TEXT_MAX });
        });
    });
});

/**
 * 投票スタンプ（⑨-3）。
 *
 * ここで固定したいのは4つ:
 *
 *  1. **1投稿に1つだけ**（2つ目以降は落とす。票の行き先が決まらない）
 *  2. **欠けた投票は落とす**（既定で埋めない——サーバーが文言を作らない）
 *  3. **`caption` に混ざらない**（問いかけは題ではない）
 *  4. 問い・選択肢の長さを切る（写真の上のカードに収まる長さ）
 */
describe("投票スタンプ", () => {
    const voteIn = { kind: "vote", question: "この景色、好き？", options: ["はい", "いいえ"], x: 0.5, y: 0.6, size: 0.05 };

    it("そのまま通る", () => {
        const [got] = sanitizeStoryTexts([voteIn])!;
        expect(isStoryVote(got)).toBe(true);
        expect(got).toEqual({ kind: "vote", question: "この景色、好き？", options: ["はい", "いいえ"], x: 0.5, y: 0.6, size: 0.05 });
    });

    it("字体・色・下地を足さない", () => {
        const [got] = sanitizeStoryTexts([{ ...voteIn, font: "mincho", color: "sky", bg: "solid" }])!;
        expect(Object.keys(got).sort()).toEqual(["kind", "options", "question", "size", "x", "y"]);
    });

    // **1投稿に1つだけ。** 票はストーリー単位で数えるので、2つ置けると
    // 票の行き先が決まらない。**後ろの文字は残る**（投票だけを落とす）
    it("2つ目以降の投票は落とし、後ろの文字は残す", () => {
        const out = sanitizeStoryTexts([
            voteIn,
            { ...voteIn, question: "2つ目" },
            { text: "朝", x: 0.5, y: 0.5 },
        ])!;
        expect(out.filter(isStoryVote)).toHaveLength(1);
        expect((out[0] as { question: string }).question).toBe("この景色、好き？");
        expect(out.filter(isStoryTextItem).map((t) => t.text)).toEqual(["朝"]);
    });

    // **既定で埋めない。** 空の問いをサーバーが「この景色、好き？」に
    // 化けさせると、投稿者が書いていない文言が出る
    it("問いか選択肢が欠けた投票は落とす（既定で埋めない）", () => {
        expect(sanitizeStoryTexts([{ ...voteIn, question: "  " }])).toBeUndefined();
        expect(sanitizeStoryTexts([{ ...voteIn, options: ["はい"] }])).toBeUndefined();
        expect(sanitizeStoryTexts([{ ...voteIn, options: ["はい", ""] }])).toBeUndefined();
        expect(sanitizeStoryTexts([{ ...voteIn, options: "はい,いいえ" }])).toBeUndefined();
        expect(sanitizeStoryTexts([{ kind: "vote", x: 0.5, y: 0.5 }])).toBeUndefined();
    });

    it("問いと選択肢の長さを切る", () => {
        const [got] = sanitizeStoryTexts([{
            ...voteIn,
            question: "あ".repeat(STORY_VOTE_QUESTION_MAX + 10),
            options: ["い".repeat(STORY_VOTE_OPTION_MAX + 5), "う"],
        }])! as StoryVoteItem[];
        expect(got.question).toHaveLength(STORY_VOTE_QUESTION_MAX);
        expect(got.options[0]).toHaveLength(STORY_VOTE_OPTION_MAX);
        expect(got.options[1]).toBe("う");
    });

    it("投票も位置・大きさ・傾きは同じ規則", () => {
        const [got] = sanitizeStoryTexts([{ ...voteIn, x: -5, y: 99, size: 99, rotate: 15 }])!;
        expect(got).toMatchObject({ x: STORY_TEXT_MIN, y: STORY_TEXT_MAX, size: STORY_SIZE_MAX, rotate: 15 });
    });

    /**
     * **`caption` に混ざらない。** 「この景色、好き？」は題ではなく
     * 問いかけで、残したときに写真の題になると嘘になる。
     */
    it("投票は caption に入らない", () => {
        const texts = sanitizeStoryTexts([{ text: "朝の空", x: 0.5, y: 0.5 }, voteIn])!;
        expect(storyTextsCaption(texts)).toBe("朝の空");
        expect(storyTextsCaption(sanitizeStoryTexts([voteIn])!)).toBe("");
    });

    // `isStoryTextItem` は **無い＝文字**（`kind` を持たない要素）
    it("`isStoryTextItem` は kind の無い要素を文字と見る", () => {
        const [t] = sanitizeStoryTexts([{ text: "朝", x: 0.5, y: 0.5 }])!;
        expect(isStoryTextItem(t)).toBe(true);
        expect(isStoryTextItem(sanitizeStoryTexts([voteIn])![0])).toBe(false);
    });

    describe("newStoryVote", () => {
        it("問いは台帳の文言、2択は判断の既定", () => {
            const v = newStoryVote(0.3, 0.4);
            expect(v).toEqual({
                kind: "vote", question: "この景色、好き？", options: ["はい", "いいえ"],
                x: 0.3, y: 0.4, size: DEFAULT_STORY_VOTE_SIZE,
            });
            expect(v.question).toBe(STORY_VOTE_DEFAULT.question);
        });

        // 既定は自分自身の検証を通ること（通らなければ「置いたのに保存で消える」）
        it("既定の投票は sanitize を通る", () => {
            expect(sanitizeStoryTexts([newStoryVote(0.5, 0.5)])).toHaveLength(1);
        });

        // 選択肢の配列を共有しない（1つ直すと既定まで変わる）
        it("既定の配列を共有しない", () => {
            const v = newStoryVote(0.5, 0.5);
            v.options[0] = "変えた";
            expect(STORY_VOTE_DEFAULT.options[0]).toBe("はい");
        });
    });
});
