import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * **本文系の字は 12px 以上**（2026-10-15・iOS v2 の `WebTheme.minBodyText`・板 02 字の段）。
 * 11px は眉ラベル（大文字・字間を空けた短い見出し）だけ。10px はどこにも使わない。
 *
 * 眉ラベルは**同じ行（style だけの行なら上2行）に字間の指定がある**ことで見分ける
 * （`uppercase`・`tracking-*`・`letterSpacing`）。眉ラベルの部品化は別の束（B）。
 *
 * 免除:
 *   - 下のタブの名前（`BottomNav`・10px）: 5つを 320px の幅に並べるので 12px では
 *     「マイページ」が収まらない。iOS も系統のタブバーの 10pt
 *
 * 写真ページ・人のページも見る（2026-10-15 に束 C・D を合わせたので免除を外した）
 */
const ROOT = process.cwd();
const EXEMPT_FILES = new Set<string>([]);
const EXEMPT_DIRS: string[] = [];
const EXEMPT_LINES: Array<[string, string]> = [
    ["app/components/BottomNav.tsx", 'fontSize: "10px"'],
];

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(tsx|ts)$/.test(name) && !/\.test\./.test(name)) out.push(p);
    }
    return out;
}

const SMALL = /text-\[1[01]px\]|fontSize: "1[01]px"/;
const EYEBROW = /uppercase|tracking-|letterSpacing/;

describe("本文系の字は 12px 以上（11px は眉ラベルだけ）", () => {
    it("10px・眉ラベル以外の 11px が無い", () => {
        const bad: string[] = [];
        for (const abs of [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))]) {
            const rel = relative(ROOT, abs).split("\\").join("/");
            if (EXEMPT_FILES.has(rel) || EXEMPT_DIRS.some((d) => rel.startsWith(d))) continue;
            const lines = readFileSync(abs, "utf8").split("\n");
            lines.forEach((line, i) => {
                if (!SMALL.test(line) || /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line)) return;
                if (EXEMPT_LINES.some(([f, s]) => f === rel && line.includes(s))) return;
                const is10 = /text-\[10px\]|fontSize: "10px"/.test(line);
                const ctx = /className/.test(line) ? line : lines.slice(Math.max(0, i - 2), i + 1).join("\n");
                if (is10 || !EYEBROW.test(ctx)) bad.push(`${rel}:${i + 1} ${line.trim().slice(0, 90)}`);
            });
        }
        expect(bad).toEqual([]);
    });

    it("免除の行が実在する（古くなった免除を残さない）", () => {
        for (const [f, s] of EXEMPT_LINES) expect(readFileSync(join(ROOT, f), "utf8")).toContain(s);
    });
});
