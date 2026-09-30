import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 🔴 **公式スポットの台帳（`content/spots.json`）を、画面から読ませない。**
 *
 * `lib/data/spots.ts` は `import spotsJson from "@/content/spots.json"` で
 * **丸ごと**読む。`"use client"` のファイルがそこから `SPOTS` を値として
 * import すると、**台帳の全文がそのページのチャンクに載る**。
 *
 * 台帳に1件だけ入れてビルドして数えた（2026-09-23）:
 *
 *     クライアントのチャンクに載っていた台帳の中身
 *       49896f429396482b.js  → out/saved-spots.html
 *       59b11b77059e2248.js  → out/photo/*.html      ← **写真ページ30枚すべて**
 *
 * 写真ページは検索の着地点で、CLAUDE.md の優先度（表示速度）に直接当たる。
 * **JSON のモジュールは項目単位で落とせない**（台帳 `3ed31141` が
 * `photos.json` で同じ形を踏んで `photo-index.json` を作った）ので、
 * 減らす手は「クライアントから import しない」1つだけ。
 *
 * 正しい経路: サーバー側（`page.tsx`）で `lib/data/spotLink.ts` を通して
 * 解き、`SpotLink` を props で渡す。
 *
 * **型だけの import（`import type { Spot }`）は通す**——型は消えるので
 * チャンクに何も載らない。
 */

const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["app", "lib"];

/** 台帳を読む経路（値として import すると JSON が付いてくるファイル） */
const LEDGER_MODULES = [
    "lib/data/spots", "lib/data/spotLink", "lib/data/spotFeed", "lib/data/spotBody", "lib/data/spotSearchFeed", "lib/data/quizFeed",
    "@/lib/data/spots", "@/lib/data/spotLink", "@/lib/data/spotFeed", "@/lib/data/spotBody", "@/lib/data/spotSearchFeed", "@/lib/data/quizFeed",
];

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next") continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(name) && !full.includes("__tests__")) out.push(full);
    }
    return out;
}

/** `"use client"` を宣言しているか（先頭の数行に出る） */
function isClientFile(src: string): boolean {
    return /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*|\n)*["']use client["']/.test(src);
}

/**
 * 台帳を**値として** import している行。
 *
 * `import type { … }` と `import { type X }` は除く（型は消える）。
 */
function ledgerValueImports(src: string): string[] {
    const hits: string[] = [];
    // コメントを先に落とす——このファイル自身の説明文に一致させない
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const re = /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
        const [, clause, mod] = m;
        if (!LEDGER_MODULES.some((x) => mod === x || mod.endsWith("/data/spots") || mod.endsWith("/data/spotLink") || mod.endsWith("/data/spotFeed") || mod.endsWith("/data/spotBody") || mod.endsWith("/data/spotSearchFeed") || mod.endsWith("/data/quizFeed"))) continue;
        const bare = clause.trim();
        if (bare.startsWith("type ")) continue;                 // import type { Spot } from …
        const inner = bare.replace(/^\{|\}$/g, "");
        // 全部の指定子が `type X` なら値は付いてこない
        const specs = inner.split(",").map((x) => x.trim()).filter(Boolean);
        if (specs.length > 0 && specs.every((x) => x.startsWith("type "))) continue;
        hits.push(`${mod} → ${bare.replace(/\s+/g, " ")}`);
    }
    return hits;
}

describe("台帳をクライアントに載せない", () => {
    const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));

    it("走査するファイルが十分にある（空回りしていない）", () => {
        expect(files.length).toBeGreaterThan(200);
    });

    it("`use client` のファイルは、台帳を値として import しない", () => {
        const bad: string[] = [];
        for (const f of files) {
            const src = readFileSync(f, "utf-8");
            if (!isClientFile(src)) continue;
            for (const hit of ledgerValueImports(src)) {
                bad.push(`${f.slice(ROOT.length + 1)}: ${hit}`);
            }
        }
        expect(bad, `台帳の全文がこのページのチャンクに載る:\n${bad.join("\n")}`).toEqual([]);
    });

    /// **検出器の自己確認。** 判定が本当に効くこと（空配列を返すだけの
    /// 壊れた検出器と区別が付くこと）を、その場で作った入力で見る
    it("検出器そのものが効く", () => {
        const client = `"use client";\nimport { SPOTS } from "@/lib/data/spots";\n`;
        expect(isClientFile(client)).toBe(true);
        expect(ledgerValueImports(client)).toHaveLength(1);

        // 型だけなら通す
        const typeOnly = `"use client";\nimport type { Spot } from "@/lib/data/spots";\n`;
        expect(ledgerValueImports(typeOnly)).toEqual([]);
        const inlineType = `"use client";\nimport { type Spot } from "@/lib/data/spots";\n`;
        expect(ledgerValueImports(inlineType)).toEqual([]);

        // サーバー側なら通す
        const server = `import { SPOTS } from "@/lib/data/spots";\n`;
        expect(isClientFile(server)).toBe(false);

        // 先頭にコメントがあっても `use client` を見落とさない
        const commented = `// めも\n"use client";\nimport { SPOTS } from "@/lib/data/spots";\n`;
        expect(isClientFile(commented)).toBe(true);

        // 解いたあとの型を受け取るのは通す
        const ok = `"use client";\nimport type { SpotLink } from "@/lib/data/spotLink";\n`;
        expect(ledgerValueImports(ok)).toEqual([]);
    });
});
