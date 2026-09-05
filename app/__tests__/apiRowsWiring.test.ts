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
// のを承知のうえで（漏れたら次の周のレビューで拾う）——`res.json()` を配列として使う箇所は形が揃っていない
// （`as Photo[]` / `as unknown` / 直接 `.filter`）ので、機械的に拾うと
// 取りこぼすか誤検知する。ここに足すのは人の仕事、というのが今の判断。
const ROOT = join(__dirname, "..", "..");

/**
 * 配列の応答を状態へ入れる画面と、その根拠。
 *
 * `calls` は**その画面が通すべき呼び出しの数**。1つでもあれば緑にすると、
 * 呼び出しが2つあるファイル（`UserProfileClient`）で**片方だけ戻す変異が
 * 素通りする**（レビューが実測）。画面単位では守れていても、呼び出し単位で
 * 守れていなかった。
 */
const SITES: Array<{ file: string; why: string; calls: number }> = [
    { file: "lib/hooks/usePhotos.ts", calls: 1, why: "GET /photos → ホームの一覧" },
    { file: "app/photo/[id]/PhotoPageClient.tsx", calls: 1, why: "GET /photos → relatedSections / adjacentPhotos" },
    { file: "app/users/UserProfileClient.tsx", calls: 2, why: "GET /user/photos と GET /photos?userId=" },
    { file: "app/user/edit/page.tsx", calls: 1, why: "GET /user/photos → collectOwnValues" },
    { file: "app/user/drafts/page.tsx", calls: 1, why: "GET /user/photos → 下書き一覧" },
    { file: "app/user/upload/page.tsx", calls: 1, why: "GET /user/photos → 残り枚数と入力候補" },
    { file: "app/components/NotificationsBell.tsx", calls: 1, why: "GET /user/notifications" },
    { file: "lib/hooks/useComments.ts", calls: 1, why: "GET /photos/{id}/comments" },
    // 管理者専用だが、直し方は同じ（一般利用者の画面より優先度は下）
    { file: "app/admin/page.tsx", calls: 1, why: "GET /admin/photos → selectVisiblePhotos" },
    { file: "app/admin/edit/page.tsx", calls: 1, why: "GET /admin/photos → find(p => p.id)" },
    { file: "lib/hooks/useUserSearch.ts", calls: 1, why: "GET /users/search → users.map(u => u.userId)" },
    { file: "app/components/stories/StoryViewer.tsx", calls: 1, why: "GET /stories/{id}/viewers → viewers.map" },
];

const codeOf = (rel: string) =>
    readFileSync(join(ROOT, rel), "utf8")
        .replace(/(^|[\s{])\/\*[\s\S]*?\*\//g, "$1")
        .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");

describe("配列の応答は、状態へ入れる前にふるいを通す", () => {
    it.each(SITES.map((s) => [s.file, s.why, s.calls] as const))("%s（%s）", (file, _why, calls) => {
        const code = codeOf(file);
        const found = code.match(/usable(Rows|PhotoRows)\s*(<[^>]*>)?\s*\(/g) ?? [];
        expect(found.length, "ふるいを通さずに状態へ入れている（1件壊れるとページ全体が落ちる）")
            .toBeGreaterThanOrEqual(calls);
    });

    it("一覧が空になっていない（見張りが空振りしていない）", () => {
        expect(SITES.length).toBeGreaterThan(10);
    });
});
