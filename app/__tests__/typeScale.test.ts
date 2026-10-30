import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * **字の段と角の丸みは iOS と同じ値**（2026-10-30・束 0a・比較の板 C1・C13）。
 *
 * 以前は電話の幅で `html { font-size: 14px }` にしていて、rem で書いた字・余白・角が全部 0.875 倍
 * （本文 14・注記 10.5・角 10.5）になっていた。根の字は 16 のまま触らず、Tailwind の段の名前を
 * iOS の役（`JPTypeScale`・`JPRadius`）に置き換えた（`globals.css` の `@theme`）。
 */
const ROOT = process.cwd();
const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

function themeVar(name: string): string | undefined {
    return new RegExp(`--${name}:\\s*([^;]+);`).exec(code)?.[1].trim();
}

describe("根の字の大きさ", () => {
    it("html・body の字の大きさを書き換えない（rem が縮む）", () => {
        expect(code).not.toMatch(/(^|[\s,}])(html|body)\s*(,[^{]*)?\{[^}]*font-size/);
    });
});

describe("字の段（iOS の JPTypeScale）", () => {
    // [Tailwind の段, iOS の役, 大きさ px]
    const SCALE: Array<[string, string, number]> = [
        ["xs", "caption（本文系の最小）", 12],
        ["sm", "footnote（副文・文字ボタン）", 13],
        ["base", "body（本文）", 15],
        ["lg", "headline", 17],
        ["xl", "stateTitle", 20],
        ["2xl", "title2", 22],
        ["3xl", "title1", 26],
        ["4xl", "display", 32],
    ];
    it.each(SCALE)("text-%s は %s の %ipx", (step, _role, px) => {
        expect(themeVar(`text-${step}`)).toBe(`${px}px`);
        const lh = themeVar(`text-${step}--line-height`);
        expect(lh, "行の高さも px で持つ").toMatch(/^\d+px$/);
        expect(parseInt(lh!, 10)).toBeGreaterThanOrEqual(px);
    });

    it("入力欄はタッチ端末で 16px のまま（Safari の拡大を避ける）", () => {
        expect(code).toMatch(/@media \(hover: none\) and \(pointer: coarse\)\s*\{[\s\S]*?font-size:\s*16px\s*!important/);
    });
});

describe("角の丸み（iOS の JPRadius: 6・10・12・14・16・24）", () => {
    const RADIUS: Array<[string, number]> = [
        ["md", 6], ["xs", 6], ["lg", 10], ["field", 12], ["xl", 14], ["2xl", 16], ["3xl", 24],
    ];
    it.each(RADIUS)("rounded-%s は %ipx", (step, px) => {
        expect(themeVar(`radius-${step}`)).toBe(`${px}px`);
    });

    function walk(dir: string, out: string[] = []): string[] {
        for (const name of readdirSync(dir)) {
            if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
            const p = join(dir, name);
            if (statSync(p).isDirectory()) walk(p, out);
            else if (/\.(tsx|ts)$/.test(name) && !/\.test\./.test(name)) out.push(p);
        }
        return out;
    }

    it("iOS の段と同じ値を角の書き込み（rounded-[Npx]）で書かない——段の名前を使う", () => {
        const bad: string[] = [];
        for (const abs of [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))]) {
            const rel = relative(ROOT, abs).split("\\").join("/");
            readFileSync(abs, "utf8").split("\n").forEach((line, i) => {
                const m = /rounded(-[a-z]+)?-\[(6|10|12|14|16|24)px\]/.exec(line);
                if (m) bad.push(`${rel}:${i + 1} ${m[0]}`);
            });
        }
        expect(bad).toEqual([]);
    });

    it("角に rem の端数を書かない", () => {
        const bad: string[] = [];
        for (const abs of [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))]) {
            const rel = relative(ROOT, abs).split("\\").join("/");
            readFileSync(abs, "utf8").split("\n").forEach((line, i) => {
                if (/rounded(-[a-z]+)?-\[[0-9.]+rem\]|borderRadius:\s*"[0-9.]+rem"/.test(line)) bad.push(`${rel}:${i + 1}`);
            });
        }
        expect(bad).toEqual([]);
    });
});
