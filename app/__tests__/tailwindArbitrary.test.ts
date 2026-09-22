import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * **Tailwind の「任意の値」に、中身を省いた形を書かない。**
 *
 * Tailwind はソースを**文字列として**走査してクラスの候補を拾う——
 * JSX でもコメントでも、**テストファイルでも**区別しない。だから
 * 「`pb-` の任意の値に `env()` を書く」という話をコメントでするときに
 * 中身を三点リーダで省くと、**その省略形がそのままクラスとして生成され**、
 * 出力に `padding-bottom: calc(env(...) + 0.75rem)` という**構文として
 * 壊れた宣言**が入る。
 *
 * ⚠️ **この doc にも、省略した形のクラス名を書かないこと。**
 * 一度ここに例として書いて、**この見張り自身が同じ壊れた CSS を
 * 生やした**（テストは緑のまま `next dev` が 500 のまま直らず、
 * 原因がこのファイルだと分かるまで遠回りした）。例が要るときは、
 * 下の自己確認のように**文字列を分けて**書く。
 *
 * 出方が環境で割れるのが厄介なところ:
 *   - `next build`（lightningcss）… 警告を出して**その規則だけ捨てる**ので緑
 *   - `next dev`（turbopack）      … 解析に失敗し、**全ページが 500**
 *
 * つまり CI もビルドも通るのに、**手元で開発ができない**。実際に
 * `app/user/edit/page.tsx` のコメント1行でその状態になっていた
 * （トップページが 500。`npm run verify` は9関門とも緑のまま）。
 *
 * 省略したいときは、値を省かずそのまま書くか、クラス名の形にしない。
 */

const ROOTS = ["app", "lib", "scripts"];
/** 走査するのは Tailwind が読む拡張子だけ */
const EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mdx", ".css"]);
/** クラスの候補（`接頭辞-` のあとに角かっこで値を書く形）で、値に三点リーダが入っているもの */
const ELLIPSIS_ARBITRARY = /[\w-]+-\[[^\]\s]*\.{3}[^\]\s]*\]/g;

function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (EXT.has(path.extname(e.name))) out.push(p);
    }
    return out;
}

const repoRoot = path.join(__dirname, "..", "..");

describe("Tailwind の任意の値", () => {
    it("中身を省いた形（`...`）をクラスの候補として書いていない", () => {
        const hits: string[] = [];
        for (const root of ROOTS) {
            const dir = path.join(repoRoot, root);
            if (!fs.existsSync(dir)) continue;
            for (const file of walk(dir)) {
                // このテスト自身は例（上の doc と下の自己確認）を持つので飛ばす
                if (file === __filename) continue;
                const src = fs.readFileSync(file, "utf8");
                src.split("\n").forEach((line, i) => {
                    for (const m of line.match(ELLIPSIS_ARBITRARY) ?? []) {
                        hits.push(`${path.relative(repoRoot, file)}:${i + 1}  ${m}`);
                    }
                });
            }
        }
        expect(hits, "壊れた CSS が生成され、`next dev` が全ページ 500 になる").toEqual([]);
    });

    // 判定そのものが効くか（0件の状態では、壊れた検出器と正しい検出器が同じ答えを返す）
    describe("判定の自己確認", () => {
        const find = (s: string) => s.match(ELLIPSIS_ARBITRARY) ?? [];

        it("省略形を見つける", () => {
            expect(find("pb-[calc(env(" + "...)+0.75rem)]")).toHaveLength(1);
            expect(find("w-[" + "..." + "]")).toHaveLength(1);
        });

        it("値を省いていない任意の値は通す", () => {
            expect(find("pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]")).toEqual([]);
            expect(find("w-[430px]")).toEqual([]);
            expect(find("grid-cols-[repeat(auto-fill,minmax(160px,1fr))]")).toEqual([]);
        });

        // クラスの形でない三点リーダ（普通の文章・省略記号）は拾わない
        it("文章の中の三点リーダは拾わない", () => {
            expect(find("読み込み中…")).toEqual([]);
            expect(find("// 例: style={{ bottom: calc(env(" + "...)+16px) }}")).toEqual([]);
        });
    });
});
