import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **設定の Pro の節**（光と天気の知らせ・2026-10-11 owner）。
// - Pro でない人（自分のプロフィールの `pro` が偽）・読めなかったときは**節ごと出さない**
//   （Web では何も売らない＝入口も見せない）
// - Pro の人には一覧（/user/light）への行と「前の晩に知らせる」の入切
// - 入切は `PUT /user/profile` に `{ lightAlert }` だけを送る。失敗したら元に戻す

const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));

import LightAlertSettings from "../LightAlertSettings";

const profile = (body: Record<string, unknown>, put: { ok: boolean; status?: number } = { ok: true }) =>
    mockUserFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === "PUT") return { ok: put.ok, status: put.status ?? 200, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => body };
    });

beforeEach(() => { mockUserFetch.mockReset(); });

describe("設定: 光と天気の知らせ（Pro だけ）", () => {
    it("Pro でない人には節ごと出さない", async () => {
        profile({ userId: "u1", pro: false, lightAlert: true });
        const { container } = render(<LightAlertSettings locale="ja" />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalledWith("/user/profile"));
        await new Promise((r) => setTimeout(r, 0));
        expect(container.innerHTML).toBe("");
    });

    it("プロフィールが読めなければ出さない", async () => {
        mockUserFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        const { container } = render(<LightAlertSettings locale="ja" />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 0));
        expect(container.innerHTML).toBe("");
    });

    it("Pro の人には一覧への行と入切（今の値）を出す", async () => {
        profile({ userId: "u1", pro: true, lightAlert: false });
        render(<LightAlertSettings locale="ja" />);
        const link = await screen.findByRole("link", { name: /光と天気の知らせ/ });
        expect(link.getAttribute("href")).toBe("/user/light");
        const sw = screen.getByRole("switch", { name: "前の晩に知らせる" });
        expect(sw.getAttribute("aria-checked")).toBe("false");
        expect(sw.style.minHeight).toBe("44px");
    });

    it("入切を押すと lightAlert だけを送る", async () => {
        profile({ userId: "u1", pro: true, lightAlert: true });
        render(<LightAlertSettings locale="ja" />);
        const sw = await screen.findByRole("switch", { name: "前の晩に知らせる" });
        expect(sw.getAttribute("aria-checked")).toBe("true");
        await userEvent.click(sw);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalledWith("/user/profile", { method: "PUT", body: JSON.stringify({ lightAlert: false }) }));
        await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("false"));
    });

    it("送れなければ元に戻して理由を出す", async () => {
        profile({ userId: "u1", pro: true, lightAlert: true }, { ok: false, status: 500 });
        render(<LightAlertSettings locale="ja" />);
        const sw = await screen.findByRole("switch", { name: "前の晩に知らせる" });
        await userEvent.click(sw);
        expect(await screen.findByRole("alert")).toBeTruthy();
        expect(sw.getAttribute("aria-checked")).toBe("true");
    });

    it("2行の書き出しがそろう: 入切の行は、上の行の絵と同じ幅を頭に空ける（2026-10-11）", async () => {
        profile({ userId: "u1", pro: true, lightAlert: true });
        render(<LightAlertSettings locale="ja" />);
        const link = await screen.findByRole("link", { name: /光と天気の知らせ/ });
        const icon = link.querySelector("svg")!;
        const sw = screen.getByRole("switch", { name: "前の晩に知らせる" });
        const row = sw.parentElement!;
        const indent = row.firstElementChild as HTMLElement;
        expect(indent.getAttribute("data-testid")).toBe("light-alert-indent");
        expect(indent.style.width).toBe(`${icon.getAttribute("width")}px`);
        // 文の列はどちらも絵（空き）のすぐ後ろ
        expect(link.firstElementChild).toBe(icon);
    });
});
