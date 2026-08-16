import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
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
