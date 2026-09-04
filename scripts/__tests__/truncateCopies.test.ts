import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as au from "../../api-user/src/sanitize";
import * as ap from "../../api/src/sanitize";

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

function bodyOf(path: string, fn = "truncate"): string {
    const src = readFileSync(join(root, path), "utf8");
    const i = src.indexOf(`export function ${fn}(`);
    expect(i, `${path} に ${fn} が無い`).toBeGreaterThan(-1);
    const open = src.indexOf("{", i);
    let depth = 0;
    for (let j = open; j < src.length; j++) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") {
            depth--;
            if (depth === 0) return stripComments(src.slice(open, j + 1)).replace(/\s+/g, " ").trim();
        }
    }
    throw new Error(`${path} の ${fn} が閉じていない`);
}

describe("truncate の複製3本は同じ中身", () => {
    it("3本の本体が一致する（片方だけ直さない）", () => {
        // **`map(bodyOf)` と書かない。** `map` は第2引数に添字を渡すので、
        // 既定引数の `fn` に `0` が入る（実際にそれで落とした）
        const [a, b, c] = FILES.map((f) => bodyOf(f));
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

// `sanitizeText` ほかも2つのパッケージに同じものを置いてある。
// **片方だけ直すと、管理APIとユーザーAPIで保存される値が変わる**
// ——同じ写真を `/admin/edit` から直したときだけ制御文字が残る、
// といった形になり、症状が出る場所と原因が離れる。
//
// **綴りではなく振る舞いで見る。** 一度
// `expect(本体).toMatch(/u0000-\u001F/)` と書いたが、それは**ソースの
// 見た目**を見ているだけだった——正規表現を残したまま `replace` の結果を
// 捨てる形に変異させても全緑（レビューが実測）。両方を import して
// 同じ表を流す。api 側はこれまで振る舞いのテストが1本も無かった。
describe("2つのパッケージの sanitize が同じように制御文字を落とす", () => {
    const IMPLS = [["api-user", au], ["api", ap]] as const;

    // 1行の項目（画面は input type=text）。改行・タブを残す理由が無い
    it.each(IMPLS)("%s: sanitizeText が制御文字を落とす", (_name, m) => {
        expect(m.sanitizeText("Kyoto\u0000X", 200)).toBe("KyotoX");
        expect(m.sanitizeText("a\u0001b\tc\nd", 200)).toBe("abcd");
        expect(m.sanitizeText("a\u007Fb\u009Fc", 200)).toBe("abc");
        expect(m.sanitizeText("\u0000\u0001", 200)).toBeUndefined();
    });

    it.each(IMPLS)("%s: 上限は落としたあとの長さで見る", (_name, m) => {
        expect(m.sanitizeText("\u0000\u0000abcde", 5)).toBe("abcde");
    });

    it.each(IMPLS)("%s: タイトルも落とす（string と {ja,en} の両方）", (_name, m) => {
        expect(m.sanitizeTitle("京\u0000都")).toBe("京都");
        expect(m.sanitizeTitle({ ja: "京\u0000都", en: "Kyo\u0001to" })).toEqual({ ja: "京都", en: "Kyoto" });
    });

    it.each(IMPLS)("%s: タグも落とす（空になったものは捨てる）", (_name, m) => {
        expect(m.sanitizeTags(["旅\u0000", "\u0001", "京都"])).toEqual(["旅", "京都"]);
    });

    // EXIF の ASCII 項目は NUL 詰めで来ることがある（カメラの書き方次第）
    it.each(IMPLS)("%s: EXIF も落とす", (_name, m) => {
        expect(m.sanitizeExif({ camera: "NIKON Z6\u0000\u0000", lens: "24-70\u0000" }))
            .toEqual({ camera: "NIKON Z6", lens: "24-70" });
    });

    // **説明には当てない。** 段落が1行に潰れる（実データにも改行入りが4件ある）
    it.each(IMPLS)("%s: 説明の改行は残す", (_name, m) => {
        expect(m.sanitizeDescription("一段落目\n\n二段落目")).toBe("一段落目\n\n二段落目");
    });

    // 正常系: ふつうの値は1文字も変えない
    it.each(IMPLS)("%s: ふつうの値は変えない", (_name, m) => {
        for (const v of ["山中湖", "東京 / 渋谷", "Lake District", "#旅"]) {
            expect(m.sanitizeText(v, 200)).toBe(v);
        }
    });

    // 2つの実装が同じ答えを返すこと（片方だけ直さない）
    it.each([
        "Kyoto\u0000X", "a\u0001b\tc", "  \u0000 京都 \u0001 ", "山中湖", "\u0000", "a\u009Fb",
    ])("2つの実装が同じ答えを返す: %j", (input) => {
        expect(ap.sanitizeText(input, 200)).toBe(au.sanitizeText(input, 200));
    });
});
