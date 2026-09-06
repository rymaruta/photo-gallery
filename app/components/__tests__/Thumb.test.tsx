import React from "react";
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import Thumb, { buildSrcSet } from "../Thumb";

describe("buildSrcSet", () => {
    it("256/512 の両方があれば srcset を組む", () => {
        expect(buildSrcSet("a256.webp", "b512.webp")).toBe("a256.webp 256w, b512.webp 512w");
    });
    it("片方だけ・無しに対応", () => {
        expect(buildSrcSet(undefined, "b512.webp")).toBe("b512.webp 512w");
        expect(buildSrcSet("a256.webp", undefined)).toBe("a256.webp 256w");
        expect(buildSrcSet(undefined, undefined)).toBeUndefined();
    });
});

describe("Thumb <picture> の出し分け", () => {
    const base = { src: "https://cdn/x.jpg", thumbSrc: "https://cdn/x_thumb.webp" };

    it("派生があれば avif/webp の <source> を出す", () => {
        const { container } = render(
            <div style={{ position: "relative" }}>
                <Thumb
                    photo={{
                        ...base,
                        thumbAvif: "https://cdn/x_thumb.avif",
                        thumbSm: "https://cdn/x_thumb_sm.webp",
                        thumbSmAvif: "https://cdn/x_thumb_sm.avif",
                    }}
                    alt="t"
                    sizes="50vw"
                />
            </div>
        );
        const sources = container.querySelectorAll("picture source");
        const types = Array.from(sources).map((s) => s.getAttribute("type"));
        expect(types).toContain("image/avif");
        expect(types).toContain("image/webp");
        const avif = Array.from(sources).find((s) => s.getAttribute("type") === "image/avif")!;
        expect(avif.getAttribute("srcset")).toContain("256w");
        expect(avif.getAttribute("srcset")).toContain("512w");
        // フォールバック img は従来サムネ
        expect(container.querySelector("picture > img")?.getAttribute("src")).toBe(base.thumbSrc);
    });

    it("派生が無ければ <source> は出さず img フォールバックのみ", () => {
        const { container } = render(
            <div style={{ position: "relative" }}>
                <Thumb photo={base} alt="t" sizes="50vw" />
            </div>
        );
        expect(container.querySelectorAll("picture source").length).toBe(0);
        expect(container.querySelector("picture > img")?.getAttribute("src")).toBe(base.thumbSrc);
    });
});

// **ハイドレーションまでは隠さない。** 以前は `opacity-0` を静的HTMLに焼いていたので、
// JS が届いて React が付くまで画像が透明のままだった（Chromium 実測・
// Fast 3G + CPU 4倍: 画像は 1.6秒で届いているのに、見えるのは 5.9秒）。
// 読み込み中の <img> は何も描かない（下のぼかしが透ける。実測）ので、
// 「まだ分からない」間は見せておき、React が付いた時点で決める
describe("Thumb: ハイドレーション前は隠さない", () => {
    const base = { src: "https://cdn/x.jpg", thumbSrc: "https://cdn/x_thumb.webp", blurDataURL: "data:image/webp;base64,AAAA" };
    const setReady = (ready: boolean) => {
        Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => ready });
        Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => (ready ? 512 : 0) });
    };
    const restore = () => {
        // jsdom の元の定義に戻す（プロトタイプの上書きを消す）
        delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).complete;
        delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).naturalWidth;
    };

    it("静的HTML（サーバー描画）では画像を透明にしない。ぼかしは敷く", () => {
        const html = renderToString(<Thumb photo={base} alt="t" />);
        expect(html, "JS が届くまで写真が透明のまま").not.toContain("opacity-0");
        expect(html).toContain("opacity-100");
        // ぼかしは JS 無しでも出る（届くまでの間の絵）
        expect(html).toContain('src="data:image/webp;base64,AAAA"');
    });

    it("React が付いた時点でまだ届いていなければ隠し、届いたらフェードで出す", () => {
        setReady(false);
        try {
            const { container } = render(<div style={{ position: "relative" }}><Thumb photo={base} alt="t" /></div>);
            const img = container.querySelector("picture > img")!;
            expect(img.className).toContain("opacity-0");
            expect(container.querySelector('img[src^="data:"]'), "ぼかしが消えている").not.toBeNull();
            fireEvent.load(img);
            expect(img.className).toContain("opacity-100");
            expect(img.className).not.toContain("opacity-0");
            expect(container.querySelector('img[src^="data:"]'), "届いたのにぼかしが残っている").toBeNull();
        } finally { restore(); }
    });

    it("React が付いた時点で既に届いていれば、隠さずぼかしも外す（キャッシュ済みの再訪）", () => {
        setReady(true);
        try {
            const { container } = render(<div style={{ position: "relative" }}><Thumb photo={base} alt="t" /></div>);
            const img = container.querySelector("picture > img")!;
            expect(img.className).toContain("opacity-100");
            expect(img.className).not.toContain("opacity-0");
            expect(container.querySelector('img[src^="data:"]')).toBeNull();
        } finally { restore(); }
    });
});
