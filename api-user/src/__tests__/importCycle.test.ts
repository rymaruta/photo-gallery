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

function graph(): Record<string, string[]> {
    const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".ts"));
    const g: Record<string, string[]> = {};
    for (const f of files) {
        const src = fs.readFileSync(path.join(SRC, f), "utf8");
        // `import ... from "./x"` と `export ... from "./x"` の両方
        const deps = [...src.matchAll(/\bfrom\s+"\.\/([A-Za-z0-9_-]+)"/g)]
            .map((m) => `${m[1]}.ts`)
            .filter((d) => files.includes(d));
        g[f] = [...new Set(deps)];
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
    });
});
