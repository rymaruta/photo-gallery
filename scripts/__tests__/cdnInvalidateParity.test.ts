import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **`api/src/cdnInvalidate.ts` は `api-user/src/cdnInvalidate.ts` の写し。**
// 管理APIは別サービス（別の Lambda・別の esbuild）なので import できない。
// **複製した規則は静かにずれる**ので、コードが一致することで縛る
// （`truncateCopies.test.ts` と同じ手。あちらは3複製）。
//
// **振る舞いで突き合わせる形は採れなかった。** 両方を1つのテストから
// import して `@aws-sdk/client-cloudfront` を `vi.mock` すると、
// `api/node_modules` があるかどうかで**どちらか片方しかモックに当たらない**
// （実際、`api/` に `npm ci` を通した瞬間にフルスイートで5本落ちた）。
// CI は api / api-user それぞれで `npm ci` を打つので、あちらでも同じになる。

const root = join(__dirname, "..", "..");
const FILES = ["api-user/src/cdnInvalidate.ts", "api/src/cdnInvalidate.ts"];

/**
 * コメントと空白を落としたコード。
 *
 * コメントを残すと「片方に注釈を1行足しただけ」で落ちる。守りたいのは
 * **振る舞いが同じこと**（`truncateCopies.test.ts` と同じ判断）。
 * 写し側の見出しコメント（なぜ複製したか）もこれで落ちる。
 */
const codeOf = (rel: string) =>
    readFileSync(join(root, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1 ")
        .replace(/\s+/g, " ")
        .trim();

describe("エッジ掃除の複製2本は同じ中身", () => {
    it("2本のコードが一致する（片方だけ直さない）", () => {
        const [a, b] = FILES.map((f) => codeOf(f));
        expect(b, `${FILES[1]} が ${FILES[0]} と違う（片方だけ直した？）`).toBe(a);
    });

    // **空になっていないことを確かめる。** コメントの落とし方を間違えると
    // 全部消えて「空 === 空」で通る（この台帳で実際に踏んだ型）
    it.each(FILES)("%s のコードが空になっていない", (rel) => {
        const code = codeOf(rel);
        expect(code.length, "コメントを落としすぎて空になっている").toBeGreaterThan(500);
        expect(code).toContain("CreateInvalidationCommand");
        expect(code).toContain("MAX_PATHS_PER_REQUEST = 3000");
        // **ブロックコメントの除去を貪欲にすると**、最初の `/*` から最後の
        // `*/` までが消えて **`DIST_ID` の代入行ごと落ちる**——片方だけ変えても
        // 気づけない（レビューが変異で実証）。
        // **`CLOUDFRONT_DISTRIBUTION_ID` を見るだけでは足りない**——関数の中の
        // 警告文にも同じ語があるので、貪欲にしても残って素通りする（実測）。
        // コメントに挟まれた**代入そのもの**を見る
        expect(code, "コメントの落としすぎで、コメントに挟まれた行が消えている")
            .toContain("DIST_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID");
    });
});
