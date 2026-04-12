import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useGallery from "../useGallery";
import type { Photo } from "../../data/photos";

const mockPhotos: Photo[] = [
    {
        id: "1",
        src: "a.jpg",
        title: { ja: "夜の街", en: "Night Street" },
        category: "street",
        tags: ["night", "urban"],
        date: "2024-03-01",
        likes: 10,
    },
    {
        id: "2",
        src: "b.jpg",
        title: { ja: "山の夕暮れ", en: "Mountain Sunset" },
        category: "landscape",
        tags: ["mountain"],
        date: "2024-01-15",
        likes: 5,
    },
    {
        id: "3",
        src: "c.jpg",
        title: { ja: "都市建築", en: "City Architecture" },
        category: "architecture",
        tags: ["urban", "building"],
        date: "2024-06-10",
        likes: 20,
    },
];

describe("useGallery", () => {
    describe("初期状態", () => {
        it("フィルタなしで全写真を返す", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            expect(result.current.filteredPhotos).toHaveLength(3);
        });

        it("デフォルトソートは新しい順（date 降順）", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            const dates = result.current.filteredPhotos.map((p) => p.date);
            expect(dates[0]).toBe("2024-06-10");
            expect(dates[1]).toBe("2024-03-01");
            expect(dates[2]).toBe("2024-01-15");
        });

        it("currentIndex の初期値は null", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            expect(result.current.currentIndex).toBeNull();
        });
    });

    describe("カテゴリフィルタ", () => {
        it("street カテゴリで絞り込める", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.setFilters({ category: "street" });
            });
            expect(result.current.filteredPhotos).toHaveLength(1);
            expect(result.current.filteredPhotos[0].id).toBe("1");
        });

        it("all に戻すと全件表示", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.setFilters({ category: "street" });
            });
            act(() => {
                result.current.setFilters({ category: "all" });
            });
            expect(result.current.filteredPhotos).toHaveLength(3);
        });
    });

    describe("タグフィルタ", () => {
        it("urban タグで絞り込める", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.setFilters({ selectedTags: ["urban"] });
            });
            expect(result.current.filteredPhotos).toHaveLength(2);
        });

        it("複数タグは AND 条件", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.setFilters({ selectedTags: ["urban", "building"] });
            });
            expect(result.current.filteredPhotos).toHaveLength(1);
            expect(result.current.filteredPhotos[0].id).toBe("3");
        });
    });

    describe("キーワード検索", () => {
        it("日本語タイトルで検索できる", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.setFilters({ query: "街" });
            });
            expect(result.current.filteredPhotos).toHaveLength(1);
            expect(result.current.filteredPhotos[0].id).toBe("1");
        });

        it("英語タイトルで検索できる", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.setFilters({ query: "sunset" });
            });
            expect(result.current.filteredPhotos).toHaveLength(1);
            expect(result.current.filteredPhotos[0].id).toBe("2");
        });

        it("クエリが空のときは全件", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.setFilters({ query: "" });
            });
            expect(result.current.filteredPhotos).toHaveLength(3);
        });
    });

    describe("ソート", () => {
        it("古い順（old）でソートできる", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.setFilters({ sort: "old" });
            });
            const dates = result.current.filteredPhotos.map((p) => p.date);
            expect(dates[0]).toBe("2024-01-15");
            expect(dates[2]).toBe("2024-06-10");
        });

        it("人気順（popular）でソートできる", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.setFilters({ sort: "popular" });
            });
            const likes = result.current.filteredPhotos.map((p) => p.likes);
            expect(likes[0]).toBe(20);
            expect(likes[2]).toBe(5);
        });
    });

    describe("モーダル操作", () => {
        it("open で currentIndex が設定される", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.open(1);
            });
            expect(result.current.currentIndex).toBe(1);
        });

        it("close で currentIndex が null になる", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.open(0);
            });
            act(() => {
                result.current.close();
            });
            expect(result.current.currentIndex).toBeNull();
        });

        it("next で次の index に進む", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.open(0);
            });
            act(() => {
                result.current.next();
            });
            expect(result.current.currentIndex).toBe(1);
        });

        it("prev で前の index に戻る", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.open(2);
            });
            act(() => {
                result.current.prev();
            });
            expect(result.current.currentIndex).toBe(1);
        });

        it("最後の次は先頭に循環する", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.open(2);
            });
            act(() => {
                result.current.next();
            });
            expect(result.current.currentIndex).toBe(0);
        });
    });
});
