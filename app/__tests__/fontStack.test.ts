import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * **本文の字体が宣言されていなかった。**
 *
 * `Inter` は日本語のグリフを持たず、`next/font` が作るクラスは
 * `font-family: Inter, "Inter Fallback"` **だけ**（実ビルドの CSS で確認）。
 * `globals.css` の `html, body { font-family: ... sans-serif }` は
 * **クラスの方が詳細度が高いので効かない**。
 *
 * 結果、ほぼ全部が日本語のこのサイトで、本文は**総称ファミリすら無い**
 * 状態だった。一方ヘッダーは `.site-header__nav` で日本語の並びを
 * 宣言している——**同じページの中で字体が割れうる**。
 *
 * ここで縛るのは「2つが同じ並びであること」。片方だけ足すと、
 * また割れる（台帳の型「入口が2つあるのに片方しか直っていない」）。
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/** `globals.css` のヘッダーが宣言している並び */
function navStack(): string[] {
    const css = read("app/globals.css");
    const m = /\.site-header__nav\s*\{[^}]*font-family:\s*([^;}]+)/.exec(css);
    if (!m) return [];
    return m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
}

/** `layout.tsx` が `next/font` に渡している fallback */
function fontFallback(): string[] {
    const src = read("app/layout.tsx");
    const m = /fallback:\s*\[([^\]]*)\]/.exec(src);
    if (!m) return [];
    return m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

const GENERIC = new Set(["sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif"]);

describe("本文の字体", () => {
    it("ヘッダーの宣言を読めている（空振りしていない）", () => {
        expect(navStack().length).toBeGreaterThan(2);
    });

    it("本文の fallback を渡している", () => {
        expect(fontFallback().length, "next/font に fallback が無い＝日本語の字体が宣言されない").toBeGreaterThan(0);
    });

    // **同じ並びにする。** 片方だけ足すと、見出しと本文で字体が割れる
    it("ヘッダーと本文が同じ並びを宣言する", () => {
        expect(fontFallback()).toEqual(navStack());
    });

    // 総称ファミリで終わらないと、どれも無い端末でブラウザの既定
    // （環境により明朝）に落ちる
    it("総称ファミリで終わる", () => {
        const last = fontFallback().at(-1);
        expect(GENERIC.has(String(last)), `最後が総称ファミリでない: ${last}`).toBe(true);
        expect(GENERIC.has(String(navStack().at(-1))), "ヘッダー側も総称で終わっていない").toBe(true);
    });

    // 日本語の字体を1つは名指しする（総称だけだと端末の既定任せに戻る）
    it("日本語の字体を名指ししている", () => {
        expect(fontFallback().some((f) => /JP|Japanese|Gothic|ゴシック/i.test(f)), "日本語の字体が並びに無い").toBe(true);
    });
});
