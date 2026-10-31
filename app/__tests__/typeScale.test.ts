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

/**
 * **入力欄の角は全部 `rounded-field`（12・iOS の `JPRadius.field`）**（2026-10-30・束 0a の確かめ）。
 * 段を 8→10・12→14 に置き換えたとき、`rounded-lg`／`rounded-xl` のまま残った欄が画面ごとに 10 と 14 に割れた
 * （ログイン・退会・通報・アルバム・親しい友達・写真の詳細・投稿の位置情報）。
 * 欄そのもの（input・textarea・select の開きタグ）と、欄の class の定数（`inputCls` など）を見る。
 * 丸い検索欄（`rounded-full`）と `rounded-[Npx]` の欄は C6（入力欄の形）で別に扱うので、ここでは段の名前だけを縛る
 */
describe("入力欄の角", () => {
    const STEP = /\brounded(-[trbl]{1,2})?-(sm|md|lg|xl|2xl|3xl)\b/;
    const SKIP_TYPES = /type="(checkbox|radio|range|file|color|hidden)"/;

    function files(): Array<[string, string]> {
        const out: Array<[string, string]> = [];
        const walk = (dir: string) => {
            for (const name of readdirSync(dir)) {
                if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
                const p = join(dir, name);
                if (statSync(p).isDirectory()) walk(p);
                else if (/\.tsx$/.test(name)) out.push([relative(ROOT, p).split("\\").join("/"), readFileSync(p, "utf8")]);
            }
        };
        walk(join(ROOT, "app"));
        return out;
    }

    it("input・textarea・select の開きタグに段の名前の角（rounded-lg など）を書かない", () => {
        const bad: string[] = [];
        let seen = 0;
        for (const [rel, src] of files()) {
            for (const m of src.matchAll(/<(input|textarea|select)\b/g)) {
                const rest = src.slice(m.index!, m.index! + 2500);
                const close = rest.search(m[1] === "input" ? /\/>/ : /\n\s*>|\/>|>\s*\n/);
                const tag = rest.slice(0, close > 0 ? close : 400);
                if (SKIP_TYPES.test(tag)) continue;
                seen++;
                const hit = STEP.exec(tag);
                if (hit) bad.push(`${rel}:${src.slice(0, m.index).split("\n").length} ${hit[0]}`);
            }
        }
        expect(seen, "前提: 欄を読めていない").toBeGreaterThan(40);
        expect(bad).toEqual([]);
    });

    it("欄の class の定数（inputCls・inputClass・fieldCls）は rounded-field", () => {
        const bad: string[] = [];
        let seen = 0;
        for (const [rel, src] of files()) {
            for (const m of src.matchAll(/(?:const|let)\s+(inputCls|inputClass|fieldCls)\s*=\s*["`]([^"`]*)["`]/g)) {
                seen++;
                if (!/\brounded-field\b/.test(m[2])) bad.push(`${rel} ${m[1]}`);
            }
        }
        expect(seen).toBeGreaterThan(5);
        expect(bad).toEqual([]);
    });

    it("欄を包む枠（投稿の位置情報）と、欄の前の「@」も同じ角", () => {
        expect(readFileSync(join(ROOT, "app/user/upload/page.tsx"), "utf8"))
            .toMatch(/<div className="flex items-center gap-2 rounded-field bg-surface-2 border border-line px-3 focus-within:/);
        expect(readFileSync(join(ROOT, "app/user/profile/page.tsx"), "utf8")).toContain("rounded-l-field\">@</span>");
    });
});

describe("根の字 14px を外したあとの残り（束 0a の確かめ）", () => {
    it("写真の詳細の失敗の見出しは iOS の stateTitle（明朝 20）", () => {
        const src = readFileSync(join(ROOT, "app/photo/[id]/PhotoPageClient.tsx"), "utf8");
        // 読み込めなかった方は共通の失敗の形（`ErrorState`・明朝 20・2026-10-30 束 0b C17）、無い方は h1 のまま
        expect(src.match(/<h1 className="font-serif text-xl font-bold mb-4">/g)?.length).toBe(1);
        expect(src).toMatch(/<ErrorState[\s\S]{0,120}headingLevel=\{1\}/);
        expect(src).not.toMatch(/<h1 className="text-3xl font-bold mb-4">/);
    });

    it("グリッドの sizes に root 14px 前提の値（15.75px・19.25px・532px）が残っていない", () => {
        const src = readFileSync(join(ROOT, "app/components/gridSizes.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
        expect(src).not.toMatch(/15\.75px|19\.25px|532px|264px|531px/);
    });

    it("注記が「640px 未満は root が 14px」を今の話として書いていない", () => {
        const bad: string[] = [];
        const walk = (dir: string) => {
            for (const name of readdirSync(dir)) {
                if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
                const p = join(dir, name);
                if (statSync(p).isDirectory()) walk(p);
                else if (/\.tsx?$/.test(name)) {
                    readFileSync(p, "utf8").split("\n").forEach((line, i) => {
                        if (/root[^\n]{0,12}14px|14px[^\n]{0,6}root/.test(line) && !/以前|当時|外した|束 0a/.test(line)) {
                            bad.push(`${relative(ROOT, p)}:${i + 1}`);
                        }
                    });
                }
            }
        };
        walk(join(ROOT, "app"));
        walk(join(ROOT, "lib"));
        expect(bad).toEqual([]);
    });
});

