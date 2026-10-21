import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * iOS 版にそろえた字の決まり（2026-10-21）。
 *
 * - 数字・時刻・眉ラベルは**等幅の書体ではなく SF（本文の字）＋等幅の数字**。
 *   owner は等幅の書体が好きではない（2026-10-02・iOS の `JPFont.mono`）。
 *   `.font-mono` は今は本文の字に読み替えてある（`globals.css`）が、名前が「等幅」を名乗るので
 *   **新しく書く所が `font-mono` を真似ないよう、画面のコードからは消した**。
 *   残すのはキーボードの鍵の札（`<kbd>`）だけ——あれは数字ではなく鍵の名前
 * - 節の見出しは共通の `SectionHead`（眉＋消える線 → 明朝 22）。ホームの「おすすめ」と
 *   「さがす」の3節が同じ部品を通る
 */
const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === "__tests__" || e.name === "node_modules" || e.name === "data") continue;
            walk(rel, out);
        } else if (/\.tsx$/.test(e.name)) out.push(rel);
    }
    return out;
}

describe("字: 等幅の書体を名乗るクラスを画面に書かない", () => {
    it("`font-mono` は `<kbd>` の鍵の札だけ", () => {
        const offenders: string[] = [];
        for (const f of walk("app")) {
            read(f).split("\n").forEach((line, i) => {
                if (/\bfont-mono\b/.test(line) && !/<kbd\b/.test(line)) offenders.push(`${f}:${i + 1}`);
            });
        }
        expect(offenders).toEqual([]);
    });
});

describe("節の見出し: 共通の SectionHead", () => {
    it("ホームの「おすすめ」と「さがす」が同じ部品を通る", () => {
        expect(read("app/components/FeaturedSections.tsx")).toMatch(/<SectionHead\s+id="featured-heading"/);
        expect(read("app/search/DiscoverSections.tsx")).toMatch(/import SharedSectionHead from "..\/components\/SectionHead"/);
    });

    it("部品は 眉（真鍮・線つき・読み上げに出さない）→ 明朝 22", () => {
        const src = read("app/components/SectionHead.tsx");
        expect(src).toMatch(/aria-hidden="true" className="m-0 eyebrow eyebrow-line text-accent"/);
        expect(src).toMatch(/font-serif[^"]*"\s+style=\{\{ fontSize: "22px"/);
    });
});
