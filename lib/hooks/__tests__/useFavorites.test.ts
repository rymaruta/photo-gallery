import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFavorites, resetFavoritesCache } from "../useFavorites";

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

beforeEach(() => {
    localStorageMock.clear();
    // 保存済みの値はモジュール内にキャッシュされる（useSyncExternalStore は
    // 参照が安定したスナップショットを要求するため）。テスト間で持ち越さない。
    resetFavoritesCache();
});

describe("useFavorites", () => {
    it("初期値は空配列", () => {
        const { result } = renderHook(() => useFavorites());
        expect(result.current.favorites).toEqual([]);
    });

    it("localStorage に保存済みのお気に入りを読み込む", () => {
        localStorageMock.setItem("photo-gallery-favorites", JSON.stringify(["id1", "id2"]));
        const { result } = renderHook(() => useFavorites());
        expect(result.current.favorites).toEqual(["id1", "id2"]);
    });

    describe("isFavorite", () => {
        it("お気に入りに含まれている ID は true を返す", () => {
            localStorageMock.setItem("photo-gallery-favorites", JSON.stringify(["abc"]));
            const { result } = renderHook(() => useFavorites());
            expect(result.current.isFavorite("abc")).toBe(true);
        });

        it("含まれていない ID は false を返す", () => {
            const { result } = renderHook(() => useFavorites());
            expect(result.current.isFavorite("xyz")).toBe(false);
        });
    });

    describe("toggleFavorite", () => {
        it("未登録の ID を追加する", () => {
            const { result } = renderHook(() => useFavorites());
            act(() => { result.current.toggleFavorite("p1"); });
            expect(result.current.favorites).toContain("p1");
        });

        it("登録済みの ID を削除する", () => {
            localStorageMock.setItem("photo-gallery-favorites", JSON.stringify(["p1"]));
            const { result } = renderHook(() => useFavorites());
            act(() => { result.current.toggleFavorite("p1"); });
            expect(result.current.favorites).not.toContain("p1");
        });

        it("localStorage に反映される", () => {
            const { result } = renderHook(() => useFavorites());
            act(() => { result.current.toggleFavorite("p2"); });
            const stored = JSON.parse(localStorageMock.getItem("photo-gallery-favorites")!);
            expect(stored).toContain("p2");
        });
    });

    describe("clearFavorites", () => {
        it("全お気に入りを削除する", () => {
            localStorageMock.setItem("photo-gallery-favorites", JSON.stringify(["a", "b"]));
            const { result } = renderHook(() => useFavorites());
            act(() => { result.current.clearFavorites(); });
            expect(result.current.favorites).toEqual([]);
            expect(JSON.parse(localStorageMock.getItem("photo-gallery-favorites")!)).toEqual([]);
        });
    });
});
