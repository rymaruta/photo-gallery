import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useViewHistory } from "../useViewHistory";

const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => { store[key] = value; },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { store = {}; },
    };
})();
Object.defineProperty(window, "localStorage", { value: localStorageMock });

const STORAGE_KEY = "photo-gallery-view-history";

beforeEach(() => localStorageMock.clear());

describe("useViewHistory", () => {
    it("初期値は空配列", () => {
        const { result } = renderHook(() => useViewHistory());
        expect(result.current.history).toEqual([]);
    });

    it("localStorage に保存済みの履歴を読み込む", () => {
        const saved = [{ photoId: "p1", viewedAt: new Date().toISOString() }];
        localStorageMock.setItem(STORAGE_KEY, JSON.stringify(saved));
        const { result } = renderHook(() => useViewHistory());
        expect(result.current.history).toHaveLength(1);
        expect(result.current.history[0].photoId).toBe("p1");
    });

    describe("addToHistory", () => {
        it("写真 ID を履歴に追加する", () => {
            const { result } = renderHook(() => useViewHistory());
            act(() => { result.current.addToHistory("photo1"); });
            expect(result.current.history.map((h) => h.photoId)).toContain("photo1");
        });

        it("同じ ID を追加すると重複せず先頭に移動する", () => {
            const { result } = renderHook(() => useViewHistory());
            act(() => { result.current.addToHistory("a"); });
            act(() => { result.current.addToHistory("b"); });
            act(() => { result.current.addToHistory("a"); });
            const ids = result.current.history.map((h) => h.photoId);
            expect(ids[0]).toBe("a");
            expect(ids.filter((id) => id === "a").length).toBe(1);
        });

        it("localStorage に保存される", () => {
            const { result } = renderHook(() => useViewHistory());
            act(() => { result.current.addToHistory("pX"); });
            const stored = JSON.parse(localStorageMock.getItem(STORAGE_KEY)!);
            expect(stored.some((h: { photoId: string }) => h.photoId === "pX")).toBe(true);
        });
    });

    describe("removeFromHistory", () => {
        it("指定した ID を削除する", () => {
            const { result } = renderHook(() => useViewHistory());
            act(() => { result.current.addToHistory("r1"); });
            act(() => { result.current.addToHistory("r2"); });
            act(() => { result.current.removeFromHistory("r1"); });
            expect(result.current.history.map((h) => h.photoId)).not.toContain("r1");
        });
    });

    describe("clearHistory", () => {
        it("全履歴を削除する", () => {
            const { result } = renderHook(() => useViewHistory());
            act(() => { result.current.addToHistory("x"); });
            act(() => { result.current.clearHistory(); });
            expect(result.current.history).toEqual([]);
            expect(JSON.parse(localStorageMock.getItem(STORAGE_KEY)!)).toEqual([]);
        });
    });

    describe("50件上限", () => {
        it("50件を超えると古い履歴が切り捨てられる", () => {
            const { result } = renderHook(() => useViewHistory());
            for (let i = 0; i < 55; i++) {
                act(() => { result.current.addToHistory(`p${i}`); });
            }
            expect(result.current.history.length).toBe(50);
        });
    });

    describe("日付ソート", () => {
        it("新しい順に並ぶ", () => {
            const items = [
                { photoId: "old", viewedAt: "2024-01-01T00:00:00.000Z" },
                { photoId: "new", viewedAt: "2024-12-31T00:00:00.000Z" },
            ];
            localStorageMock.setItem(STORAGE_KEY, JSON.stringify(items));
            const { result } = renderHook(() => useViewHistory());
            expect(result.current.history[0].photoId).toBe("new");
        });
    });
});
