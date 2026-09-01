import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// DEP-2: `@aws-sdk/util-dynamodb` がどの package.json にも書かれていないのに
// 3つの木（root / api / api-user）から import されていた。動いていたのは
// `@aws-sdk/lib-dynamodb` の推移依存として node_modules に居たからで、
// **巻き上げが変わると CI だけが先に壊れる**（手元の node_modules は残るので
// 気づけない）。宣言していない依存に寄りかかるのをここで止める。
//
// 見るのは `@aws-sdk/*` と `@aws/*` だけ——他は数が多いうえ、Next や
// vitest の推移依存を1つずつ宣言して回る話ではない。AWS SDK は
// Lambda のバンドルに直結する（esbuild が `@aws-sdk/*` を exclude する）ので、
// ここだけは宣言が要る。
const ROOT = join(__dirname, "..", "..");

// `api/src/__tests__` と `api-user/src/__tests__` は**ルートの vitest が走らせる**
// ので、解決先はルートの node_modules。Lambda のバンドルにも入らない。
// だから宣言の持ち主はルート側で、api/api-user の走査からは外す。
const trees = [
    { name: "root", pkg: "package.json", dirs: ["lib", "app", "scripts", "api/src/__tests__", "api-user/src/__tests__"] },
    { name: "api", pkg: "api/package.json", dirs: ["api/src"], skipTests: true },
    { name: "api-user", pkg: "api-user/package.json", dirs: ["api-user/src"], skipTests: true },
];

// 意図して宣言していないもの。**理由が要る。**
// `client-wafv2` は `scripts/diagnose-cdn.js` が try/catch で包んで読み、
// 無ければその節だけ飛ばす（ワークフローが `--no-save` で入れる想定）。
// 常時の依存にすると、WAF を見ない全員のインストールが重くなる。
const OPTIONAL = new Set(["@aws-sdk/client-wafv2"]);

function walk(dir: string, skipTests: boolean, out: string[] = []): string[] {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return out; }
    for (const e of entries) {
        if (e === "node_modules" || e === ".next") continue;
        if (skipTests && e === "__tests__") continue;
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p, skipTests, out);
        else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e)) out.push(p);
    }
    return out;
}

describe.each(trees)("$name: 使っている AWS SDK は package.json に書いてある", ({ pkg, dirs, skipTests }) => {
    const json = JSON.parse(readFileSync(join(ROOT, pkg), "utf8")) as {
        dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
    };
    const declared = new Set([...Object.keys(json.dependencies ?? {}), ...Object.keys(json.devDependencies ?? {})]);

    const used = new Map<string, string>(); // パッケージ名 → 最初に見つけたファイル
    for (const d of dirs) {
        for (const file of walk(join(ROOT, d), skipTests === true)) {
            const src = readFileSync(file, "utf8");
            for (const m of src.matchAll(/["'](@aws(?:-sdk)?\/[a-z0-9-]+)["']/g)) {
                if (!used.has(m[1])) used.set(m[1], file.slice(ROOT.length + 1));
            }
        }
    }

    it("走査が空振りしていない", () => {
        expect(used.size).toBeGreaterThan(0);
    });

    it("宣言されていない AWS SDK を import していない", () => {
        const missing = [...used].filter(([name]) => !declared.has(name) && !OPTIONAL.has(name)).map(([n, f]) => `${n}（${f}）`);
        expect(missing).toEqual([]);
    });
});
