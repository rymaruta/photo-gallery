import { expect } from "vitest";

/**
 * **白の塗り（`bg-accent-fill`）の上に、白い文字・白いフォーカス枠を置かない。**
 *
 * 塗りは 2026-09-26 に旧版の青から白（#ebebeb）へ移した。塗りの要素そのものの
 * 文字色は置き換えたが、**子が自分の文字色を別の文字列で持っている**所
 * （件数の `<span>` など）は取り残され、白地に白（約1.2:1）で消えていた。
 * `textContrast.test.ts` は `text-white` を「濃い色」として通すので捕まえない。
 *
 * 描いた画面を見て、塗りの要素とその子孫を全部調べる。
 *
 * ⚠️ **見るのはクラス名だけ。** inline style（`boxShadow` の白い縁など）は見ない。
 * クラスは `getAttribute("class")` で読む——SVG の `className` は
 * SVGAnimatedString で、`toString()` が "[object SVGAnimatedString]" になり
 * **黙って素通りする**（jsdom で確かめた）。
 */
export function expectNoWhiteOnFill(root: HTMLElement): void {
    const fills = Array.from(root.querySelectorAll<HTMLElement>("[class]"))
        .filter((el) => classes(el).some((t) => t === "bg-accent-fill" || t.startsWith("bg-accent-fill/")));
    expect(fills.length, "塗りの要素が1つも無い（試験の前提が崩れている）").toBeGreaterThan(0);
    for (const fill of fills) {
        for (const el of [fill, ...Array.from(fill.querySelectorAll<HTMLElement>("[class]"))]) {
            const tokens = classes(el);
            // 半透明の白（text-white/90）も塗りの上では溶ける
            expect(tokens.filter((t) => /^(text|fill|stroke)-white(\/\d+)?$/.test(t)),
                `白の塗りの上に白い文字・図形: ${el.outerHTML.slice(0, 120)}`).toEqual([]);
            expect(tokens.filter((t) => /^focus(-visible)?:ring-white/.test(t)),
                `白の塗りに白いフォーカス枠: ${el.outerHTML.slice(0, 120)}`).toEqual([]);
        }
    }
}

function classes(el: Element): string[] {
    return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}
