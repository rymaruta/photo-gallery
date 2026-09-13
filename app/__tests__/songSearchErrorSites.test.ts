import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodeFs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodePath = require("path");

/**
 * **同じ文面を3か所に書き直さない。**
 *
 * 曲検索の失敗の一行は、ストーリーの曲・写真ページのBGM・プロフィールのBGM の
 * 3か所に**同じ文面・同じマークアップ**で複製されていた。探す仕組み自体は
 * `lib/hooks/useSongSearch.ts` に1本化してあるのに、**文言だけが複製のまま**で、
 * 結果として `role="alert"` を足すときも3か所を直すことになる
 * （＝片方だけ直す形の温床）。
 *
 * 部品（`app/components/SongSearchError.tsx`）の外にこの文面が現れたら落とす。
 */
const MESSAGE = "検索に失敗しました。";
const OWNER = "app/components/SongSearchError.tsx";

const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const name of nodeFs.readdirSync(dir)) {
        if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
        const p = nodePath.join(dir, name);
        if (nodeFs.statSync(p).isDirectory()) out.push(...walk(p));
        else if (/\.tsx?$/.test(name)) out.push(p);
    }
    return out;
};

const filesWithMessage = (): string[] =>
    walk(nodePath.join(process.cwd(), "app"))
        .filter((f: string) => nodeFs.readFileSync(f, "utf8").includes(MESSAGE))
        .map((f: string) => nodePath.relative(process.cwd(), f).split(nodePath.sep).join("/"));

describe("曲検索の失敗の文面", () => {
    it("持っているのは部品1つだけ", () => {
        expect(filesWithMessage(), "同じ文面が複製されている").toEqual([OWNER]);
    });

    // 判定が効くか（1件だけの状態では、壊れた検出器と正しい検出器が同じ答えを返す）
    it("判定は、部品が名前を変えたら気づく", () => {
        expect(nodeFs.existsSync(nodePath.join(process.cwd(), OWNER)), "部品が無い").toBe(true);
        expect(filesWithMessage().length, "探せていない").toBeGreaterThan(0);
    });
});

/** コメントを先に落とす（理由を書くほど、綴りで見る判定は自分の説明に当たる） */
const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/**
 * **曲を探す画面は、失敗を必ず出す。**
 *
 * 探す仕組みは `lib/hooks/useSongSearch.ts` に1本化してあるので、
 * それを使う画面を数え上げれば「失敗の出し方を置いてきた画面」が分かる。
 * 手書きの一覧にすると、4つ目の画面が増えた日に静かに素通りする。
 */
describe("曲を探す画面", () => {
    // **呼び出しの綴りではなく import で数える。** `useSongSearch as useSongs`
    // と別名で入れた画面は `useSongSearch(` に一致せず、素通りしていた
    // （4つ目の画面を実際に作って確かめた）
    const users = (): string[] =>
        walk(nodePath.join(process.cwd(), "app"))
            .filter((f: string) => /from\s+["'][^"']*useSongSearch["']/.test(stripComments(nodeFs.readFileSync(f, "utf8"))))
            .map((f: string) => nodePath.relative(process.cwd(), f).split(nodePath.sep).join("/"));

    // 判定そのものが効くか（0件の状態では、壊れた検出器と正しい検出器が
    // 同じ答えを返す）。**別名で入れた形も数える**
    it("判定は、別名で入れた画面も数える", () => {
        const re = /from\s+["'][^"']*useSongSearch["']/;
        expect(re.test(`import { useSongSearch } from "@/lib/hooks/useSongSearch";`)).toBe(true);
        expect(re.test(`import { useSongSearch as useSongs } from "../../lib/hooks/useSongSearch";`),
            "別名で入れた画面を見落とす").toBe(true);
        expect(re.test(`import { useSongs } from "./other";`)).toBe(false);
    });

    it("探す画面は全部、失敗の一行を出す", () => {
        const found = users();
        expect(found.length, "探す画面を1つも見つけられていない").toBeGreaterThanOrEqual(3);
        const missing = found.filter((f: string) =>
            !stripComments(nodeFs.readFileSync(nodePath.join(process.cwd(), f), "utf8")).includes("<SongSearchError"));
        expect(missing, "失敗を出さない画面がある（押しても何も起きないように見える）").toEqual([]);
    });
});
