import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **公開一覧用 GSI の索引名と印の値は、2つのパッケージに写しがある。**
// `api-user`（書く側: 投稿・公開/非公開）と `api`（読む側: `GET /photos` と
// 管理APIの更新）は別パッケージで、互いに import できない。
//
// ずれると何が起きるか——**行を見ても分からない静かな壊れ方**:
//   - 印の値がずれる → api-user が公開した写真が、api の一覧に出ない
//   - 索引名がずれる → Query が `ValidationException` で落ちる（＝一覧が全滅）
//
// `cdnInvalidateParity` / `mediaHostsParity` / `truncateCopies` と同じ手で、
// **値そのものを突き合わせる**（あちらはファイル全体の一致だが、ここは
// 別の中身を持つファイルの中の定数なので、定数だけを取り出して比べる）。

const root = join(__dirname, "..", "..");
const SOURCES = [
    { rel: "api-user/src/publicFeed.ts", label: "api-user（書く側）" },
    { rel: "api/src/publicFeed.ts", label: "api（読む側）" },
];

/** `export const NAME = "値";` から値を取り出す（コメントは先に潰す） */
function constOf(rel: string, name: string): string | null {
    const src = readFileSync(join(root, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/^\s*\/\/.*$/gm, " ");
    const m = new RegExp(`export const ${name}\\s*=\\s*"([^"]*)"`).exec(src);
    return m ? m[1] : null;
}

/** コメントと空白を落としたコード */
const codeOf = (rel: string) =>
    readFileSync(join(root, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1 ")
        .replace(/\s+/g, " ")
        .trim();

describe("公開一覧の GSI: 2パッケージの写しが一致する", () => {
    it("2本のコードが一致する（片方だけ直さない）", () => {
        const [a, b] = SOURCES.map((s) => codeOf(s.rel));
        expect(a, "コメントを落としすぎて空になっている").not.toBe("");
        expect(b, `${SOURCES[1].rel} が ${SOURCES[0].rel} と違う（片方だけ直した？）`).toBe(a);
    });

    it.each(["PUBLIC_INDEX", "PUBLIC_FEED_KEY"])("%s が両方で同じ", (name) => {
        const values = SOURCES.map((s) => ({ ...s, value: constOf(s.rel, name) }));
        for (const v of values) {
            expect(v.value, `${v.label}（${v.rel}）に ${name} が無い`).not.toBeNull();
            expect(v.value, `${v.label} の ${name} が空`).not.toBe("");
        }
        expect(values[1].value, `${name} がずれている（片方だけ直した？）`).toBe(values[0].value);
    });

    // **索引名は AWS 側の実体と一致していないと意味がない。**
    // 作る側（provision-env.js）と読む側の綴りが違うと、Query が
    // ValidationException で落ちる＝公開一覧が丸ごと出なくなる。
    it("provision-env.js が同じ名前・同じキーの組で索引を作る", () => {
        const provision = readFileSync(join(root, "scripts/provision-env.js"), "utf8");
        const indexName = constOf(SOURCES[0].rel, "PUBLIC_INDEX")!;
        expect(provision).toContain(`IndexName: "${indexName}"`);

        // **その索引の定義の中だけを見る。** 最初はファイル全体に対して
        // `{ AttributeName: "createdAt", KeyType: "RANGE" }` を探していたが、
        // これは**既存の userId-createdAt-index の同じ行に当たる**ので、
        // publicFeed 索引のソートキーを別の属性に差し替えても通っていた
        // （レビューが変異で実証）。名前から Projection までを切り出す。
        const from = provision.indexOf(`IndexName: "${indexName}"`);
        const to = provision.indexOf("Projection:", from);
        expect(from, "索引の定義が見つからない").toBeGreaterThan(-1);
        expect(to, "Projection まで届かない（定義の形が変わった？）").toBeGreaterThan(from);
        const block = provision.slice(from, to);
        expect(block, "パーティションキーが publicFeed でない").toMatch(/\{ AttributeName: "publicFeed", KeyType: "HASH" \}/);
        expect(block, "ソートキーが createdAt でない（載る行と並びが変わる）").toMatch(/\{ AttributeName: "createdAt", KeyType: "RANGE" \}/);

        // 属性定義が無いと CreateTable 自体が通らない
        expect(provision).toContain('{ AttributeName: "publicFeed", AttributeType: "S" }');
    });
});
