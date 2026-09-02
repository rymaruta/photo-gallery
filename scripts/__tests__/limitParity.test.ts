import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **画面とサーバーで同じ上限を2か所に書いている。**
//
// このリポジトリは `truncate` の3重複を
// `scripts/__tests__/truncateCopies.test.ts` で縛っている。件数の上限にも
// 同じ仕掛けが要る——ずれると「画面は通すのにサーバーが黙って切る」
// （＝保存は成功して、あとで開くと無い）か、その逆の
// 「サーバーは受け付けるのに入力できない」のどちらかになる。
//
// クライアントから `api-user/` を import できないので、**数字そのものを
// 突き合わせる**。片方だけ変えたら落ちる。
const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/^\s*\/\/.*$/gm, "");

const sanitize = read("api-user/src/sanitize.ts");

/** `sanitize.ts` の該当行から実際の数字を取る（コメントの数字は見ない） */
function serverLimit(re: RegExp, label: string): number {
    const m = re.exec(sanitize);
    expect(m, `${label} の行が sanitize.ts に見つからない`).not.toBeNull();
    return Number(m![1]);
}

const SERVER = {
    // `return Array.from(new Set(cleaned)).slice(0, 30);`
    tags: serverLimit(/Array\.from\(new Set\(cleaned\)\)\.slice\(0,\s*(\d+)\)/, "タグの件数"),
    // 説明の段落: `.slice(0, 50);`（`.filter(Boolean)` の直後）
    paragraphs: serverLimit(/\.filter\(Boolean\)\s*\n\s*\.slice\(0,\s*(\d+)\)/, "説明の段落数"),
};

const PAGES = ["app/user/edit/page.tsx", "app/user/upload/page.tsx"];

describe("件数の上限が、画面とサーバーで一致している", () => {
    it("sanitize.ts から数字を読めている（正規表現が空振りしていない）", () => {
        expect(SERVER.tags).toBe(30);
        expect(SERVER.paragraphs).toBe(50);
    });

    it.each(PAGES)("%s のタグ上限がサーバーと同じ", (page) => {
        const m = /const TAGS_MAX = (\d+);/.exec(read(page));
        expect(m, "TAGS_MAX が無い").not.toBeNull();
        expect(Number(m![1]), "画面とサーバーで違う").toBe(SERVER.tags);
    });

    it.each(PAGES)("%s の段落上限がサーバーと同じ", (page) => {
        const m = /const DESC_PARAGRAPHS_MAX = (\d+);/.exec(read(page));
        expect(m, "DESC_PARAGRAPHS_MAX が無い").not.toBeNull();
        expect(Number(m![1]), "画面とサーバーで違う").toBe(SERVER.paragraphs);
    });

    // 定数を置いただけで使っていなければ意味が無い
    it.each(PAGES)("%s が実際に上限を見て告げている", (page) => {
        const src = read(page);
        expect(src, "TAGS_MAX を見ていない").toMatch(/>\s*TAGS_MAX/);
        expect(src, "DESC_PARAGRAPHS_MAX を見ていない").toMatch(/>\s*DESC_PARAGRAPHS_MAX/);
        expect(src, "告げていない").toMatch(/超えた分は保存されません/);
    });
});
