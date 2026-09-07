import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// **読み上げでページを辿れるか。** Chromium で主要9画面の見出しと
// ランドマークを実測して出た2件を固定する:
//
// 1. **ホームだけ h1 が0件だった**（390px 幅）。タイトルは `hidden sm:flex` の
//    中にあり、狭い画面では `display:none` ＝読み上げの木からも消える。
//    ホームはこのサイトの入口で、検索から来た人が最初に開く画面。
// 2. **無名の `<nav>` が全ページに2つ**（ヘッダーとフッター）。同じ種類の
//    ランドマークが複数あるとき、名前が無いと「ナビゲーション」が2回読まれる
//    だけで、どちらへ行けばよいか分からない。
//
// jsdom は CSS を評価しない（`sm:hidden` が効かない）ので、ここでは
// 「置いてあるか」だけを見る。幅ごとの見え方はブラウザで測った
// （`scripts/audit-text-contrast.mjs` と同じ手で、scratchpad の `a11y2/outline.mjs`）。

vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: { navigation: {} } }),
}));

describe("ランドマークに名前が付いている", () => {
    it("フッターのナビに名前がある（ヘッダーのナビと区別できる）", async () => {
        const Footer = (await import("../components/Footer")).default;
        const { container } = render(<Footer />);
        const navs = [...container.querySelectorAll("nav")];
        expect(navs.length, "フッターにナビが無い").toBeGreaterThan(0);
        for (const nav of navs) {
            expect(nav.getAttribute("aria-label") || nav.getAttribute("aria-labelledby"),
                "名前の無いランドマーク（読み上げで区別できない）").toBeTruthy();
        }
    });
});

describe("ホームに見出しがある", () => {
    it("狭い画面でも h1 が消えないよう、画面に出さない見出しを置く", () => {
        // 実装の該当箇所を読む（jsdom では `sm:hidden` を評価できないため）
        const src = readFileSync(join(__dirname, "..", "GalleryPageClient.tsx"), "utf8");
        const h1s = src.match(/<h1[^>]*>/g) ?? [];
        expect(h1s.length, "h1 が見当たらない").toBeGreaterThan(0);
        // 画面に出さない見出しが1つあり、広い画面では隠れる（重複しない）
        const srOnly = h1s.find((h) => h.includes("sr-only"));
        expect(srOnly, "狭い画面用の見出しが無い").toBeTruthy();
        expect(srOnly, "広い画面で見出しが2つになる").toContain("sm:hidden");
        // 見える方は今までどおり広い画面だけ
        expect(src).toContain('className="hidden sm:flex sm:flex-row');
    });
});
