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
