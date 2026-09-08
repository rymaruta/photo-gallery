import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **`lib/utils/mediaHosts.ts` は `api-user/src/mediaHosts.ts` の写し。**
// クライアントから api-user は import できない（別パッケージ・別ビルド）。
// **複製した規則は静かにずれる**ので、コードが一致することで縛る
// （`cdnInvalidateParity` / `truncateCopies` と同じ手）。
//
// ずれると何が起きるか: サーバーが弾くホストを画面が読み込む（またはその逆で、
// 保存できる値が画面に出ない）。どちらも「片方だけ直した」で起きる。

const root = join(__dirname, "..", "..");
const FILES = ["api-user/src/mediaHosts.ts", "lib/utils/mediaHosts.ts"];

/** コメントと空白を落としたコード（写し側の見出しコメントもこれで落ちる） */
const codeOf = (rel: string) =>
    readFileSync(join(root, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1 ")
        .replace(/\s+/g, " ")
        .trim();

describe("曲のホスト許可リストの複製2本は同じ中身", () => {
    it("2本のコードが一致する（片方だけ直さない）", () => {
        const [a, b] = FILES.map((f) => codeOf(f));
        expect(b, `${FILES[1]} が ${FILES[0]} と違う（片方だけ直した？）`).toBe(a);
    });

    // **空になっていないことを確かめる。** コメントの落とし方を間違えると
    // 全部消えて「空 === 空」で通る（この台帳で実際に踏んだ型）
    it("比較しているのが空文字ではない", () => {
        for (const f of FILES) {
            const code = codeOf(f);
            expect(code.length, `${f} を読めていない`).toBeGreaterThan(200);
            expect(code, `${f} から許可リストが消えている`).toContain("mzstatic.com");
        }
    });
});
