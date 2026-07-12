import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RankingCard, { podiumOrder } from "../RankingCard";

beforeEach(() => localStorage.clear());

describe("podiumOrder", () => {
    it("0件は空", () => {
        expect(podiumOrder(0)).toEqual([]);
    });

    it("1件は1位のみ", () => {
        expect(podiumOrder(1)).toEqual([0]);
    });

    it("2件は 2位 → 1位", () => {
        expect(podiumOrder(2)).toEqual([1, 0]);
    });

    it("3件以上は 2位 → 1位 → 3位（表彰台の並び）", () => {
        expect(podiumOrder(3)).toEqual([1, 0, 2]);
        expect(podiumOrder(5)).toEqual([1, 0, 2]);
    });
});

describe("RankingCard", () => {
    const items = ["白川郷", "屋久島", "宮島", "美瑛", "直島"];

    it("items が空なら何も描画しない", () => {
        const { container } = render(<RankingCard items={[]} />);
        expect(container.firstChild).toBeNull();
    });

    it("お題（title）を表示する", () => {
        render(<RankingCard title="行ってよかった絶景" items={items} />);
        expect(screen.getByText("行ってよかった絶景")).toBeInTheDocument();
    });

    it("title がなければ既定の見出しを出す（ja / en）", () => {
        const { unmount } = render(<RankingCard items={items} locale="ja" />);
        expect(screen.getByText("マイランキング")).toBeInTheDocument();
        unmount();
        render(<RankingCard items={items} locale="en" />);
        expect(screen.getByText("My Ranking")).toBeInTheDocument();
    });

    it("TOP n バッジを項目数で表示する", () => {
        render(<RankingCard items={items} />);
        expect(screen.getByText("TOP 5")).toBeInTheDocument();
    });

    it("全項目が表示され、上位3位はメダル（1位/2位/3位ラベル）を持つ", () => {
        render(<RankingCard items={items} locale="ja" />);
        for (const item of items) expect(screen.getByText(item)).toBeInTheDocument();
        // メダルとその下の表彰台ラベルで各順位2回ずつ現れる
        expect(screen.getAllByLabelText("1位").length).toBe(1);
        expect(screen.getAllByLabelText("2位").length).toBe(1);
        expect(screen.getAllByLabelText("3位").length).toBe(1);
    });

    it("4位以下はリスト行に番号付きで表示する", () => {
        render(<RankingCard items={items} />);
        expect(screen.getByText("4")).toBeInTheDocument();
        expect(screen.getByText("5")).toBeInTheDocument();
    });

    it("1件だけでも描画できる（1位のみ）", () => {
        render(<RankingCard items={["白川郷"]} locale="ja" />);
        expect(screen.getByText("白川郷")).toBeInTheDocument();
        expect(screen.getByText("TOP 1")).toBeInTheDocument();
        expect(screen.queryByLabelText("2位")).toBeNull();
    });

    it("英語ロケールでは 1st/2nd/3rd 表記", () => {
        render(<RankingCard items={items} locale="en" />);
        expect(screen.getByLabelText("1st")).toBeInTheDocument();
        expect(screen.getByLabelText("2nd")).toBeInTheDocument();
        expect(screen.getByLabelText("3rd")).toBeInTheDocument();
    });

    it("ヘッダータップで折りたたみ・再タップで展開できる（お題は常に見える）", () => {
        render(<RankingCard title="今行きたい国" items={items} />);
        const header = screen.getByRole("button", { expanded: true });
        fireEvent.click(header);
        expect(screen.queryByText("白川郷")).toBeNull();
        expect(screen.getByText("今行きたい国")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { expanded: false }));
        expect(screen.getByText("白川郷")).toBeInTheDocument();
    });

    it("折りたたみ状態を localStorage に記憶し、次回は閉じた状態で始まる", () => {
        const { unmount } = render(<RankingCard items={items} />);
        fireEvent.click(screen.getByRole("button", { expanded: true }));
        expect(localStorage.getItem("jp_ranking_open")).toBe("0");
        unmount();
        render(<RankingCard items={items} />);
        expect(screen.queryByText("白川郷")).toBeNull();
        expect(screen.getByRole("button", { expanded: false })).toBeInTheDocument();
    });
});
