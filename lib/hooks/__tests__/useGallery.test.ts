import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useGallery from "../useGallery";
import type { Photo } from "../../data/photos";

// URLのフィルター同期（useEffect）がテスト間で状態汚染しないようリセット
beforeEach(() => {
    window.history.replaceState({}, "", "/");
});

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

        // 集約ページの404救済は /location/<スラッグ> を `/?q=<スラッグ>` に
        // 振り替える。スラッグは空白をハイフンに潰してあるので、生の includes
        // だけだと**多語の撮影地が必ず「該当なし」**に落ちていた
        // （"フランス ヴェルサイユ".includes("フランス-ヴェルサイユ") は false）。
        // タグ側は tagSlug を両側にかけて解決済み。location も両側を
        // 同じ正規化で比べる。
        it("スラッグ形（空白→ハイフン）のクエリでも撮影地に一致する", () => {
            const photos = [
                { ...mockPhotos[0], id: "loc1", location: "フランス ヴェルサイユ" },
                { ...mockPhotos[1], id: "loc2", location: "Mount Fuji" },
                { ...mockPhotos[2], id: "loc3", location: "東京" },
            ];
            const { result } = renderHook(() => useGallery(photos));
            act(() => {
                result.current.setFilters({ query: "フランス-ヴェルサイユ" });
            });
            expect(result.current.filteredPhotos.map((p) => p.id)).toEqual(["loc1"]);

            act(() => {
                result.current.setFilters({ query: "mount-fuji" });
            });
            expect(result.current.filteredPhotos.map((p) => p.id)).toEqual(["loc2"]);
        });

        it("生の撮影地でも従来どおり検索できる（壊していない）", () => {
            const photos = [
                { ...mockPhotos[0], id: "loc1", location: "フランス ヴェルサイユ" },
                { ...mockPhotos[1], id: "loc2", location: "東京" },
            ];
            const { result } = renderHook(() => useGallery(photos));
            act(() => {
                result.current.setFilters({ query: "ヴェルサイユ" });
            });
            expect(result.current.filteredPhotos.map((p) => p.id)).toEqual(["loc1"]);
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

    describe("URL 同期（?photo=）", () => {
        // 共有リンク /?photo=<id> で開いても、フィルタ同期の replaceState が
        // ?photo= を消していた。見えている写真とアドレスバーが食い違い、
        // 再読込・ブックマーク・アドレスバーのコピーのどれでも戻れなかった。
        it("モーダルを開くと ?photo= がURLに載る", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => { result.current.open(0); });
            expect(new URLSearchParams(window.location.search).get("photo"))
                .toBe(result.current.filteredPhotos[0].id);
        });

        it("閉じると ?photo= が消える", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => { result.current.open(0); });
            act(() => { result.current.close(); });
            expect(new URLSearchParams(window.location.search).get("photo")).toBeNull();
        });

        it("前後に送ると ?photo= も追従する", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => { result.current.open(0); });
            act(() => { result.current.next(); });
            expect(new URLSearchParams(window.location.search).get("photo"))
                .toBe(result.current.filteredPhotos[1].id);
        });

        it("フィルタと同時に載る（どちらも失わない）", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => { result.current.setFilters({ category: "landscape" }); });
            act(() => { result.current.open(0); });
            const params = new URLSearchParams(window.location.search);
            expect(params.get("category")).toBe("landscape");
            expect(params.get("photo")).toBe(result.current.filteredPhotos[0].id);
        });
    });

    describe("openById（?photo= からの復元）", () => {
        it("IDで開ける", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            let ok = false;
            act(() => { ok = result.current.openById("3"); });
            expect(ok).toBe(true);
            expect(result.current.filteredPhotos[result.current.currentIndex!].id).toBe("3");
        });

        it("一覧に無いIDでは何も起きない（false を返す）", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            let ok = true;
            act(() => { ok = result.current.openById("nope"); });
            expect(ok).toBe(false);
            expect(result.current.currentIndex).toBeNull();
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
