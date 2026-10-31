import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MoreMenu from "../MoreMenu";

describe("MoreMenu（⋯）", () => {
    const items = [
        { key: "a", label: "リンクをコピー", onSelect: vi.fn() },
        { key: "b", label: "この投稿を通報する", onSelect: vi.fn(), danger: true },
    ];

    it("押すと一覧、選ぶと閉じて onSelect", () => {
        render(<MoreMenu items={items} label="その他" />);
        const btn = screen.getByRole("button", { name: "その他" });
        expect(btn.getAttribute("aria-expanded")).toBe("false");
        fireEvent.click(btn);
        expect(btn.getAttribute("aria-expanded")).toBe("true");
        fireEvent.click(screen.getByRole("menuitem", { name: "この投稿を通報する" }));
        expect(items[1].onSelect).toHaveBeenCalled();
        expect(screen.queryByRole("menu")).toBeNull();
    });

    it("Escape で閉じてボタンへ戻る。外側を押しても閉じる", () => {
        render(<div><MoreMenu items={items} label="その他" /><p>外</p></div>);
        const btn = screen.getByRole("button", { name: "その他" });
        fireEvent.click(btn);
        fireEvent.keyDown(document, { key: "Escape" });
        expect(screen.queryByRole("menu")).toBeNull();
        expect(document.activeElement).toBe(btn);
        fireEvent.click(btn);
        fireEvent.pointerDown(screen.getByText("外"));
        expect(screen.queryByRole("menu")).toBeNull();
    });

    it("項目が無ければボタンごと出さない（押しても何も無いボタンを置かない）", () => {
        const { container } = render(<MoreMenu items={[]} label="その他" />);
        expect(container.querySelector("button")).toBeNull();
    });

    it("危険な項目は赤", () => {
        render(<MoreMenu items={items} label="その他" />);
        fireEvent.click(screen.getByRole("button", { name: "その他" }));
        expect(screen.getByRole("menuitem", { name: "この投稿を通報する" }).className).toContain("text-danger");
        expect(screen.getByRole("menuitem", { name: "リンクをコピー" }).className).not.toContain("text-danger");
    });
});

// 2026-10-31 束 1: 行き先を持つ項目はリンクで描く（写真の詳細の「撮影地マップで見る」「Google マップで開く」）
it("href を持つ項目はリンク（外のサイトは別のタブ）。押すとメニューは閉じる", () => {
    render(<MoreMenu label="その他" items={[
        { key: "map", label: "撮影地マップで見る", href: "/map#12/1/2" },
        { key: "g", label: "Google マップで開く", href: "https://maps.google.com/?q=1,2", external: true },
    ]} />);
    fireEvent.click(screen.getByRole("button", { name: "その他" }));
    const map = screen.getByRole("menuitem", { name: "撮影地マップで見る" });
    expect(map.tagName).toBe("A");
    expect(map.getAttribute("href")).toBe("/map#12/1/2");
    const g = screen.getByRole("menuitem", { name: "Google マップで開く" });
    expect(g.getAttribute("target")).toBe("_blank");
    expect(g.getAttribute("rel")).toContain("noopener");
    fireEvent.click(g);
    expect(screen.queryByRole("menu")).toBeNull();
});
