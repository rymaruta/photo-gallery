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

// **1人あたりのアップロード上限。** 画面（lib/utils/uploadLimits.ts）と
// サーバー（api-user/src/photoLimit.ts）と画面の2か所に数字がある。ずれると
// 「あと N 枚と出ているのに押すと 403」か「上げたのに投稿できないまま」
// のどちらかになる。**コメントは「片方だけ変えると嘘になる」と警告して
// いたのに、それを縛るものが無かった**（100 → 1000 に動かすときに気づいた）。
function numberIn(rel: string, re: RegExp, label: string): number {
    const m = re.exec(read(rel));
    expect(m, `${label} が ${rel} に見つからない`).not.toBeNull();
    return Number(m![1]);
}

describe("1人あたりのアップロード上限は、画面とサーバーで同じ", () => {
    // **`upload.ts` から `photoLimit.ts` へ移した。** `upload.ts` を import
    // すると `rebuild.ts` まで引きずられ、上限だけ使いたい `storyKeep.ts` が
    // 「再ビルドのトークンを配る関数」の一覧に載ってしまうため
    // （`rebuildTokenScope.test.ts` が止めた）。数字の在りかは1つのまま
    const server = () => numberIn("api-user/src/photoLimit.ts", /(?:export )?const PHOTO_LIMIT_PER_USER = (\d+);/, "サーバーの上限");
    const client = () => numberIn("lib/utils/uploadLimits.ts", /export const PHOTO_LIMIT_PER_USER = (\d+);/, "画面の上限");

    it("数字が一致する（片方だけ変えない）", () => {
        expect(client(), "画面とサーバーで上限がずれている").toBe(server());
    });

    // 0 や NaN を「一致」と読まない（正規表現が壊れたときに緑にしない）
    it("読めた数字が正の値である", () => {
        expect(server()).toBeGreaterThan(0);
        expect(client()).toBeGreaterThan(0);
    });
});

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

    // **`min` を出した `<input>` が `<form>` の中にあるなら、その form は
    // `noValidate` でなければならない。** そうしないと範囲外の値が入っている
    // 写真で **submit そのものが発火せず**、日付以外の項目まで保存できなくなる
    // （Chromium で実測: 範囲外→発火せず／`noValidate`→発火）。
    // **jsdom は制約検証を走らせない**ので振る舞いでは書けない。ここだけ綴りで見る
    it.each(["app/user/edit/page.tsx", "app/admin/edit/page.tsx"])("%s: submit で保存する form は制約検証を止めている", (page) => {
        const src = read(page);
        const forms = [...src.matchAll(/<form\b[^>]*>/g)].map((m) => m[0]);
        const submits = /type="submit"/.test(src);
        if (!submits) return;   // 保存が type="button" なら form の検証は関係ない
        expect(forms.length, `${page} に form が無いのに type="submit" がある`).toBeGreaterThan(0);
        for (const f of forms) {
            expect(f, `${page} の form が noValidate を持っていない`).toContain("noValidate");
        }
    });

    it("両パッケージの sanitize が同じ下限を持つ", () => {
        const other = readFileSync(join(__dirname, "..", "..", "api/src/sanitize.ts"), "utf8");
        const a = /year\s*<\s*(\d{4})/.exec(sanitize)?.[1];
        const b = /year\s*<\s*(\d{4})/.exec(other)?.[1];
        expect(b, "api 側に年の下限が見つからない").toBeTruthy();
        expect(b, "api と api-user で撮影日の下限が違う").toBe(a);
    });
});

/**
 * **題・撮影地・カテゴリの上限は、十数か所に散っている。**
 *
 * `1b150344` で立てた数え上げ（「その入口は全部か」）を、この対テストに
 * 当て直して出た。実際に数えると:
 *
 *     撮影地 200   api/upload・api/photosMutate・api-user/stories・
 *                  api-user/upload・api-user/photoUpdate ＋ 画面2枚 = **7か所**
 *     カテゴリ 100  上のうち4か所 ＋ 画面2枚 = **6か所**
 *     題 200        `sanitizeTitle` の中に4回 ＋ 画面2枚
 *
 * **1つも縛られていなかった。** `PHOTO_LIMIT_PER_USER` で一度踏んだ形と同じ
 * ——画面だけ広げると「入力できるのにサーバーが黙って切る」（保存は成功して、
 * あとで開くと末尾が無い）、サーバーだけ広げると「受け付けるのに入力できない」。
 *
 * **今は全部揃っている**ので実在の欠陥は0。縛るのは「これから片方だけ変えない」こと。
 */
describe("題・撮影地・カテゴリの上限が、全部の書き場所で同じ", () => {
    /** サーバーの `sanitizeText(..., N)` を全部集める（呼び出しごとに数字を書く形） */
    function serverCalls(field: "location" | "category"): { where: string; n: number }[] {
        const files = [
            "api/src/upload.ts", "api/src/photosMutate.ts",
            "api-user/src/upload.ts", "api-user/src/photoUpdate.ts", "api-user/src/stories.ts",
        ];
        const out: { where: string; n: number }[] = [];
        for (const f of files) {
            const src = read(f);
            const re = new RegExp(`sanitizeText\\(\\s*(?:body\\.)?${field}\\s*,\\s*(\\d+)\\s*\\)`, "g");
            for (const m of src.matchAll(re)) out.push({ where: f, n: Number(m[1]) });
        }
        return out;
    }

    /** 画面の定数（2枚とも同じ数字のはず） */
    function clientConsts(name: string): { where: string; n: number }[] {
        const files = ["app/user/edit/page.tsx", "app/user/upload/page.tsx"];
        const out: { where: string; n: number }[] = [];
        for (const f of files) {
            const m = new RegExp(`const ${name}\\s*=\\s*(\\d+)`).exec(read(f));
            if (m) out.push({ where: f, n: Number(m[1]) });
        }
        return out;
    }

    // **読めていることを先に確かめる。** 正規表現が外れると
    // 「0件 === 0件」で通る（この台帳が何度も踏んだ形）
    it("サーバーと画面の書き場所を実際に見つけられている", () => {
        expect(serverCalls("location").length, "撮影地の上限を1つも読めていない").toBeGreaterThanOrEqual(5);
        expect(serverCalls("category").length, "カテゴリの上限を1つも読めていない").toBeGreaterThanOrEqual(4);
        expect(clientConsts("LOCATION_MAX").length, "画面の LOCATION_MAX を読めていない").toBe(2);
        expect(clientConsts("CATEGORY_MAX").length, "画面の CATEGORY_MAX を読めていない").toBe(2);
        expect(clientConsts("TITLE_MAX").length, "画面の TITLE_MAX を読めていない").toBe(2);
    });

    it.each([["location", "LOCATION_MAX"], ["category", "CATEGORY_MAX"]] as const)(
        "%s の上限が、サーバーの全ての呼び出しと画面で同じ",
        (field, constName) => {
            const server = serverCalls(field);
            const client = clientConsts(constName);
            const all = [...server, ...client];
            const values = [...new Set(all.map((x) => x.n))];
            expect(values, `ずれている: ${all.map((x) => `${x.where}=${x.n}`).join(" / ")}`).toHaveLength(1);
            expect(values[0], "0 や NaN を一致と読まない").toBeGreaterThan(0);
        },
    );

    // 題は `sanitizeTitle` の中に数字が書いてある（呼び出し側は渡さない）
    it("題の上限が、sanitizeTitle と画面で同じ", () => {
        // **`sanitizeTitle` の本体だけを見る。** ファイル全体だと他の上限
        // （説明・タグ）まで拾う。`truncate(...)` は引数に括弧を含むので
        // `[^)]*` では途中で止まる（最初これで「1つも読めていない」と嘘の
        // 失敗を出した）——本体を切り出してから数字を拾う
        const body = /export function sanitizeTitle[\s\S]*?\n\}/.exec(read("api-user/src/sanitize.ts"));
        expect(body, "sanitizeTitle が見つからない").not.toBeNull();
        const inTitle = [...body![0].matchAll(/,\s*(\d+)\s*\)/g)].map((m) => Number(m[1]));
        expect(inTitle.length, "sanitizeTitle の中の上限を読めていない").toBeGreaterThanOrEqual(3);
        const client = clientConsts("TITLE_MAX");
        expect([...new Set(client.map((c) => c.n))], "画面2枚で TITLE_MAX がずれている").toHaveLength(1);
        // **「どれか1つが一致」では足りない。** `sanitizeTitle` は素の文字列・
        // 日本語・英語の3か所で切るので、**日本語だけ 120 に狭める**変異が
        // 「200 も在るから」で素通りした（変異で確認）。それは「画面は通すのに
        // サーバーが黙って切る」そのもの。**全部が同じ数字**であることを見る
        expect([...new Set(inTitle)], `sanitizeTitle の中で上限が割れている: ${inTitle.join(", ")}`).toHaveLength(1);
        expect(inTitle[0], "画面とサーバーで題の上限がずれている").toBe(client[0].n);
    });
});

