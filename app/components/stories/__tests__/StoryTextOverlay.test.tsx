import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import StoryTextOverlay from "../StoryTextOverlay";
import {
    STORY_FONTS, STORY_SIZE_DEFAULT, STORY_STAMPS,
    type StoryText, type StoryTextItem, type StoryStampItem, type StoryVoteItem,
} from "@/lib/utils/storyText";

/**
 * 置いた文字の描き方。
 *
 * **見る側（`StoryViewer`）と下書き（`StoriesBar`）が同じ部品を使う。**
 * 別々に描くと「置いた場所と出る場所が違う」になり、置き直しても直らない。
 *
 * **並びが重なり順**——後ろほど手前。
 */
const t = (over: Partial<StoryTextItem> = {}): StoryTextItem =>
    ({ text: "こんにちは", x: 0.5, y: 0.5, size: STORY_SIZE_DEFAULT, font: "bold", color: "white", bg: "none", ...over });

const box = { left: 30, top: 60, width: 300, height: 500 };
const para = (text = "こんにちは") => screen.getByText(text);

describe("StoryTextOverlay", () => {
    it("絵の矩形に重ねる（囲みではなく）", () => {
        const { container } = render(<StoryTextOverlay texts={[t()]} box={box} />);
        const area = container.firstElementChild as HTMLElement;
        expect(area.style.left).toBe("30px");
        expect(area.style.top).toBe("60px");
        expect(area.style.width).toBe("300px");
        expect(area.style.height).toBe("500px");
    });

    // **測れていないときは消さない。** jsdom にはレイアウトが無いので、
    // 「幅0」と「測れていない」を分けないとテストでも本番でも文字が消える
    it("矩形が測れていなければ囲み全体に載せる（文字を消さない）", () => {
        const { container } = render(<StoryTextOverlay texts={[t()]} box={null} />);
        expect((container.firstElementChild as HTMLElement).style.inset).toBe("0px");
        expect(para()).toBeInTheDocument();
        expect(para().style.fontSize, "幅が無いのに px で決めている").toContain("vw");
    });

    // **絵の幅に対する割合。** px で持つと、撮った端末と見る端末で別の大きさになる
    it("大きさは絵の幅から決める", () => {
        render(<StoryTextOverlay texts={[t({ size: 0.06 })]} box={box} />);
        expect(para().style.fontSize).toBe(`${Math.round(box.width * 0.06)}px`);
    });

    it("字体と色を当てる", () => {
        render(<StoryTextOverlay texts={[t({ font: "mincho", color: "sky" })]} box={box} />);
        expect(para().style.fontFamily).toContain("Hiragino Mincho ProN");
        expect(para().style.fontWeight).toBe(String(STORY_FONTS.mincho.weight));
        expect(para().style.color).toBe("rgb(100, 210, 255)");
    });

    it("塗りの下地では、色が下地になり文字が反転する", () => {
        render(<StoryTextOverlay texts={[t({ color: "blue", bg: "solid" })]} box={box} />);
        const s = para().style;
        expect(s.background, "選んだ色が下地になっていない").toBe("rgb(10, 132, 255)");
        expect(s.color).toBe("rgb(255, 255, 255)");
        expect(s.textShadow, "下地があるのに影も付けている").toBe("none");
    });

    // **下地が無いときは影で浮かせる。** 白い空に白い文字を置くと消える
    it("下地なしでは影を付ける", () => {
        render(<StoryTextOverlay texts={[t({ bg: "none" })]} box={box} />);
        expect(para().style.textShadow, "影が無いと明るい写真の上で消える").toBeTruthy();
        expect(para().style.textShadow).not.toBe("none");
    });

    it("うす下地は黒の半透明（選んだ色は文字のまま）", () => {
        render(<StoryTextOverlay texts={[t({ color: "yellow", bg: "soft" })]} box={box} />);
        expect(para().style.background).toContain("rgba(0, 0, 0, 0.45)");
        expect(para().style.color).toBe("rgb(255, 214, 10)");
    });

    /**
     * 🔴 **端では中央合わせをやめて縁に寄せる。**
     * いつも `translate(-50%,-50%)` だと、箱が広いとき端の文字が
     * 画面の外へ切れる（実測で左が 5px 欠けた）。
     */
    it("端では縁に寄せる（切れない）", () => {
        const { rerender } = render(<StoryTextOverlay texts={[t({ x: 0, y: 0 })]} box={box} />);
        expect(para().style.transform, "左上で中央合わせのまま").toBe("translate(0%, 0%)");
        rerender(<StoryTextOverlay texts={[t({ x: 1, y: 1 })]} box={box} />);
        expect(para().style.transform, "右下で中央合わせのまま").toBe("translate(-100%, -100%)");
        rerender(<StoryTextOverlay texts={[t({ x: 0.5, y: 0.5 })]} box={box} />);
        expect(para().style.transform, "真ん中では中央合わせ").toBe("translate(-50%, -50%)");
    });

    it("置いた割合をそのまま left/top にする", () => {
        render(<StoryTextOverlay texts={[t({ x: 0.25, y: 0.75 })]} box={box} />);
        expect(para().style.left).toBe("25%");
        expect(para().style.top).toBe("75%");
    });

    // **スクリム（上下の黒いグラデーション）より上。** 下だと白い文字が灰色に沈む
    it("スクリムより上に出す", () => {
        const { container } = render(<StoryTextOverlay texts={[t()]} box={box} />);
        const area = container.firstElementChild as HTMLElement;
        expect(Number(area.style.zIndex), "スクリム（z-20）より下にある").toBeGreaterThan(20);
        expect(area.className).toContain("pointer-events-none");
    });

    it("改行と長い文は折り返す（はみ出させない）", () => {
        render(<StoryTextOverlay texts={[t()]} box={box} />);
        expect(para().className).toContain("whitespace-pre-wrap");
        expect(para().className).toContain("break-words");
        expect(para().style.maxWidth).toBeTruthy();
    });
});

describe("StoryTextOverlay: 複数置いたとき", () => {
    const three = [t({ text: "いち" }), t({ text: "に" }), t({ text: "さん" })];

    it("全部出す。**並びが重なり順**（後ろほど手前）", () => {
        const { container } = render(<StoryTextOverlay texts={three} box={box} />);
        const ps = [...container.querySelectorAll("p")].map((e) => e.textContent);
        expect(ps, "並び順どおりに描いていない").toEqual(["いち", "に", "さん"]);
    });

    // 見る側では掴めない（押せるものを増やさない）
    it("見る側では掴めない", () => {
        const { container } = render(<StoryTextOverlay texts={three} box={box} />);
        for (const p of container.querySelectorAll("p")) {
            expect(p.className, "見る側で掴める形になっている").not.toContain("pointer-events-auto");
        }
        expect(container.querySelector("[data-story-text-index]")).toBeTruthy();
    });

    it("下書きでは触れる。触ったものの番号を返す", () => {
        const onPick = vi.fn();
        render(<StoryTextOverlay texts={three} box={box} onPickIndex={onPick} selectedIndex={1} />);
        expect(para("に").className).toContain("pointer-events-auto");
        fireEvent.pointerDown(para("さん"));
        expect(onPick.mock.calls[0][0], "触った文字の番号が違う").toBe(2);
    });

    // **どれを直しているのかが見えないと、操作の欄が誰に効くか分からない**
    it("選んでいるものに印を付ける（1つだけ）", () => {
        const { container } = render(
            <StoryTextOverlay texts={three} box={box} onPickIndex={vi.fn()} selectedIndex={1} />,
        );
        const outlined = [...container.querySelectorAll("p")].filter((e) => (e as HTMLElement).style.outline);
        expect(outlined).toHaveLength(1);
        expect(outlined[0].textContent).toBe("に");
    });

    it("何も選んでいなければ印は出ない", () => {
        const { container } = render(
            <StoryTextOverlay texts={three} box={box} onPickIndex={vi.fn()} selectedIndex={null} />,
        );
        expect([...container.querySelectorAll("p")].filter((e) => (e as HTMLElement).style.outline)).toHaveLength(0);
    });
});

/**
 * 傾き（`rotate`）と、角のハンドル。
 *
 * ここで固定したいのは4つ:
 *
 *  1. **「無い＝0度」** ——保存済みのストーリーは `rotate` を持たない
 *  2. **傾き 0 なら `rotate()` を書かない** ——傾けていない文字は
 *     データも DOM も、この変更の前と同じ
 *  3. **運ぶ → 回す の順** ——逆だと運ぶ量そのものが回り、傾けた瞬間に飛ぶ
 *  4. **ハンドルは選んでいる1つだけ**・**親へ伝えない**
 */
describe("StoryTextOverlay: 傾きと角のハンドル", () => {
    it("保存済みの文字（`rotate` が無い）は傾かない", () => {
        render(<StoryTextOverlay texts={[t()]} box={box} />);
        expect(para().style.transform, "rotate が書かれている").toBe("translate(-50%, -50%)");
    });

    it("傾けた文字は回る", () => {
        render(<StoryTextOverlay texts={[t({ rotate: 15 })]} box={box} />);
        expect(para().style.transform).toBe("translate(-50%, -50%) rotate(15deg)");
    });

    // **運ぶ → 回す の順**（CSS は右から当たるので `rotate` が先に効く）。
    // 逆に書くと運ぶ量そのものが回り、傾けた瞬間に文字が別の場所へ飛ぶ
    it("運ぶのが先、回すのが後（順序が逆でない）", () => {
        render(<StoryTextOverlay texts={[t({ rotate: 30 })]} box={box} />);
        const tr = para().style.transform;
        expect(tr.indexOf("translate")).toBeLessThan(tr.indexOf("rotate"));
    });

    it("壊れた傾きでも描ける（0 として読む）", () => {
        render(<StoryTextOverlay texts={[t({ rotate: NaN })]} box={box} />);
        expect(para().style.transform).toBe("translate(-50%, -50%)");
    });

    const handle = () => document.querySelector("[data-story-text-handle]") as HTMLElement | null;

    it("見る側にはハンドルを出さない", () => {
        render(<StoryTextOverlay texts={[t()]} box={box} />);
        expect(handle(), "見る側にハンドルが出ている").toBeNull();
    });

    // **選んでいる1つだけ。** 全部に出すと写真が的だらけになる
    it("ハンドルは選んでいる文字にだけ出る", () => {
        const texts = [t({ text: "あ" }), t({ text: "い" })];
        const { container } = render(
            <StoryTextOverlay
                texts={texts} box={box} selectedIndex={1}
                onPickIndex={vi.fn()} onGrabHandle={vi.fn()}
            />,
        );
        const handles = container.querySelectorAll("[data-story-text-handle]");
        expect(handles).toHaveLength(1);
        expect(handles[0].getAttribute("data-story-text-handle")).toBe("1");
    });

    // **親へ伝えない。** 親の pointerdown は「掴んで動かす」を始めるので、
    // 伝わると回そうとした指で文字が運ばれる
    it("ハンドルを掴んでも、文字を掴んだことにはならない", () => {
        const onGrab = vi.fn();
        const onPick = vi.fn();
        render(
            <StoryTextOverlay
                texts={[t()]} box={box} selectedIndex={0}
                onPickIndex={onPick} onGrabHandle={onGrab}
            />,
        );
        fireEvent.pointerDown(handle()!);
        expect(onGrab).toHaveBeenCalledTimes(1);
        expect(onGrab.mock.calls[0][0]).toBe(0);
        expect(onPick, "親の「掴んで動かす」まで始まっている").not.toHaveBeenCalled();
    });

    /**
     * **キーボードでも回せる・大きさを変えられる。**
     *
     * 角のハンドルは指の道具。これが無いと、なぞれない人は傾けられない。
     * 矢印キーは「動かす」に割り当て済みなので奪わない。
     */
    it("[ と ] で回る（矢印は動かすまま）", () => {
        const onTransform = vi.fn();
        const onNudge = vi.fn();
        render(
            <StoryTextOverlay
                texts={[t({ rotate: 10 })]} box={box} selectedIndex={0}
                onPickIndex={vi.fn()} onNudge={onNudge} onTransform={onTransform}
            />,
        );
        fireEvent.keyDown(para(), { key: "]" });
        expect(onTransform.mock.calls[0][1]).toEqual({ rotate: 15 });
        fireEvent.keyDown(para(), { key: "[" });
        expect(onTransform.mock.calls[1][1]).toEqual({ rotate: 5 });
        // **矢印は今までどおり「動かす」**（回転に奪われていない）
        fireEvent.keyDown(para(), { key: "ArrowRight" });
        expect(onNudge).toHaveBeenCalledTimes(1);
    });

    /**
     * **`Shift` を押した `[` `]` は、ブラウザでは `{` `}` になる。**
     *
     * `[` `]` だけを見ていたので、`Shift` の刻み（15度）には**どうやっても
     * 届かなかった**。対テストが `{ key: "]", shiftKey: true }` という
     * **実ブラウザでは起きない組み合わせ**を投げていて、それで緑になって
     * いた——CLAUDE.md の「何も検証していないテスト」そのもの。
     *
     * ここは**実際に飛んでくる `key`** で見る。
     */
    it("Shift を押した `{` `}` でも回る（15度）", () => {
        const onTransform = vi.fn();
        render(
            <StoryTextOverlay
                texts={[t({ rotate: 0 })]} box={box} selectedIndex={0}
                onPickIndex={vi.fn()} onTransform={onTransform}
            />,
        );
        fireEvent.keyDown(para(), { key: "}", shiftKey: true });
        expect(onTransform.mock.calls[0][1], "Shift の刻みに届いていない").toEqual({ rotate: 15 });
        fireEvent.keyDown(para(), { key: "{", shiftKey: true });
        expect(onTransform.mock.calls[1][1]).toEqual({ rotate: -15 });
    });

    // **空の文字にハンドルを出さない。** 「＋」で足した直後は `text: ""` で
    // 箱が 0×0——そこを掴むと、少し動かしただけで大きさが上限に張り付き、
    // 傾きも雑音から決まる
    it("文言が空のうちはハンドルを出さない", () => {
        render(
            <StoryTextOverlay
                texts={[t({ text: "" })]} box={box} selectedIndex={0}
                onPickIndex={vi.fn()} onGrabHandle={vi.fn()}
            />,
        );
        expect(document.querySelector("[data-story-text-handle]")).toBeNull();
    });

    it("+ と - で大きさが変わる", () => {
        const onTransform = vi.fn();
        render(
            <StoryTextOverlay
                texts={[t()]} box={box} selectedIndex={0}
                onPickIndex={vi.fn()} onTransform={onTransform}
            />,
        );
        fireEvent.keyDown(para(), { key: "+" });
        expect(onTransform.mock.calls[0][1].size).toBeGreaterThan(STORY_SIZE_DEFAULT);
        fireEvent.keyDown(para(), { key: "-" });
        expect(onTransform.mock.calls[1][1].size).toBeLessThan(STORY_SIZE_DEFAULT);
    });

    // **できる操作を全部名乗る。** 回転を足したのに読み上げが
    // 「矢印キーで動かせます」のままだと、指でなぞれない人には
    // **傾けられること自体が伝わらない**
    it("読み上げが、回転と大きさの操作も名乗る", () => {
        render(
            <StoryTextOverlay
                texts={[t()]} box={box} selectedIndex={0}
                onPickIndex={vi.fn()} onTransform={vi.fn()}
            />,
        );
        const label = para().getAttribute("aria-label") ?? "";
        expect(label).toContain("矢印キーで移動");
        expect(label).toContain("[ と ] で回転");
        expect(label).toContain("+ と - で大きさ");
    });
});

/**
 * スタンプの描き方。
 *
 * **知らない絵柄は、文字として描かない。** 引き当てた結果で分岐すると
 * 一覧に無い鍵が文字の枝へ落ち、`text` を持たないまま描かれる——
 * 中身も読み上げも空の `<p>` が出て（置いたスタンプが消えた投稿に見える）、
 * 下書き側では `name.trim()` が TypeError になる。
 */
describe("StoryTextOverlay: スタンプ", () => {
    const stamp = (over: Record<string, unknown> = {}) =>
        ({ kind: "stamp", stamp: "heart", x: 0.5, y: 0.5, size: 0.12, ...over }) as unknown as StoryTextItem;

    it("絵柄を描く（読み上げは絵柄の名前）", () => {
        const { container } = render(<StoryTextOverlay texts={[stamp()]} box={box} />);
        const img = container.querySelector('[role="img"]') as HTMLElement;
        expect(img.textContent).toBe(STORY_STAMPS.heart.glyph);
        expect(img.getAttribute("aria-label")).toBe(STORY_STAMPS.heart.label);
    });

    // 字体・色・下地は絵柄に効かない（当てない）
    it("スタンプに字体や下地を当てない", () => {
        const { container } = render(<StoryTextOverlay texts={[stamp()]} box={box} />);
        const p = container.querySelector("p") as HTMLElement;
        expect(p.style.fontFamily, "字体を当てている").toBe("");
        expect(p.style.background, "下地を当てている").toBe("transparent");
    });

    it("スタンプも位置・大きさ・傾きは文字と同じ規則", () => {
        const { container } = render(<StoryTextOverlay texts={[stamp({ x: 0.25, rotate: 30 })]} box={box} />);
        const p = container.querySelector("p") as HTMLElement;
        expect(p.style.left).toBe("25%");
        expect(p.style.fontSize).toBe(`${Math.round(box.width * 0.12)}px`);
        expect(p.style.transform).toContain("rotate(30deg)");
    });

    // **知らない絵柄は描かない**（空の `<p>` を出さない・落ちない）
    it("一覧に無い絵柄は、その要素だけ描かない", () => {
        const { container } = render(
            <StoryTextOverlay texts={[stamp({ stamp: "unicorn" }), t({ text: "朝" })]} box={box} />,
        );
        const ps = [...container.querySelectorAll("p")];
        expect(ps, "知らない絵柄まで描いている").toHaveLength(1);
        expect(ps[0].textContent).toBe("朝");
    });

    // 下書き側でも落ちない（`name.trim()` の TypeError）
    it("一覧に無い絵柄が下書きに混ざっても落ちない", () => {
        expect(() => render(
            <StoryTextOverlay
                texts={[stamp({ stamp: "unicorn" })]} box={box} selectedIndex={0}
                onPickIndex={vi.fn()} onGrabHandle={vi.fn()}
            />,
        )).not.toThrow();
    });

    it("スタンプにもハンドルを出す", () => {
        const { container } = render(
            <StoryTextOverlay
                texts={[stamp()]} box={box} selectedIndex={0}
                onPickIndex={vi.fn()} onGrabHandle={vi.fn()}
            />,
        );
        expect(container.querySelector("[data-story-text-handle]")).not.toBeNull();
    });
});

/**
 * 投票スタンプの描き方（⑨-3）。
 *
 * **2択は見る側の段でしか押せるようにしない。** ここでは `<button>` を
 * 置かない——票を送る口（`onVote`）はこのあとの段で足すので、先に
 * `<button>` を置くと「押しても効かない的」になる。
 */
describe("StoryTextOverlay: 投票", () => {
    // 形は型に見せる（`as unknown as` で握ると `options` の綴り違いを型が止めない）
    const vote = (over: Partial<StoryVoteItem> = {}): StoryVoteItem =>
        ({ kind: "vote", question: "この景色、好き？", options: ["はい", "いいえ"], x: 0.5, y: 0.6, size: 0.05, ...over });
    const stamp = (): StoryStampItem => ({ kind: "stamp", stamp: "heart", x: 0.5, y: 0.5, size: 0.12 });

    it("問いと2択を描く", () => {
        const { container } = render(<StoryTextOverlay texts={[vote()]} box={box} />);
        const card = container.querySelector("[data-story-vote]") as HTMLElement;
        expect(card.textContent).toContain("この景色、好き？");
        expect(card.textContent).toContain("はい");
        expect(card.textContent).toContain("いいえ");
    });

    // **白いカード**（塗りの下地の経路を借りる＝白地・黒字・影なし）
    it("白いカードとして描く（字体は当てない）", () => {
        const { container } = render(<StoryTextOverlay texts={[vote()]} box={box} />);
        const p = container.querySelector("p") as HTMLElement;
        expect(p.style.background).toBe("rgb(255, 255, 255)");
        expect(p.style.color).toBe("rgb(0, 0, 0)");
        expect(p.style.textShadow).toBe("none");
        expect(p.style.fontFamily, "字体を当てている").toBe("");
    });

    // 票を送る口が無い段では、押せる形にしない
    it("この段では2択は押せない（button を置かない）", () => {
        const { container } = render(<StoryTextOverlay texts={[vote()]} box={box} />);
        expect(container.querySelectorAll("button")).toHaveLength(0);
    });

    it("投票も位置・大きさ・傾きは文字と同じ規則", () => {
        const { container } = render(<StoryTextOverlay texts={[vote({ x: 0.25, rotate: 10 })]} box={box} />);
        const p = container.querySelector("p") as HTMLElement;
        expect(p.style.left).toBe("25%");
        expect(p.style.fontSize).toBe(`${Math.round(box.width * 0.05)}px`);
        expect(p.style.transform).toContain("rotate(10deg)");
    });

    // 読み上げは「投票」と名乗り、問いを読む
    it("下書きでは「投票」として名乗り、ハンドルが出る", () => {
        const { container } = render(
            <StoryTextOverlay
                texts={[vote()]} box={box} selectedIndex={0}
                onPickIndex={vi.fn()} onGrabHandle={vi.fn()} onTransform={vi.fn()}
            />,
        );
        const p = container.querySelector("p") as HTMLElement;
        expect(p.getAttribute("aria-label")).toContain("投票「この景色、好き？」");
        expect(container.querySelector("[data-story-text-handle]")).not.toBeNull();
    });

    // **知らない種類は描かない**（新しい画面が先に出した `kind`）。
    // 述語が否定形だと文字の枝へ落ち、`text` の無い `<p>` が出る
    it("知らない kind の要素は、その要素だけ描かない（落ちない）", () => {
        const future = { kind: "future", x: 0.5, y: 0.5, size: 0.06 } as unknown as StoryText;
        const { container } = render(<StoryTextOverlay texts={[future, t({ text: "朝" })]} box={box} />);
        const ps = [...container.querySelectorAll("p")];
        expect(ps, "知らない種類まで描いている").toHaveLength(1);
        expect(ps[0].textContent).toBe("朝");
        expect(() => render(
            <StoryTextOverlay texts={[future]} box={box} selectedIndex={0} onPickIndex={vi.fn()} onGrabHandle={vi.fn()} />,
        )).not.toThrow();
    });

    // 文字・スタンプ・投票が混ざっても、それぞれが自分の形で出る
    it("文字・スタンプと混ざっても、投票が文字の枝へ落ちない", () => {
        const { container } = render(
            <StoryTextOverlay texts={[t({ text: "朝" }), vote(), stamp()]} box={box} />,
        );
        const ps = [...container.querySelectorAll("p")];
        expect(ps).toHaveLength(3);
        expect(ps[0].textContent).toBe("朝");
        expect(ps[1].querySelector("[data-story-vote]")).not.toBeNull();
        expect(ps[2].querySelector('[role="img"]')).not.toBeNull();
    });
});

/**
 * 投票スタンプ（見る側で票を入れる）。
 *
 * **`<button>` にするのは `onVote` を渡し、まだ入れていないときだけ。**
 * 数（割合）は `voteState.counts` が在るときだけ出す（投稿者と入れた人だけに届く）。
 */
describe("StoryTextOverlay: 投票に票を入れる", () => {
    const vote = (): StoryVoteItem =>
        ({ kind: "vote", question: "この景色、好き？", options: ["はい", "いいえ"], x: 0.5, y: 0.6, size: 0.05 });
    const buttons = () => screen.queryAllByRole("button", { name: /「.+」に投票/ });

    it("onVote を渡すと2択が押せて、番号と選択肢で呼ばれる", async () => {
        const onVote = vi.fn();
        render(<StoryTextOverlay texts={[vote()]} box={box} onVote={onVote} />);
        expect(buttons()).toHaveLength(2);
        fireEvent.click(screen.getByRole("button", { name: "「いいえ」に投票" }));
        expect(onVote).toHaveBeenCalledWith(0, "b");
        fireEvent.click(screen.getByRole("button", { name: "「はい」に投票" }));
        expect(onVote).toHaveBeenLastCalledWith(0, "a");
    });

    // 親は `pointer-events-none`。**押せる `<button>` だけ**受ける——箱ごと受けると、
    // 問いの部分が右上の閉じるボタンなどを覆ったときにそちらが押せなくなる
    it("票を入れる button だけが pointer-events を受ける（箱と文字は受けない）", () => {
        const { container } = render(<StoryTextOverlay texts={[t({ text: "朝" }), vote()]} box={box} onVote={vi.fn()} />);
        const ps = [...container.querySelectorAll("p")];
        expect(ps[0].className, "見る側の文字が押せる形になっている").not.toContain("pointer-events-auto");
        expect(ps[1].className, "投票の箱ごと受けている").not.toContain("pointer-events-auto");
        for (const b of buttons()) expect(b.className, "ボタンが親の pointer-events-none に埋もれている").toContain("pointer-events-auto");
    });

    it("入れてある（myVote）なら押せず、自分の票に印が付く", () => {
        const { container } = render(
            <StoryTextOverlay texts={[vote()]} box={box} onVote={vi.fn()} voteState={{ myVote: "a", counts: { a: 1, b: 3 } }} />,
        );
        expect(buttons()).toHaveLength(0);
        expect((container.querySelector("p") as HTMLElement).className).not.toContain("pointer-events-auto");
        const mine = container.querySelector('[aria-current="true"]') as HTMLElement;
        // 見える文字は「✓ はい 25%」、票数は隠し文字（読み上げだけ）
        expect(mine.textContent).toBe("✓ はい 25%（1票）");
        expect(mine.querySelector(".sr-only")?.textContent).toBe("（1票）");
    });

    it("数が在るときだけ割合を出す（読み上げには票数も）", () => {
        const { container, rerender } = render(<StoryTextOverlay texts={[vote()]} box={box} voteState={{ counts: { a: 2, b: 1 } }} />);
        expect(container.textContent).toContain("はい 67%");
        expect(container.textContent).toContain("いいえ 33%");
        // 票数は隠し文字で（role の無い span の aria-label は読まれない）
        expect([...container.querySelectorAll(".sr-only")].map((e) => e.textContent)).toEqual(["（2票）", "（1票）"]);
        rerender(<StoryTextOverlay texts={[vote()]} box={box} />);
        expect(container.textContent, "数が無いのに割合を出している").not.toMatch(/%/);
        expect(container.querySelector(".sr-only"), "数が無いのに票数を読み上げている").toBeNull();
    });

    // **b は 100 − a**。両方を丸めると 1対7 が 13%＋88% になる
    it("割合の和は必ず 100", () => {
        const { container } = render(<StoryTextOverlay texts={[vote()]} box={box} voteState={{ counts: { a: 1, b: 7 } }} />);
        expect(container.textContent).toContain("はい 13%");
        expect(container.textContent).toContain("いいえ 87%");
    });

    // 0%/0% は引き分けに読める
    it("数が見えて 0 票なら、割合ではなく「まだ票はありません」", () => {
        const { container } = render(<StoryTextOverlay texts={[vote()]} box={box} voteState={{ counts: { a: 0, b: 0 } }} />);
        expect(container.textContent).not.toMatch(/%/);
        expect(container.textContent).toContain("まだ票はありません");
        expect(container.querySelector(".sr-only"), "0票なのに「（0票）」を読み上げている").toBeNull();
    });

    it("送っている間は押せない", () => {
        render(<StoryTextOverlay texts={[vote()]} box={box} onVote={vi.fn()} voting />);
        for (const b of buttons()) expect(b).toBeDisabled();
    });

    it("onVote が無ければ button を置かない（下書き・未ログイン）", () => {
        render(<StoryTextOverlay texts={[vote()]} box={box} />);
        expect(buttons()).toHaveLength(0);
    });
});

// iPhone の VoiceOver では、指でなぞることも矢印キーも使えない。
// 置いた文字を動かす・回す・大きさを変える手段が無かった
// （docs/ios-bug-audit-2026-09-25.md #53）。
describe("VoiceOver から動かせる", () => {
    it("選んでいる文字にだけ、動かす・回す・大きさのボタンを出す", () => {
        const onNudge = vi.fn();
        const onTransform = vi.fn();
        render(
            <StoryTextOverlay
                texts={[t({ text: "あ" }), t({ text: "い", rotate: 0 })]} box={box} selectedIndex={1}
                onPickIndex={vi.fn()} onNudge={onNudge} onTransform={onTransform} locale="ja"
            />,
        );
        expect(screen.getAllByRole("button", { name: "上へ動かす" })).toHaveLength(1);
        fireEvent.click(screen.getByRole("button", { name: "右へ動かす" }));
        expect(onNudge).toHaveBeenCalledWith(1, 0.05, 0);
        fireEvent.click(screen.getByRole("button", { name: "右に回す" }));
        expect(onTransform.mock.calls[0][0]).toBe(1);
        expect(onTransform.mock.calls[0][1].rotate).toBeGreaterThan(0);
        fireEvent.click(screen.getByRole("button", { name: "大きくする" }));
        expect(onTransform.mock.calls[1][1].size).toBeGreaterThan(STORY_SIZE_DEFAULT);
    });

    it("見る側（動かせない）には出さない", () => {
        render(<StoryTextOverlay texts={[t()]} box={box} selectedIndex={0} locale="ja" />);
        expect(screen.queryByRole("button", { name: "上へ動かす" })).toBeNull();
    });
});
