import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "../../../lib/hooks/useToast";

/**
 * 「行きたい」ボタン。
 *
 * ここで固定したいのは、**3つの状態を混ぜないこと**:
 *
 *   まだ分からない … 押させない
 *   聞けなかった   … 押させない（**「保存していない」と混ぜない**）
 *   ログイン済み   … 押せる
 *
 * 混ぜると、保存済みのスポットが「行きたい」と表示され、押すと解除では
 * なく保存が飛ぶ——**その場で解除できない**状態になる。
 */
const auth = vi.hoisted(() => ({ isAuthenticated: true, loading: false }));
vi.mock("../../auth/context", () => ({ useAuth: () => auth }));

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/utils/api", () => ({ userFetch: fetchMock }));

import SaveSpotButton from "../SaveSpotButton";

const render = (ui: React.ReactElement) => rtlRender(<ToastProvider>{ui}</ToastProvider>);
const ok = (slugs: string[]) => ({ ok: true, json: async () => ({ slugs }) });

beforeEach(() => {
    fetchMock.mockReset();
    auth.isAuthenticated = true;
    auth.loading = false;
});

describe("行きたいボタン", () => {
    it("保存していなければ「行きたい」、押せる", async () => {
        fetchMock.mockResolvedValue(ok([]));
        render(<SaveSpotButton slug="パリ" name="パリ" locale="ja" />);
        const btn = await screen.findByRole("button", { name: "行きたい" });
        expect(btn).not.toBeDisabled();
        expect(btn.getAttribute("aria-pressed")).toBe("false");
    });

    it("保存済みなら「保存済み」", async () => {
        fetchMock.mockResolvedValue(ok(["パリ"]));
        render(<SaveSpotButton slug="パリ" name="パリ" locale="ja" />);
        const btn = await screen.findByRole("button", { name: "保存済み" });
        expect(btn.getAttribute("aria-pressed")).toBe("true");
    });

    // **まだ分からない間は押させない**（`aria-pressed` も名乗らない）
    it("読み込み中は押せず、押されているとも名乗らない", () => {
        fetchMock.mockReturnValue(new Promise(() => { /* 返らない */ }));
        render(<SaveSpotButton slug="パリ" name="パリ" locale="ja" />);
        const btn = screen.getByRole("button", { name: "読み込み中…" });
        expect(btn).toBeDisabled();
        expect(btn.getAttribute("aria-pressed")).toBeNull();
    });

    /**
     * **聞けなかった回を「保存していない」と混ぜない。**
     *
     * 一度 `pending` だけを見ていたので、失敗すると保存済みのスポットが
     * 「行きたい」と表示され、`aria-pressed=false` と読み上げられ、
     * 押すと解除ではなく保存が飛んでいた。
     */
    it("取得に失敗したら、押させず・押されているとも名乗らず・事情を出す", async () => {
        fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
        render(<SaveSpotButton slug="パリ" name="パリ" locale="ja" />);
        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toContain("読み込めませんでした");
        const btn = screen.getByRole("button", { name: "読み込み中…" });
        expect(btn).toBeDisabled();
        expect(btn.getAttribute("aria-pressed")).toBeNull();
    });

    it("押すと保存され、サーバーが返した一覧を映す", async () => {
        fetchMock.mockResolvedValueOnce(ok([]));
        render(<SaveSpotButton slug="パリ" name="パリ" locale="ja" />);
        const btn = await screen.findByRole("button", { name: "行きたい" });
        fetchMock.mockResolvedValueOnce(ok(["パリ"]));
        btn.click();
        await waitFor(() => expect(screen.getByRole("button", { name: "保存済み" })).toBeTruthy());
        expect(fetchMock).toHaveBeenLastCalledWith("/user/spots", expect.objectContaining({ method: "POST" }));
    });

    // 未ログインは**ボタンではなくログインへのリンク**（押してから断らない）
    it("未ログインならログインへのリンクを出し、聞きに行かない", () => {
        auth.isAuthenticated = false;
        render(<SaveSpotButton slug="パリ" name="パリ" locale="ja" />);
        const link = screen.getByRole("link", { name: "行きたい" });
        expect(link.getAttribute("href")).toContain("/login");
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
