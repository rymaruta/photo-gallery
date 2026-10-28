import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, waitFor } from "@testing-library/react";

/**
 * 🔴 **Web フォントの CSS を、最初の描画を止める場所で読まない**（2026-10-28）。
 *
 * next/font の CSS は日本語の `unicode-range` で割った `@font-face` が数百個あり、
 * 本番のトップで gzip 32KB × 3書体。ルートのレイアウトが直に import していた間は、
 * これが**全ページの `<head>` で描画を止めるスタイルシート**だった
 * （PageSpeed Insights・スマホ: FCP 5.8秒・描画を止めるリクエストで 3,450ms）。
 * いまは `WebFontLoader` が水和のあとで `import()` する。
 *
 * ここで縛るのは:
 *   - next/font を**静的に** import するファイルが `app/fonts/` の2つだけ
 *     （どこかが静的に読むと、その CSS がまた描画を止める側に戻る）
 *   - その2つを静的に import する所が無い（`import()` だけ）
 *   - 手書き2種（`storyFonts.ts`）はストーリーの文字を描く所だけが読む
 *   - `globals.css` の `:root` の既定値が next/font の字の名前と一致している
 *     （ずれると、届くまでの間に見出しが本文の字に落ちる）
 *   - 読み終えたら next/font の変数のクラスを `<body>` に付ける
 */
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function walk(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(join(ROOT, dir))) {
        if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
        const rel = `${dir}/${name}`;
        if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, acc);
        else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name)) acc.push(rel);
    }
    return acc;
}
const SOURCES = [...walk("app"), ...walk("lib")];

describe("Web フォントは描画を止めない", () => {
    it("next/font を静的に import するのは app/fonts/ の2つだけ", () => {
        const users = SOURCES.filter((f) => /from\s+["']next\/font\//.test(read(f))).sort();
        expect(users).toEqual(["app/fonts/storyFonts.ts", "app/fonts/webFonts.ts"]);
    });

    it("app/fonts/* を静的に import している所が無い（import() だけ）", () => {
        const statics = SOURCES.filter((f) => /(^|\n)\s*import[^;()]*from\s+["'][^"']*fonts\/(webFonts|storyFonts)["']/.test(read(f)));
        expect(statics).toEqual([]);
        const loader = read("app/components/WebFontLoader.tsx");
        expect(loader).toMatch(/import\(\s*["']\.\.\/fonts\/webFonts["']\s*\)/);
        expect(loader).toMatch(/import\(\s*["']\.\.\/fonts\/storyFonts["']\s*\)/);
    });

    it("手書き2種はストーリーの文字を描く所だけが読む（全ページの WebFontLoader は明朝だけ）", () => {
        const loader = read("app/components/WebFontLoader.tsx");
        const main = /export default function WebFontLoader\(\)[\s\S]*?\n\}/.exec(loader)?.[0] ?? "";
        expect(main).toContain("webFonts");
        expect(main).not.toContain("storyFonts");
        const callers = SOURCES.filter((f) => /\buseStoryFonts\(\)|<StoryFontsLoader\s*\/>/.test(read(f)) && !f.endsWith("WebFontLoader.tsx")).sort();
        expect(callers).toEqual(["app/components/stories/StoriesBar.tsx", "app/components/stories/StoryTextOverlay.tsx"]);
        // 作る画面では**字体の欄を開いたときだけ**（画面を開いただけでは読まない）
        const bar = read("app/components/stories/StoriesBar.tsx");
        expect(bar).not.toMatch(/\buseStoryFonts\(\)/);
        expect(bar).toMatch(/\{tool === "font" && \([\s\S]{0,400}<StoryFontsLoader \/>/);
    });

    it("ルートのレイアウトが WebFontLoader を置いている", () => {
        const layout = read("app/layout.tsx");
        expect(layout).toMatch(/import WebFontLoader from "\.\/components\/WebFontLoader"/);
        expect(layout).toContain("<WebFontLoader />");
    });

    it("globals.css の :root の既定値は、next/font が読む字の名前と一致する", () => {
        const css = read("app/globals.css");
        const root = /:root\s*\{([^}]*--font-mincho[^}]*)\}/.exec(css)?.[1] ?? "";
        expect(root, ":root に Web フォントの既定値が無い").not.toBe("");
        const pairs = [
            { fn: "Shippori_Mincho_B1", varName: "--font-mincho", file: "app/fonts/webFonts.ts" },
            { fn: "Yusei_Magic", varName: "--font-marker", file: "app/fonts/storyFonts.ts" },
            { fn: "Yomogi", varName: "--font-scribble", file: "app/fonts/storyFonts.ts" },
        ];
        for (const { fn, varName, file } of pairs) {
            const fonts = read(file);
            // next/font が名乗る名前は関数名の `_` を空白にしたもの（本番の CSS: `font-family:Shippori Mincho B1`）
            const family = fn.replace(/_/g, " ");
            expect(fonts, `${fn} の変数名が違う`).toMatch(new RegExp(`${fn}\\(\\{[\\s\\S]*?variable: "${varName}"`));
            const value = new RegExp(`${varName}:\\s*([^;]+);`).exec(root)?.[1] ?? "";
            expect(value, `${varName} の既定値`).toBe(`"${family}", "${family} Fallback"`);
        }
    });
});

describe("WebFontLoader", () => {
    afterEach(() => {
        document.body.className = "";
        vi.doUnmock("../fonts/webFonts");
        vi.doUnmock("../fonts/storyFonts");
        vi.resetModules();
    });

    it("読み終えたら明朝の変数のクラスを <body> に付ける（手書き2種は読まない）", async () => {
        const story = vi.fn(() => ({ marker: { variable: "v-marker" }, scribble: { variable: "v-scribble" } }));
        vi.doMock("../fonts/webFonts", () => ({ mincho: { variable: "v-mincho" } }));
        vi.doMock("../fonts/storyFonts", story);
        const { default: WebFontLoader } = await import("../components/WebFontLoader");
        render(<WebFontLoader />);
        await waitFor(() => expect(document.body.classList.contains("v-mincho")).toBe(true));
        expect(story).not.toHaveBeenCalled();
        expect(document.body.classList.contains("v-marker")).toBe(false);
    });

    it("useStoryFonts は手書き2種のクラスを付ける", async () => {
        vi.doMock("../fonts/storyFonts", () => ({ marker: { variable: "v-marker" }, scribble: { variable: "v-scribble" } }));
        const { useStoryFonts } = await import("../components/WebFontLoader");
        const Probe = () => { useStoryFonts(); return null; };
        render(<><Probe /><Probe /></>);
        await waitFor(() => expect(document.body.classList.contains("v-scribble")).toBe(true));
        expect(document.body.classList.contains("v-marker")).toBe(true);
    });

    // vi.doMock の控えは import() を何度しても1回しか工場を呼ばないので、工場の回数では
    // 「1回だけ読む」を確かめられない。同じ約束（Promise）が返ることと、クラスを付けた回数で見る
    it("何度呼んでも読むのは1回（同じ Promise・<body> にクラスを付けるのも1回）", async () => {
        vi.doMock("../fonts/storyFonts", () => ({ marker: { variable: "v-marker" }, scribble: { variable: "v-scribble" } }));
        const { loadStoryFonts } = await import("../components/WebFontLoader");
        const add = vi.spyOn(document.body.classList, "add");
        try {
            const a = loadStoryFonts();
            const b = loadStoryFonts();
            expect(b).toBe(a);
            await Promise.all([a, b, loadStoryFonts()]);
            expect(add).toHaveBeenCalledTimes(2); // marker と scribble で1回ずつ
        } finally {
            add.mockRestore();
        }
    });
});
