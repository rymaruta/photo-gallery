import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProMark, NameBadge } from "../ProfileNameMarks";

const AT = "2026-10-01T00:00:00.000Z";

describe("ProMark（名前の横の Pro の印）", () => {
    it("pro の人にだけ出す。形は iris（既定）/ plate", () => {
        const { container, rerender } = render(<ProMark pro locale="ja" />);
        expect(screen.getByRole("img", { name: "Pro メンバー" }).getAttribute("src")).toBe("/badges/pro-mark-iris.svg");
        rerender(<ProMark pro style="plate" locale="en" />);
        expect(screen.getByRole("img", { name: "Pro member" }).getAttribute("src")).toBe("/badges/pro-mark-plate.svg");
        rerender(<ProMark pro size={12} locale="ja" />);
        expect(container.querySelector("img")?.getAttribute("src")).toBe("/badges/pro-mark-iris-small.svg");
    });

    it("🔴 pro でなければ何も出さない（Web では何も売らない）", () => {
        const { container } = render(<><ProMark locale="ja" /><ProMark pro={false} locale="ja" /></>);
        expect(container.querySelector("[data-testid=pro-mark]")).toBeNull();
    });
});

describe("NameBadge（名前の横の、選んだメダル）", () => {
    const badges = { morning: { tier: 2, at: AT }, earlyUser: { tier: 1, at: AT }, first: { tier: 1, at: AT } };

    it("持っているメダルを 22.4px で出す（円を封印の 22px にそろえる）", () => {
        render(<NameBadge badges={badges} displayBadge="morning" ownerName="旅人" locale="ja" />);
        const btn = screen.getByRole("button", { name: /メダル: 朝の光（銀）/ });
        expect(btn.style.width).toBe("22.4px");
        expect(btn.querySelector("img")?.getAttribute("src")).toBe("/badges/medal-morning-2-s.webp");
    });

    it("初期ユーザー章は 30.8px で −4.4px はみ出させる（行の高さを変えない）", () => {
        render(<NameBadge badges={badges} displayBadge="earlyUser" ownerName="旅人" locale="ja" />);
        const btn = screen.getByTestId("name-badge");
        expect(btn.style.width).toBe("30.8px");
        expect(btn.style.margin).toBe("-4.4px");
        expect(btn.querySelector("img")?.getAttribute("src")).toBe("/badges/medal-earlyUser-s.webp");
    });

    it("持っていない・選んでいないなら何も出さない", () => {
        const { container } = render(<>
            <NameBadge badges={badges} displayBadge="wish" ownerName="旅人" locale="ja" />
            <NameBadge badges={badges} displayBadge={null} ownerName="旅人" locale="ja" />
            <NameBadge displayBadge="morning" ownerName="旅人" locale="ja" />
        </>);
        expect(container.querySelector("[data-testid=name-badge]")).toBeNull();
    });

    it("押すとその人のメダルの一覧を開き、Escape で閉じる", () => {
        render(<NameBadge badges={badges} displayBadge="morning" ownerName="旅人" locale="ja" />);
        fireEvent.click(screen.getByTestId("name-badge"));
        const dialog = screen.getByRole("dialog", { name: "旅人のメダル" });
        // 表の順（はじめての一枚 → 朝の光 → 初期ユーザー）
        const names = [...dialog.querySelectorAll("li p:first-child")].map((p) => p.textContent);
        expect(names).toEqual(["はじめての一枚", "朝の光（銀）", "初期ユーザー"]);
        expect(dialog.textContent).toContain("日の出の前後に50枚");
        fireEvent.keyDown(document, { key: "Escape" });
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("一覧は見出しの外（body）に出す", () => {
        render(<h1><NameBadge badges={badges} displayBadge="first" ownerName="旅人" locale="en" /></h1>);
        fireEvent.click(screen.getByTestId("name-badge"));
        const dialog = screen.getByRole("dialog", { name: "旅人's medals" });
        expect(dialog.closest("h1")).toBeNull();
    });
});
