import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { ToastProvider, useToast } from "../useToast";

function wrapper({ children }: { children: React.ReactNode }) {
    return <ToastProvider>{children}</ToastProvider>;
}

describe("useToast", () => {
    it("Provider 外で呼ぶとエラー", () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(() => renderHook(() => useToast())).toThrow("useToast must be used within a ToastProvider");
        spy.mockRestore();
    });

    it("初期状態はトーストなし", () => {
        const { result } = renderHook(() => useToast(), { wrapper });
        expect(result.current.toasts).toHaveLength(0);
    });

    it("showToast でトーストが追加される", () => {
        const { result } = renderHook(() => useToast(), { wrapper });
        act(() => { result.current.showToast("テストメッセージ", "success"); });
        expect(result.current.toasts).toHaveLength(1);
        expect(result.current.toasts[0].message).toBe("テストメッセージ");
        expect(result.current.toasts[0].type).toBe("success");
    });

    it("removeToast で指定した ID のトーストを削除する", () => {
        const { result } = renderHook(() => useToast(), { wrapper });
        act(() => { result.current.showToast("msg1"); });
        act(() => { result.current.showToast("msg2"); });
        expect(result.current.toasts).toHaveLength(2);

        const id = result.current.toasts[0].id;
        act(() => { result.current.removeToast(id); });
        expect(result.current.toasts).toHaveLength(1);
        expect(result.current.toasts[0].message).toBe("msg2");
    });

    it("type のデフォルトは success", () => {
        const { result } = renderHook(() => useToast(), { wrapper });
        act(() => { result.current.showToast("hello"); });
        expect(result.current.toasts[0].type).toBe("success");
    });

    it("error / info タイプを指定できる", () => {
        const { result } = renderHook(() => useToast(), { wrapper });
        act(() => { result.current.showToast("err", "error"); });
        act(() => { result.current.showToast("inf", "info"); });
        const types = result.current.toasts.map((t) => t.type);
        expect(types).toContain("error");
        expect(types).toContain("info");
    });

    it("duration=0 はタイマーを設定しない（手動削除のみ）", () => {
        vi.useFakeTimers();
        const { result } = renderHook(() => useToast(), { wrapper });
        act(() => { result.current.showToast("sticky", "info", 0); });
        act(() => { vi.advanceTimersByTime(10000); });
        expect(result.current.toasts).toHaveLength(1);
        vi.useRealTimers();
    });

    it("duration 経過後にトーストが自動消去される", () => {
        vi.useFakeTimers();
        const { result } = renderHook(() => useToast(), { wrapper });
        act(() => { result.current.showToast("auto", "success", 2000); });
        expect(result.current.toasts).toHaveLength(1);
        act(() => { vi.advanceTimersByTime(2001); });
        expect(result.current.toasts).toHaveLength(0);
        vi.useRealTimers();
    });
});
