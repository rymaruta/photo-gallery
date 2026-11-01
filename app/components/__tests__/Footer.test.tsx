import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ROUTES } from "@/lib/routes";

vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: {} }) }));

const Footer = (await import("../Footer")).default;

describe("フッターの導線", () => {
    it("撮影地マップへのリンクを出す（メニューの中にしか無かった）", () => {
        render(<Footer />);
        const links = screen.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);
        // 並びごと見る（`toContainEqual` の羅列だと順序の入れ替えが素通りする）
        expect(links).toEqual([
            ["作品", ROUTES.HOME],
            ["撮影地マップ", ROUTES.MAP],
            // 公式撮影地ガイドの索引。**写真の投稿が0枚の場所も載る**面なので、
            // 写真の集約（`/location`）とは別に入口が要る。撮影地マップの隣
            // （どちらも「場所から探す」）
            ["撮影スポット", ROUTES.SPOTS],
            ["いいねした写真", ROUTES.FAVORITES],
            // **いいねの隣に置く。** 別の棚だと分かるのは並んでいるとき
            ["保存した写真", ROUTES.SAVES],
            // **行きたい場所はいいねの隣**（どちらも「自分が取っておいたもの」）。
            // 入口がスポット詳細のボタンしか無いと、押したあとに見に行く場所が無い
            ["行きたい場所", ROUTES.SAVED_SPOTS],
            ["利用規約", ROUTES.TERMS],
            ["プライバシーポリシー", ROUTES.PRIVACY],
        ]);
    });
});

// 押す的は高さ44px・字は 13px（2026-10-30・束 0a・比較の板 C15。iOS の minTapTarget 44・footnote 13）。
// 以前は 24px（WCAG 2.5.8 の下限）で、字は電話の幅で 10.5px に縮んでいた
describe("フッターのリンクの押す的と字", () => {
    it("全部のリンクが最低 44px の高さを持つ", () => {
        render(<Footer />);
        const links = screen.getAllByRole("link");
        expect(links.length).toBeGreaterThan(3);
        for (const a of links) expect(a.className.split(/\s+/), a.textContent!).toEqual(expect.arrayContaining(["inline-flex", "min-h-[44px]"]));
        // 行の間隔は的の高さで取る（行の隙間を足すと、的どうしの間が空きすぎる・フッターが伸びる）
        const nav = links[0].parentElement!;
        expect(nav.className, "行の隙間を重ねて足している").not.toMatch(/(^|\s)gap-y-/);
    });

    it("ナビのリンクの字は px で 13（rem の段に頼らない）", () => {
        render(<Footer />);
        const nav = screen.getByRole("navigation");
        for (const a of Array.from(nav.querySelectorAll("a"))) {
            expect((a as HTMLElement).style.fontSize, a.textContent!).toBe("13px");
            expect(a.className).not.toMatch(/(^|\s)text-(xs|sm)(\s|$)/);
        }
    });
});
