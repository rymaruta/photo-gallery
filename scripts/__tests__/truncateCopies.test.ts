import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// `truncate` は3つのファイルに同じものを置いてある（2つのパッケージと
// 配信側はビルドを共有しないので、小さく複製する既存の方針）。
//
// **複製したのに、同一性を守る仕掛けが無かった。** `api/src/sanitize.ts` と
// `lib/utils/text.ts` の両方を素の `slice` に戻しても、467件すべて緑だった
// ——`truncate.test.ts` は api-user 側しか import しておらず、
// `lib/utils/text.ts` を使うのは `app/sitemap-images.xml/route.ts` だけで
// そこにテストが無いため。`api/src/__tests__/rebuild.test.ts` が
// 2ファイルの同一性を見ているのと同じ形を置く。

const root = join(__dirname, "..", "..");
const FILES = [
    "api-user/src/sanitize.ts",
    "api/src/sanitize.ts",
    "lib/utils/text.ts",
];

/**
 * `export function truncate(...) { ... }` の**コードだけ**を抜き出す。
 *
 * コメントは落とす。落とさないと「片方にコメントを1行足しただけ」で
 * CI が「3本が違う」で落ちる——実際、この3本を揃えるためだけに
 * `lib/utils/text.ts` へコメントを1行足す羽目になった。
 * 守りたいのは**振る舞いが同じこと**であって、注釈まで同じことではない。
 */
function stripComments(code: string): string {
    return code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function bodyOf(path: string): string {
    const src = readFileSync(join(root, path), "utf8");
    const i = src.indexOf("export function truncate(");
    expect(i, `${path} に truncate が無い`).toBeGreaterThan(-1);
    const open = src.indexOf("{", i);
    let depth = 0;
    for (let j = open; j < src.length; j++) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") {
            depth--;
            if (depth === 0) return stripComments(src.slice(open, j + 1)).replace(/\s+/g, " ").trim();
        }
    }
    throw new Error(`${path} の truncate が閉じていない`);
}

describe("truncate の複製3本は同じ中身", () => {
    it("3本の本体が一致する（片方だけ直さない）", () => {
        const [a, b, c] = FILES.map(bodyOf);
        expect(b, `${FILES[1]} が ${FILES[0]} と違う`).toBe(a);
        expect(c, `${FILES[2]} が ${FILES[0]} と違う`).toBe(a);
    });

    // 「同じ」だけだと、3本とも素の slice に戻しても通る。
    // コメントは落としてあるので、注釈に `0xdbff` と書いてあるだけでは通らない
    it.each(FILES)("%s はサロゲートの判定を持っている", (f) => {
        expect(bodyOf(f)).toContain("0xdbff");
    });

    it("コメントの違いでは落ちない（振る舞いだけを見る）", () => {
        const withComment = stripComments("{ // 注釈\n  return s; /* 別の注釈 */ }").replace(/\s+/g, " ").trim();
        const without = stripComments("{ return s; }").replace(/\s+/g, " ").trim();
        expect(withComment).toBe(without);
    });
});
