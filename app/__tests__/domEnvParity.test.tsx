import { describe, it, expect } from "vitest";

/**
 * **DOM のテストの仮想ブラウザ（happy-dom）を、jsdom と同じ前提に揃えてあること。**
 *
 * 揃えているのは `vitest.setup.ts`。外れると、テストが**黙って別のものを確かめる**:
 * `matchMedia` があると画面が PC の形で描かれ、フォーカスできない要素にも
 * `focus()` が効くと `tabIndex` の付け忘れを見逃す。
 */
describe("DOM のテストの前提（jsdom と揃える）", () => {
    it("matchMedia は既定で無い（画面は「無ければスマホの形」に倒す）", () => {
        expect(typeof window.matchMedia).not.toBe("function");
    });

    it("tabindex の無い div には focus() が効かない", () => {
        const div = document.createElement("div");
        document.body.appendChild(div);
        div.focus();
        expect(document.activeElement, "フォーカスできない要素に入っている").not.toBe(div);
        div.remove();
    });

    it("tabindex があれば入る・ボタンやリンクにも入る", () => {
        const div = document.createElement("div");
        div.tabIndex = -1;
        const button = document.createElement("button");
        const link = document.createElement("a");
        link.href = "/x";
        const plainLink = document.createElement("a");
        document.body.append(div, button, link, plainLink);
        div.focus();
        expect(document.activeElement).toBe(div);
        button.focus();
        expect(document.activeElement).toBe(button);
        link.focus();
        expect(document.activeElement).toBe(link);
        plainLink.focus();
        expect(document.activeElement, "href の無い a に入っている").toBe(link);
        div.remove(); button.remove(); link.remove(); plainLink.remove();
    });
});
