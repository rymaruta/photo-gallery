import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **遅れて返った古い結果が、新しい結果を上書きしていた。**
// 画面には「打っていない語」の検索結果が出る。
//
// `StoriesBar` は世代で追い越しを捨てる形を持っていたのに、写真ページと
// プロフィールには無かった（対の乖離）。**同じ形を3か所に書くことになる**
// ので、片方だけ消えても気づけるようにここで数える。
//
// 振る舞いのテストはプロフィールに1本ある
// （`app/user/profile/__tests__/page.usernameIme.test.tsx`）。
// 写真ページはページ全体を組み立てる手間が大きいので、ここで配線を見る。
const ROOT = join(__dirname, "..", "..");
const FILES = [
    "app/components/stories/StoriesBar.tsx",
    "app/photo/[id]/PhotoPageClient.tsx",
    "app/user/profile/page.tsx",
];

const codeOf = (rel: string) =>
    readFileSync(join(ROOT, rel), "utf8")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");

describe("曲検索は追い越しを捨てる", () => {
    it.each(FILES)("%s が世代を持っている", (rel) => {
        const code = codeOf(rel);
        expect(code, "この走査の対象から外れている（searchSongs を呼んでいない）")
            .toMatch(/searchSongs\(/);
        expect(code, "世代のカウンタが無い").toMatch(/songSearchGen\s*=\s*useRef\(0\)/);
        expect(code, "採番していない").toMatch(/\+\+songSearchGen\.current/);
        expect(code, "採番しただけで見ていない（古い応答が上書きする）")
            .toMatch(/gen\s*!==\s*songSearchGen\.current/);
    });

    // **`finally` も見ること。** 見ないと、古い応答の finally が
    // 「検索中」の表示を消して、走っている新しい検索が無反応に見える
    it.each(FILES)("%s は終了処理でも世代を見る", (rel) => {
        const code = codeOf(rel);
        const fin = code.slice(code.indexOf("} finally {", code.indexOf("searchSongs(")));
        expect(fin.slice(0, 200), "finally が世代を見ていない")
            .toMatch(/gen\s*===\s*songSearchGen\.current/);
    });
});
