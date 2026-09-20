import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StoryTextOverlay from "../StoryTextOverlay";
import { STORY_COLORS, STORY_FONTS, STORY_SIZES, type StoryTextStyle } from "@/lib/utils/storyText";

/**
 * 置いた文字の描き方。
 *
 * **見る側（`StoryViewer`）と下書き（`StoriesBar`）が同じ部品を使う。**
 * 別々に描くと「置いた場所と出る場所が違う」になり、置き直しても直らない。
 */
const style = (over: Partial<StoryTextStyle> = {}): StoryTextStyle =>
    ({ x: 0.5, y: 0.5, size: "l", font: "bold", color: "white", bg: "none", ...over });

const box = { left: 30, top: 60, width: 300, height: 500 };
const para = () => screen.getByText("こんにちは");

describe("StoryTextOverlay", () => {
    it("絵の矩形に重ねる（囲みではなく）", () => {
        const { container } = render(<StoryTextOverlay text="こんにちは" style={style()} box={box} />);
        const area = container.firstElementChild as HTMLElement;
        expect(area.style.left).toBe("30px");
        expect(area.style.top).toBe("60px");
        expect(area.style.width).toBe("300px");
        expect(area.style.height).toBe("500px");
    });

    // **測れていないときは消さない。** jsdom にはレイアウトが無いので、
    // 「幅0」と「測れていない」を分けないとテストでも本番でも文字が消える
    it("矩形が測れていなければ囲み全体に載せる（文字を消さない）", () => {
        const { container } = render(<StoryTextOverlay text="こんにちは" style={style()} box={null} />);
        const area = container.firstElementChild as HTMLElement;
        expect(area.style.inset).toBe("0px");
        expect(para()).toBeInTheDocument();
        // 幅が無いと px で大きさを決められないので、そのときだけ vw
        expect(para().style.fontSize).toContain("vw");
    });

    // **絵の幅に対する割合。** px で持つと、撮った端末と見る端末で別の大きさになる
    it("大きさは絵の幅から決める", () => {
        render(<StoryTextOverlay text="こんにちは" style={style({ size: "m" })} box={box} />);
        expect(para().style.fontSize).toBe(`${Math.round(box.width * STORY_SIZES.m)}px`);
    });

    it("字体と色を当てる", () => {
        render(<StoryTextOverlay text="こんにちは" style={style({ font: "mincho", color: "sky" })} box={box} />);
        expect(para().style.fontFamily).toContain("Hiragino Mincho ProN");
        expect(para().style.fontWeight).toBe(String(STORY_FONTS.mincho.weight));
        expect(para().style.color).toBe("rgb(100, 210, 255)");   // STORY_COLORS.sky
    });

    // 下地が「塗り」のときは、選んだ色が下地になり文字が反転する
    it("塗りの下地では、色が下地になり文字が反転する", () => {
        render(<StoryTextOverlay text="こんにちは" style={style({ color: "blue", bg: "solid" })} box={box} />);
        const s = para().style;
        expect(s.background, "選んだ色が下地になっていない").toBe("rgb(10, 132, 255)");   // STORY_COLORS.blue
        expect(s.color).toBe("rgb(255, 255, 255)");              // STORY_COLORS.blue.on
        expect(s.textShadow, "下地があるのに影も付けている").toBe("none");
    });

    // **下地が無いときは影で浮かせる。** 白い空に白い文字を置くと消える
    it("下地なしでは影を付ける", () => {
        render(<StoryTextOverlay text="こんにちは" style={style({ bg: "none" })} box={box} />);
        expect(para().style.textShadow, "影が無いと明るい写真の上で消える").not.toBe("none");
        expect(para().style.textShadow).toBeTruthy();
    });

    it("うす下地は黒の半透明（選んだ色は文字のまま）", () => {
        render(<StoryTextOverlay text="こんにちは" style={style({ color: "yellow", bg: "soft" })} box={box} />);
        expect(para().style.background).toContain("rgba(0, 0, 0, 0.45)");
        expect(para().style.color).toBe("rgb(255, 214, 10)");
    });

    /**
     * 🔴 **端では中央合わせをやめて縁に寄せる。**
     * いつも `translate(-50%,-50%)` だと、箱が広いとき端の文字が
     * 画面の外へ切れる（実測で左が 5px 欠けた）。
     */
    it("端では縁に寄せる（切れない）", () => {
        const { rerender } = render(<StoryTextOverlay text="こんにちは" style={style({ x: 0, y: 0 })} box={box} />);
        expect(para().style.transform, "左上で中央合わせのまま").toBe("translate(0%, 0%)");

        rerender(<StoryTextOverlay text="こんにちは" style={style({ x: 1, y: 1 })} box={box} />);
        expect(para().style.transform, "右下で中央合わせのまま").toBe("translate(-100%, -100%)");

        rerender(<StoryTextOverlay text="こんにちは" style={style({ x: 0.5, y: 0.5 })} box={box} />);
        expect(para().style.transform, "真ん中では中央合わせ").toBe("translate(-50%, -50%)");
    });

    it("置いた割合をそのまま left/top にする", () => {
        render(<StoryTextOverlay text="こんにちは" style={style({ x: 0.25, y: 0.75 })} box={box} />);
        expect(para().style.left).toBe("25%");
        expect(para().style.top).toBe("75%");
    });

    // **スクリム（上下の黒いグラデーション）より上。** 下だと白い文字が灰色に沈む
    it("スクリムより上に出す", () => {
        const { container } = render(<StoryTextOverlay text="こんにちは" style={style()} box={box} />);
        const area = container.firstElementChild as HTMLElement;
        expect(Number(area.style.zIndex), "スクリム（z-20）より下にある").toBeGreaterThan(20);
        // 押せるものは塞がない
        expect(area.className).toContain("pointer-events-none");
    });

    it("改行と長い文は折り返す（はみ出させない）", () => {
        render(<StoryTextOverlay text="こんにちは" style={style()} box={box} />);
        expect(para().className).toContain("whitespace-pre-wrap");
        expect(para().className).toContain("break-words");
        expect(para().style.maxWidth).toBeTruthy();
    });
});
