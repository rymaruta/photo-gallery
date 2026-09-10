import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **sitemap に載せる集約の種類は、手書きの配列で列挙されている。**
// 種類を足したときにここを忘れると、ページは生成されるのに
// **サイトマップに1行も出ない**——「見つけてもらう」ための機能なのに、
// いちばん効く導線が欠ける。しかも画面には何の症状も出ないので気づけない
// （このリポジトリは「関数は書いたが配線していない」を5回踏んでいる）。
//
// 型を書き下している箇所なので tsc も止めてくれない（`as CollectionType[]`）。
const src = readFileSync(join(__dirname, "..", "sitemap.ts"), "utf8");
/** コメントを落とす（コメントに書いてあるだけを緑にしない） */
const code = src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, " ");

describe("sitemap に載せる集約の種類", () => {
    it.each(["tag", "location", "category", "camera"])("%s を列挙している", (type) => {
        const m = /\(\[([^\]]*)\]\s*as\s*CollectionType\[\]\)/.exec(code);
        expect(m, "集約の種類の列挙が見つからない（書き方が変わった？）").not.toBeNull();
        expect(m![1]).toContain(`"${type}"`);
    });

    // 列挙そのものを読めているか（正規表現が空振りして緑にならないため）
    it("列挙を実際に読めている", () => {
        const m = /\(\[([^\]]*)\]\s*as\s*CollectionType\[\]\)/.exec(code);
        expect(m![1].split(",").filter((s) => s.trim()).length).toBeGreaterThanOrEqual(4);
    });
});
