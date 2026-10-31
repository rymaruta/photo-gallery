import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * 束 1（#420・2026-10-31）: ホーム・写真の詳細・さがす・人のページを iOS にそろえた所のうち、
 * 画面の部品のテストでは見えない「つなぎ」（CSS・見出しの印・スモーク）を見る
 */
const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", "..", p), "utf8");

describe("P1・U1: スマホではサイトの見出しを外す頁", () => {
    it("見出しに印があり、`data-chromeless-phone` を持つ頁で 1024px 未満だけ外す", () => {
        expect(read("app/layout.tsx")).toMatch(/<header[\s\S]{0,200}data-site-header=""/);
        const css = read("app/globals.css");
        const block = css.slice(css.indexOf("@media (max-width: 1023.98px)"));
        expect(block).toMatch(/body:has\(\[data-chromeless-phone\]\) \[data-site-header\] \{\s*display: none;/);
        // 見出しの高さの変数も 0（送る先の余白が無い見出しのぶん空かない）
        expect(block).toMatch(/:root:has\(\[data-chromeless-phone\]\) \{\s*--header-h: 0px;/);
    });

    it("写真の詳細はその印を持つ", () => {
        expect(read("app/photo/[id]/PhotoPageClient.tsx")).toContain('data-chromeless-phone=""');
    });

    it("スモークは写真ページのスマホでメニューではなく「見出しが消えて戻るが押せる」を見て、メニューは PC で見る", () => {
        const smoke = read("scripts/e2e-smoke.mjs");
        expect(smoke).toContain("await expectChromelessPhone(page, `[${eng}] 写真ページ`");
        expect(smoke).not.toContain("await expectMenuWorks(page, `[${eng}] 写真ページ`)");
        expect(smoke).toContain("await expectMenuWorks(dpage, `[${eng}] 写真ページ(デスクトップ)`)");
    });
});
