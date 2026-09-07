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
    // **文字列で送ったときの上限。** `sanitizeDescription` の
    // `if (typeof v === "string") return truncate(v.trim(), 2000)`。
    // **段落数は一切見ない**——ここを取り違えて、両画面に「50段落まで」と
    // いう**ほぼ常に誤報**の警告を出したことがある（本物の上限は野放しだった）
    descString: serverLimit(/sanitizeDescription[\s\S]{0,200}?typeof v === "string"\)\s*return truncate\(v\.trim\(\),\s*(\d+)\)/, "説明の文字数"),
};

const PAGES = ["app/user/edit/page.tsx", "app/user/upload/page.tsx"];

describe("件数の上限が、画面とサーバーで一致している", () => {
    it("sanitize.ts から数字を読めている（正規表現が空振りしていない）", () => {
        expect(SERVER.tags).toBe(30);
        expect(SERVER.paragraphs).toBe(50);
        expect(SERVER.descString).toBe(2000);
    });

    it.each(PAGES)("%s のタグ上限がサーバーと同じ", (page) => {
        const m = /const TAGS_MAX = (\d+);/.exec(read(page));
        expect(m, "TAGS_MAX が無い").not.toBeNull();
        expect(Number(m![1]), "画面とサーバーで違う").toBe(SERVER.tags);
    });

    it.each(PAGES)("%s の説明の文字数上限がサーバーと同じ", (page) => {
        const m = /const DESC_STRING_MAX = (\d+);/.exec(read(page));
        expect(m, "DESC_STRING_MAX が無い").not.toBeNull();
        expect(Number(m![1]), "画面とサーバーで違う").toBe(SERVER.descString);
    });

    // 段落の上限は `{ja:[],en:[]}` で送る画面にだけ意味がある。
    // **必ず文字列で送る画面には置かない**——置くと、また誤報の元になる
    it("段落の上限を持つのは編集画面だけ", () => {
        const edit = /const DESC_PARAGRAPHS_MAX = (\d+);/.exec(read("app/user/edit/page.tsx"));
        expect(edit, "編集画面に DESC_PARAGRAPHS_MAX が無い").not.toBeNull();
        expect(Number(edit![1])).toBe(SERVER.paragraphs);

        expect(read("app/user/upload/page.tsx"),
            "必ず文字列で送る画面に段落の上限を置いている（誤報になる）")
            .not.toMatch(/DESC_PARAGRAPHS_MAX/);
    });

    // 定数を置いただけで使っていなければ意味が無い
    it.each(PAGES)("%s が実際に上限を見て告げている", (page) => {
        const src = read(page);
        expect(src, "TAGS_MAX を見ていない").toMatch(/>\s*TAGS_MAX/);
        expect(src, "DESC_STRING_MAX を見ていない").toMatch(/>\s*DESC_STRING_MAX/);
        expect(src, "告げていない").toMatch(/超えた分は保存されません/);
    });
});

// **撮影日の下限を画面とサーバーの2か所に書いている。** 片方だけ動かすと
// 「入れられるのに 400 で断られる」か「入れられないのに保存はできる」になる。
// 実測（`1985-06-01` → undefined）で分かったとおり、断り方が黙っていた頃は
// **保存済みの日付が消えていた**ので、この対はずれてはいけない。
describe("撮影日の下限が、画面とサーバーで揃っている", () => {
    it("PHOTO_DATE_MIN の年が sanitize.ts の下限と同じ", async () => {
        const { PHOTO_DATE_MIN } = await import("../../lib/utils/dateInput");
        const m = /year\s*<\s*(\d{4})/.exec(sanitize);
        expect(m, "sanitize.ts に年の下限が見つからない").not.toBeNull();
        expect(PHOTO_DATE_MIN.slice(0, 4), "画面の下限とサーバーの下限が違う").toBe(m![1]);
        // その年の1月1日そのものは通る（境界の向き）
        expect(PHOTO_DATE_MIN).toBe(`${m![1]}-01-01`);
    });

    // **画面がその定数を実際に使っているか**まで見る。数字の一致だけだと、
    // `min={PHOTO_DATE_MIN}` を画面から外しても緑のままだった
    it.each(["app/user/edit/page.tsx", "app/admin/edit/page.tsx"])("%s が撮影日の下限を出している", (page) => {
        const src = read(page);
        expect(src, `${page} が下限の定数を使っていない`).toContain("min={PHOTO_DATE_MIN}");
        expect(src, `${page} が上限を出していない`).toContain("max={todayForDateInput()}");
    });

    it("両パッケージの sanitize が同じ下限を持つ", () => {
        const other = readFileSync(join(__dirname, "..", "..", "api/src/sanitize.ts"), "utf8");
        const a = /year\s*<\s*(\d{4})/.exec(sanitize)?.[1];
        const b = /year\s*<\s*(\d{4})/.exec(other)?.[1];
        expect(b, "api 側に年の下限が見つからない").toBeTruthy();
        expect(b, "api と api-user で撮影日の下限が違う").toBe(a);
    });
});
