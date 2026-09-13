import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * **api-user のモジュールに循環 import を作らない。**
 *
 * `block.ts` は関係を切るために `follow.ts` の `unfollowQuietly` を呼ぶ。
 * だから `follow.ts` から `block.ts` を import すると輪になる——そのために
 * 読み取りだけを `blockCheck.ts` へ切り出してあり、**両方のファイルの
 * 冒頭コメントがその理由を書いている**。
 *
 * それでも一度作った。フォロー一覧にブロックのふるいを入れたとき、
 * 「ストーリー・通知・返信が `block.ts` から `hiddenUserIds` を import して
 * いる」という形だけを借りて、**その形が成立している前提（あちらには
 * `block.ts` へ戻る辺が無い）を読まなかった**。
 *
 * 輪は**動くことがある**（関数宣言は巻き上げられ、呼ぶのはリクエスト時なので
 * 遅延参照になる）ので、テストもデプロイも通ってしまう。壊れるのは、次に誰かが
 * トップレベルで何かを評価した日。**人のコメントではなく機械で止める。**
 *
 * ついでに全モジュールを見る（`block` 以外にも同じことは起きうる）。
 */
const SRC = path.join(__dirname, "..");

/**
 * コメントを落としてから走査する。**コメントの中にモジュール名を書くだけで
 * 偽の辺ができる**——このリポジトリは doc コメントで隣のファイルを頻繁に
 * 名指しする（この節も `block.ts` と書いている）ので、実際に踏みやすい。
 * 文字列リテラルの中の `//` を消さないよう、行コメントは
 * 「引用符に挟まれていない `//`」だけを落とす。
 */
export function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((line) => {
            let quote: string | null = null;
            for (let i = 0; i < line.length; i++) {
                const c = line[i];
                if (quote) {
                    if (c === "\\") i++;
                    else if (c === quote) quote = null;
                } else if (c === '"' || c === "'" || c === "`") {
                    quote = c;
                } else if (c === "/" && line[i + 1] === "/") {
                    return line.slice(0, i);
                }
            }
            return line;
        })
        .join("\n");
}

/**
 * 1ファイルが実行時に読むモジュール。
 *
 *   - `import ... from "./x"` / `export ... from "./x"`
 *   - **`await import("./x")` も数える**（`rebuild.ts:45` に実在する。
 *     `from` を伴わないので、素朴な走査では取りこぼす）
 *   - **`import type` は数えない**（コンパイルで消えるので実行時の輪に
 *     ならない。数えると「型だけの輪」で意味のない書き換えを強いる）
 */
export function depsOf(src: string): string[] {
    const body = stripComments(src);
    const out: string[] = [];
    for (const m of body.matchAll(/(^|\n)\s*import\s+type\b[^\n]*?from\s+"\.\/([A-Za-z0-9_-]+)"/g)) {
        out.push(`!type:${m[2]}`);
    }
    const typeOnly = new Set(out.map((x) => x.slice(6)));
    const deps: string[] = [];
    for (const m of body.matchAll(/\bfrom\s+"\.\/([A-Za-z0-9_-]+)"/g)) deps.push(m[1]);
    for (const m of body.matchAll(/\bimport\s*\(\s*"\.\/([A-Za-z0-9_-]+)"\s*\)/g)) deps.push(m[1]);
    // 副作用だけの `import "./x";`。いまリポジトリに無い書き方だが、
    // **無い書き方こそ走査の穴になる**（足すのは1行）
    for (const m of body.matchAll(/(^|\n)\s*import\s+"\.\/([A-Za-z0-9_-]+)"\s*;/g)) deps.push(m[2]);
    // 同じモジュールを型でも値でも読んでいるなら、値の側が勝つ
    const valueDeps = deps.filter((d) => {
        if (!typeOnly.has(d)) return true;
        // `import type { X } from "./d"` しか無いなら落とす
        const re = new RegExp(`(^|\\n)\\s*import\\s+(?!type\\b)[^\\n]*?from\\s+"\\./${d}"`);
        const dyn = new RegExp(`\\bimport\\s*\\(\\s*"\\./${d}"\\s*\\)`);
        return re.test(body) || dyn.test(body);
    });
    return [...new Set(valueDeps)];
}

function graph(): Record<string, string[]> {
    const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".ts"));
    const g: Record<string, string[]> = {};
    for (const f of files) {
        const src = fs.readFileSync(path.join(SRC, f), "utf8");
        g[f] = depsOf(src).map((d) => `${d}.ts`).filter((d) => files.includes(d));
    }
    return g;
}

function cycles(g: Record<string, string[]>): string[] {
    const found: string[] = [];
    const done = new Set<string>();
    const walk = (node: string, stack: string[]) => {
        const at = stack.indexOf(node);
        if (at >= 0) {
            found.push([...stack.slice(at), node].join(" → "));
            return;
        }
        if (done.has(node)) return;
        stack.push(node);
        for (const d of g[node] ?? []) walk(d, stack);
        stack.pop();
        done.add(node);
    };
    for (const f of Object.keys(g)) walk(f, []);
    return [...new Set(found)];
}

describe("api-user の import に輪を作らない", () => {
    it("循環 import が1つも無い", () => {
        expect(cycles(graph()), "循環 import ができている").toEqual([]);
    });

    // **走査そのものが効いていることを確かめる**（この手のテストは
    // 「見つけられない書き方」に静かに退化する。台帳に前例が3回ある）
    it("輪があれば見つけられる", () => {
        const fake = { "a.ts": ["b.ts"], "b.ts": ["c.ts"], "c.ts": ["a.ts"], "d.ts": ["a.ts"] };
        expect(cycles(fake)).toEqual(["a.ts → b.ts → c.ts → a.ts"]);
    });

    it("自分自身への import も輪として見つける", () => {
        expect(cycles({ "a.ts": ["a.ts"] })).toEqual(["a.ts → a.ts"]);
    });

    // **実在の辺を読めていることを確かめる**（正規表現が何にも当たらなく
    // なっても「循環なし」で緑になる）
    it("実際の依存を読めている（空のグラフで通していない）", () => {
        const g = graph();
        expect(Object.keys(g).length, "ファイルを1つも読めていない").toBeGreaterThan(20);
        expect(g["block.ts"], "block.ts → follow.ts の辺を読めていない").toContain("follow.ts");
        expect(g["follow.ts"], "follow.ts → blockCheck.ts の辺を読めていない").toContain("blockCheck.ts");
        // この辺があると輪になる。いま無いことが、上の判定が守っているもの
        expect(g["follow.ts"], "follow.ts から block.ts を import している").not.toContain("block.ts");
        // **動的 import も辺として読む**（`rebuild.ts` に実在する書き方）
        expect(g["rebuild.ts"], "await import(\"./dynamodb\") を読めていない").toContain("dynamodb.ts");
    });

    // `from` を伴わない `await import()` は素朴な走査では落ちる。
    // **落ちると輪があっても「循環なし」で緑**になる
    it("動的 import も辺として数える", () => {
        expect(depsOf('const { x } = await import("./dynamodb");')).toEqual(["dynamodb"]);
        expect(depsOf('import { a } from "./one";\nconst b = await import("./two");')).toEqual(["one", "two"]);
    });

    it("副作用だけの import も辺として数える", () => {
        expect(depsOf('import "./side";')).toEqual(["side"]);
    });

    // **型だけの import は実行時に消える**ので辺にしない。数えると
    // 「型だけの輪」で意味のない書き換えを強いられる
    it("import type は辺として数えない", () => {
        expect(depsOf('import type { Photo } from "./types";')).toEqual([]);
        // 同じモジュールを値でも読んでいるなら数える
        expect(depsOf('import type { Photo } from "./types";\nimport { f } from "./types";')).toEqual(["types"]);
    });

    // **コメントに書いたモジュール名で偽の辺を作らない。**
    // このリポジトリは doc コメントで隣のファイルを頻繁に名指しする
    it("コメントの中の import は数えない", () => {
        expect(depsOf('// import { x } from "./ghost";\nimport { y } from "./real";')).toEqual(["real"]);
        expect(depsOf('/* from "./ghost" */\nimport { y } from "./real";')).toEqual(["real"]);
        // 文字列の中の `//`（URL など）でコードを切り落とさない
        expect(depsOf('const u = "https://x/y"; import { y } from "./real";')).toEqual(["real"]);
    });
});
