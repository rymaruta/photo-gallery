import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// api モジュール（publicFetch / userFetch）をモック
const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../utils/api", () => ({
    publicFetch: (...a: unknown[]) => mockPublicFetch(...a),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));

import { useGoTo, resetGoCache } from "../useGoTo";

beforeEach(() => {
    mockPublicFetch.mockReset();
    mockUserFetch.mockReset();
    resetGoCache();
    // デフォルト: 公開カウント取得は失敗（0のまま）、行きたいリストは空
    mockPublicFetch.mockResolvedValue({ ok: false });
    mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
});

afterEach(() => vi.clearAllMocks());

describe("useGoTo", () => {
    it("初期状態: 未「行く」・カウント0", () => {
        const { result } = renderHook(() => useGoTo("p1", true));
        expect(result.current.going).toBe(false);
        expect(result.current.goCount).toBe(0);
        expect(result.current.moved).toBe(0);
    });

    it("公開カウント（goCount / moved）を取得して表示する", async () => {
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ goCount: 7, moved: 3 }) });
        const { result } = renderHook(() => useGoTo("p1", false));
        await waitFor(() => expect(result.current.goCount).toBe(7));
        expect(result.current.moved).toBe(3);
    });

    it("自分の行きたいリストに入っていれば going=true で始まる", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ items: [{ photoId: "p1", src: "/x.jpg", t: "2026-01-01" }] }) });
        const { result } = renderHook(() => useGoTo("p1", true));
        await waitFor(() => expect(result.current.going).toBe(true));
    });

    it("未ログインで toggle すると auth-required を返し、状態は変わらない", async () => {
        const { result } = renderHook(() => useGoTo("p1", false));
        let r: string = "";
        await act(async () => { r = await result.current.toggle(); });
        expect(r).toBe("auth-required");
        expect(result.current.going).toBe(false);
    });

    it("toggle で POST → going=true・カウント+1（サーバー値で確定）", async () => {
        const { result } = renderHook(() => useGoTo("p1", true));
        await waitFor(() => expect(result.current.pending).toBe(false));
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ going: true, goCount: 5 }) });
        let r: string = "";
        await act(async () => { r = await result.current.toggle(); });
        expect(r).toBe("added");
        expect(result.current.going).toBe(true);
        expect(result.current.goCount).toBe(5);
        const [path, opts] = mockUserFetch.mock.calls.at(-1) as [string, RequestInit];
        expect(path).toBe("/photos/p1/go");
        expect(opts.method).toBe("POST");
    });

    it("解除は DELETE で going=false", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ items: [{ photoId: "p1", src: "/x.jpg", t: "2026-01-01" }] }) });
        const { result } = renderHook(() => useGoTo("p1", true));
        await waitFor(() => expect(result.current.going).toBe(true));
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ going: false, goCount: 0 }) });
        let r: string = "";
        await act(async () => { r = await result.current.toggle(); });
        expect(r).toBe("removed");
        expect(result.current.going).toBe(false);
        const [, opts] = mockUserFetch.mock.calls.at(-1) as [string, RequestInit];
        expect(opts.method).toBe("DELETE");
    });

    it("サーバーエラー時は楽観更新を巻き戻す", async () => {
        const { result } = renderHook(() => useGoTo("p1", true));
        await waitFor(() => expect(result.current.pending).toBe(false));
        mockUserFetch.mockResolvedValue({ ok: false, status: 500 });
        let r: string = "";
        await act(async () => { r = await result.current.toggle(); });
        expect(r).toBe("error");
        expect(result.current.going).toBe(false);
        expect(result.current.goCount).toBe(0);
    });
});
