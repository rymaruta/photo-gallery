import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SpotSearchResults from "../SpotSearchResults";
import { resetSpotSearchIndex } from "../../../lib/hooks/useSpotSearchIndex";

/**
 * **「さがす」の撮影スポットの節。** 写真が0枚でも撮影地ガイドへ案内する。
 * 索引は語を打ったときに初めて取りに行く（探さない人に 130KB を配らない）。
 */
const ROWS = [
    { s: "ginzan-onsen", n: "銀山温泉", r: "ぎんざんおんせん", g: "山形県 尾花沢市" },
    ...Array.from({ length: 8 }, (_, i) => ({ s: `yamagata-${i}`, n: `山形の場所${i}`, g: "山形県 山形市" })),
];
const fetchMock = vi.fn();

beforeEach(() => {
    resetSpotSearchIndex();
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ROWS });
    vi.stubGlobal("fetch", fetchMock);
});

describe("SpotSearchResults", () => {
    it("語が無ければ取りに行かず、何も出さない", () => {
        render(<SpotSearchResults query="" locale="ja" />);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.queryByTestId("search-spot-results")).toBeNull();
    });

    it("「銀山温泉」でガイドへのリンクを出す（写真の件数とは別の見出し）", async () => {
        render(<SpotSearchResults query="銀山温泉" locale="ja" />);
        const link = await screen.findByRole("link", { name: /銀山温泉/ });
        expect(link.getAttribute("href")).toBe("/spots/ginzan-onsen");
        expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("撮影スポット（1か所）");
        expect(fetchMock).toHaveBeenCalledWith("/app/data/spot-search.json");
    });

    it("当たりが多ければ5件で畳み、押すと全部出す", async () => {
        render(<SpotSearchResults query="山形" locale="ja" />);
        await screen.findByTestId("search-spot-results");
        expect(screen.getAllByRole("link")).toHaveLength(5);
        fireEvent.click(screen.getByRole("button", { name: /すべて表示/ }));
        expect(screen.getAllByRole("link")).toHaveLength(9);
    });

    it("当たりが無ければ節ごと出さない", async () => {
        render(<SpotSearchResults query="パリ" locale="ja" />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(screen.queryByTestId("search-spot-results")).toBeNull();
    });

    it("索引を読めなければ何も出さない（写真の結果はそのまま使える）", async () => {
        fetchMock.mockResolvedValue({ ok: false, json: async () => null });
        render(<SpotSearchResults query="銀山温泉" locale="ja" />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        expect(screen.queryByTestId("search-spot-results")).toBeNull();
    });

    // 1b658978 のレビュー 4: 失敗したら、打ち足したときに取り直す
    it("索引の取得に失敗しても、語を打ち足せば取り直す", async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, json: async () => null });
        const { rerender } = render(<SpotSearchResults query="銀山" locale="ja" />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        rerender(<SpotSearchResults query="銀山温泉" locale="ja" />);
        expect(await screen.findByRole("link", { name: /銀山温泉/ })).toBeTruthy();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("「人気」「評価」「枚数」を出さない", async () => {
        render(<SpotSearchResults query="山形" locale="ja" />);
        const sec = await screen.findByTestId("search-spot-results");
        expect(sec.textContent).not.toMatch(/人気|評価|枚/);
    });
});
