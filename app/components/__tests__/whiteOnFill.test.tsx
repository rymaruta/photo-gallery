import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { expectNoWhiteOnFill } from "./whiteOnFill";

/** 見張りそのものの自己確認（素通りする形を作らない） */
describe("expectNoWhiteOnFill", () => {
    const run = (el: React.ReactElement) => () => expectNoWhiteOnFill(render(el).container);

    it("塗りの中の SVG の白を捕まえる（className が SVGAnimatedString でも）", () => {
        expect(run(<button className="bg-accent-fill text-ink"><svg className="text-white" /></button>)).toThrow();
    });
    it("半透明の白の文字を捕まえる", () => {
        expect(run(<button className="bg-accent-fill text-ink"><span className="text-white/90">3</span></button>)).toThrow();
    });
    it("白いフォーカス枠を捕まえる", () => {
        expect(run(<button className="bg-accent-fill text-ink focus:ring-white/60">x</button>)).toThrow();
    });
    it("半透明の塗り（bg-accent-fill/90）も塗りとして見る", () => {
        expect(run(<span className="bg-accent-fill/90 text-white">x</span>)).toThrow();
    });
    it("墨の文字だけなら通る", () => {
        expect(run(<button className="bg-accent-fill text-ink"><span className="text-ink/60">3</span></button>)).not.toThrow();
    });
    it("塗りが1つも無ければ落とす（前提が崩れた試験を素通りさせない）", () => {
        expect(run(<button className="bg-surface text-white">x</button>)).toThrow();
    });
});
