import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **単体は固定・配線は無防備**を3周続けている。
//
// `usableRows` / `usablePhotoRows` 自体のテストはあるが、**画面が呼ぶこと**は
// 誰も見ていなかった——5か所のうち4か所は、呼び出しを `Array.isArray` に
// 戻してもフルスイート 2,776件が全緑だった（レビューが実測）。
//
// 振る舞いのテストは重い画面ほど書きにくいので、**配線の側を数える**。
// ここで見るのは「配列を状態に入れる前に通しているか」だけ。
//
// 走査ではなく一覧にしているのは、**新しい画面を足したときに気づけない**
// から——`res.json()` を配列として使う箇所は形が揃っていない
// （`as Photo[]` / `as unknown` / 直接 `.filter`）ので、機械的に拾うと
// 取りこぼすか誤検知する。ここに足すのは人の仕事、というのが今の判断。
const ROOT = join(__dirname, "..", "..");

/** 配列の応答を状態へ入れる画面と、その根拠 */
const SITES: Array<{ file: string; why: string }> = [
    { file: "lib/hooks/usePhotos.ts", why: "GET /photos → ホームの一覧" },
    { file: "app/photo/[id]/PhotoPageClient.tsx", why: "GET /photos → relatedSections / adjacentPhotos" },
    { file: "app/users/UserProfileClient.tsx", why: "GET /user/photos と GET /photos?userId=" },
    { file: "app/user/edit/page.tsx", why: "GET /user/photos → collectOwnValues" },
    { file: "app/user/drafts/page.tsx", why: "GET /user/photos → 下書き一覧" },
    { file: "app/user/upload/page.tsx", why: "GET /user/photos → 残り枚数と入力候補" },
    { file: "app/components/NotificationsBell.tsx", why: "GET /user/notifications" },
    { file: "lib/hooks/useComments.ts", why: "GET /photos/{id}/comments" },
];

const codeOf = (rel: string) =>
    readFileSync(join(ROOT, rel), "utf8")
        .replace(/(^|[\s{])\/\*[\s\S]*?\*\//g, "$1")
        .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");

describe("配列の応答は、状態へ入れる前にふるいを通す", () => {
    it.each(SITES.map((s) => [s.file, s.why]))("%s（%s）", (file) => {
        const code = codeOf(file);
        expect(code, "ふるいを通さずに状態へ入れている（1件壊れるとページ全体が落ちる）")
            // 型引数（`usablePhotoRows<Photo>(`）を挟む形も拾う
            .toMatch(/usable(Rows|PhotoRows)\s*(<[^>]*>)?\s*\(/);
    });

    // **`Array.isArray` に戻す変異を捕まえるため**、素の判定が
    // 応答の受け取りに残っていないことも見る（ふるいの中では使ってよい）
    it.each(SITES.map((s) => s.file))("%s は res.json() を素の Array.isArray で受けない", (file) => {
        const code = codeOf(file);
        const raw = code.match(/Array\.isArray\(\s*(?:await\s+)?\w*(?:res|response|Res)\w*\.json\(\)/g) ?? [];
        expect(raw, "応答をふるい無しで配列判定している").toEqual([]);
    });

    it("一覧が空になっていない（見張りが空振りしていない）", () => {
        expect(SITES.length).toBeGreaterThan(5);
    });
});
