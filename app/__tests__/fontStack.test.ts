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

/**
 * `public/offline.html` の宣言（**3つ目の写し**）。
 *
 * あのページは Service Worker が機内モードで出す受け皿で、**アプリの CSS も
 * JS も届かない**（それが存在理由）。だから宣言を共有できず、必ず写しになる。
 *
 * **並びまで同じにはしない。** あちらは単独のページとして独立に書かれていて
 * （`-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif`）、
 * どちらの並びが良いかは字体の好みの判断＝owner の領分。
 * ここで縛るのは**壊れ方が同じ2つ**だけ:
 *   - 総称ファミリで終わらない（ブラウザの既定に落ちる。環境により明朝）
 *   - 日本語の字体を1つも名指ししない
 */
function offlineStack(): string[] {
    const html = read("public/offline.html");
    const m = /font-family:\s*([^;}]+)/.exec(html);
    if (!m) return [];
    return m[1].split(",").map((x) => x.trim().replace(/^["']|["']$/g, ""));
}

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

/**
 * **機内モードで出るページにも同じ性質を求める。**
 * ここは `app/globals.css` も `next/font` も届かないので、写しが1つ増える。
 */
describe("オフラインの受け皿（public/offline.html）", () => {
    it("宣言を読めている（空振りしていない）", () => {
        expect(offlineStack().length).toBeGreaterThan(2);
    });

    it("総称ファミリで終わる", () => {
        expect(GENERIC.has(String(offlineStack().at(-1))), `最後が総称でない: ${offlineStack().at(-1)}`).toBe(true);
    });

    it("日本語の字体を名指ししている", () => {
        expect(offlineStack().some((f) => /JP|Japanese|Gothic|Hiragino|ゴシック/i.test(f)), "日本語の字体が無い").toBe(true);
    });

    // 今日 `globals.css` に足したのと同じもの。あちらの CSS は届かないので、
    // このページは自分で持つ必要がある（実際に持っている）
    it("暗い配色を宣言している", () => {
        const html = read("public/offline.html").replace(/<!--[\s\S]*?-->/g, "");
        expect(/color-scheme:\s*dark/.test(html), "color-scheme: dark が無い（UA の部品が明色のまま）").toBe(true);
    });
});
