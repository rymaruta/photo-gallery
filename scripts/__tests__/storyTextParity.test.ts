import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **`lib/utils/storyText.ts` は `api-user/src/storyText.ts` の写し。**
// クライアントから api-user は import できない（別パッケージ・別ビルド。
// ルートの型検査に api-user が入ると `next build` が落ちる＝`7276c2b8`）。
// **複製した規則は静かにずれる**ので、コードが一致することで縛る
// （`mediaHostsParity` / `cdnInvalidateParity` / `truncateCopies` と同じ手）。
//
// ずれると何が起きるか: 画面が出せる字体や色をサーバーが既定へ落とす
// （打った人の指定が黙って無視される）。逆向きなら、保存できる見せ方が
// 画面に出ない。どちらも「片方だけ直した」で起きる。

const root = join(__dirname, "..", "..");
const FILES = ["api-user/src/storyText.ts", "lib/utils/storyText.ts"];

/** コメントと空白を落としたコード（写し側の見出しコメントもこれで落ちる） */
const codeOf = (rel: string) =>
    readFileSync(join(root, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1 ")
        .replace(/\s+/g, " ")
        .trim();

describe("ストーリーの文字の見せ方: 複製2本は同じ中身", () => {
    it("2本のコードが一致する（片方だけ直さない）", () => {
        const [a, b] = FILES.map((f) => codeOf(f));
        expect(b, `${FILES[1]} が ${FILES[0]} と違う（片方だけ直した？）`).toBe(a);
    });

    // **空になっていないことを確かめる。** コメントの落とし方を間違えると
    // 全部消えて「空 === 空」で通る（この台帳で実際に踏んだ型）
    it("比較しているのが空文字ではない", () => {
        for (const f of FILES) {
            const code = codeOf(f);
            expect(code.length, `${f} を読めていない`).toBeGreaterThan(400);
            expect(code, `${f} から字体の一覧が消えている`).toContain("Hiragino Mincho ProN");
            expect(code, `${f} から色の一覧が消えている`).toContain("#ff453a");
        }
    });
});
