import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import MedalShelf, { MedalName, formatMedalDate } from "../MedalShelf";

// メダルの棚の文字が「1字だけ次の行に落ちる」のを防ぐ（2026-10-11 見本のデータの画面写真で見つけた）。
// 3列の札（390px で中の幅 約 87px）で「2026年3月15／日」「続けた年（1年／目）」と折れていた。

describe("取った日は短い形・折り返さない", () => {
    it("板の数字の書き方（2026.03.15）。日本時間で数える", () => {
        expect(formatMedalDate("2026-03-15T00:00:00.000Z")).toBe("2026.03.15");
        // 日本時間では翌日
        expect(formatMedalDate("2026-03-14T16:00:00.000Z")).toBe("2026.03.15");
        expect(formatMedalDate("not a date")).toBe("");
    });

    it("棚の日付の行は折り返さない（whitespace-nowrap）", () => {
        const { getByTestId } = render(
            <MedalShelf locale="ja" items={[{ key: "prefectures", tier: 2, owned: true, label: "都道府県（銀）", sub: "30の都道府県で撮った", at: "2026-03-15T00:00:00.000Z" }]} />,
        );
        const date = getByTestId("medal-shelf-date");
        expect(date.textContent).toBe("2026.03.15");
        expect(date.className).toContain("whitespace-nowrap");
        // 説明は行の長さをならす（最後の行に1字だけ残さない）
        expect(getByTestId("medal-shelf-sub").className).toContain("text-balance");
    });
});

describe("名前の段の部分はひとかたまりで折る", () => {
    it("「続けた年（1年目）」は（1年目）を折らない", () => {
        const { container, getByTestId } = render(<p><MedalName label="続けた年（1年目）" /></p>);
        expect(container.textContent).toBe("続けた年（1年目）");
        const tier = getByTestId("medal-name-tier");
        expect(tier.textContent).toBe("（1年目）");
        expect(tier.className).toContain("whitespace-nowrap");
    });

    it("英語の「 · 段」も同じ。段の無い名前はそのまま", () => {
        const { container, getByTestId, rerender } = render(<p><MedalName label="Years of support · Year 1" /></p>);
        expect(container.textContent).toBe("Years of support · Year 1");
        expect(getByTestId("medal-name-tier").textContent).toBe("· Year 1");
        rerender(<p><MedalName label="最初の一枚" /></p>);
        expect(container.textContent).toBe("最初の一枚");
        expect(container.querySelector("[data-testid=medal-name-tier]")).toBeNull();
    });

    it("棚の札の名前はこの部品で組む", () => {
        const { getByTestId } = render(
            <MedalShelf locale="ja" items={[{ key: "supporterYear", tier: 1, owned: true, label: "続けた年（1年目）", sub: "" }]} />,
        );
        expect(getByTestId("medal-name-tier").textContent).toBe("（1年目）");
    });
});
