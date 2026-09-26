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
 */
export function expectNoWhiteOnFill(root: HTMLElement): void {
    const fills = Array.from(root.querySelectorAll<HTMLElement>("[class]"))
        .filter((el) => el.className.toString().split(/\s+/).includes("bg-accent-fill"));
    expect(fills.length, "塗りの要素が1つも無い（試験の前提が崩れている）").toBeGreaterThan(0);
    for (const fill of fills) {
        for (const el of [fill, ...Array.from(fill.querySelectorAll<HTMLElement>("[class]"))]) {
            const tokens = el.className.toString().split(/\s+/);
            expect(tokens, `白の塗りの上に白い文字: ${el.outerHTML.slice(0, 120)}`).not.toContain("text-white");
            expect(tokens.filter((t) => t.startsWith("focus-visible:ring-white")),
                `白の塗りに白いフォーカス枠: ${el.outerHTML.slice(0, 120)}`).toEqual([]);
        }
    }
}
