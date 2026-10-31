import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * 「さがす」の並び（2026-10-31 束 1 S1・S2・S9・iOS の `SearchView`）:
 * 検索欄 → 対象のチップ（すべて・写真・人・タグ・撮影地）→［何も探していない間］発見の面／［探している間］チップ → 結果
 */
vi.mock("../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }) }));
vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: { category: { all: "すべて", names: {} }, site: { title: "Gallery" }, search: { placeholder: "写真を検索" }, sort: { label: "並べ替え", options: { new: "新しい順", old: "古い順", popular: "人気順" } } } }),
}));
vi.mock("../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
const grid = vi.hoisted(() => ({ ids: [] as string[], tiles: false }));
vi.mock("../components/GalleryGrid", () => ({
    default: ({ photos, searchTiles }: { photos: { id: string }[]; searchTiles?: boolean }) => {
        grid.ids = photos.map((p) => p.id); grid.tiles = !!searchTiles; return <div data-testid="grid" />;
    },
}));
vi.mock("../components/GalleryModal", () => ({ default: () => null }));
vi.mock("../components/SearchParamWatcher", () => ({ default: () => null }));
vi.mock("../search/SpotSearchResults", () => ({ default: () => <div data-testid="spot-results" /> }));
vi.mock("../search/DiscoverSections", () => ({ default: () => <div data-testid="discover" /> }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const PHOTOS = [
    { id: "p1", src: "https://cdn/a.jpg", title: "あ", category: "travel", tags: ["fuji"], location: "東京", date: "2026-01-01", createdAt: "2026-01-01" },
    { id: "p2", src: "https://cdn/b.jpg", title: "い", category: "food", date: "2026-01-02", createdAt: "2026-01-02" },
];
vi.mock("../../lib/hooks/usePhotos", () => ({ usePhotos: () => ({ photos: PHOTOS, loaded: true }) }));
vi.mock("../data/photos.json", () => ({ default: [] }));

const GalleryPageClient = (await import("../GalleryPageClient")).default;

describe("さがすの対象のチップ（S1）", () => {
    it("検索欄の下に すべて・写真・人・タグ・撮影地。「すべて」を選んで始まり、「人」は人を探す頁へ", () => {
        render(<GalleryPageClient surface="search" />);
        const scope = screen.getByTestId("search-scope");
        expect([...scope.children].map((c) => c.textContent)).toEqual(["すべて", "写真", "人", "タグ", "撮影地"]);
        expect(screen.getByRole("button", { name: "すべて" }).getAttribute("aria-pressed")).toBe("true");
        expect(screen.getByRole("link", { name: "人" }).getAttribute("href")).toBe("/users/search");
        const field = screen.getByRole("searchbox");
        expect(field.compareDocumentPosition(scope) & Node.DOCUMENT_POSITION_FOLLOWING, "検索欄が先").toBeTruthy();
    });

    it("何も探していない間は発見の面を出し、カテゴリ・タグのチップは出さない（S2・iOS の `isDiscovering`）", () => {
        render(<GalleryPageClient surface="search" />);
        expect(screen.getByTestId("discover")).toBeTruthy();
        expect(screen.queryByTestId("search-category-chips")).toBeNull();
        expect(screen.queryByTestId("filter-tag-chips")).toBeNull();
    });

    it("「タグ」を選ぶと発見の面を閉じ、タグのチップとタグのある写真だけ", () => {
        render(<GalleryPageClient surface="search" />);
        fireEvent.click(screen.getByRole("button", { name: "タグ" }));
        expect(screen.queryByTestId("discover")).toBeNull();
        expect(screen.getByTestId("filter-tag-chips")).toBeTruthy();
        expect(screen.queryByTestId("search-category-chips")).toBeNull();
        expect(grid.ids).toEqual(["p1"]);
    });

    it("「撮影地」は撮影地のある写真だけ・撮影スポットの結果も出す。「写真」は撮影スポットの結果を出さない", () => {
        render(<GalleryPageClient surface="search" />);
        fireEvent.click(screen.getByRole("button", { name: "撮影地" }));
        expect(grid.ids).toEqual(["p1"]);
        expect(screen.getByTestId("spot-results")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "写真" }));
        expect(screen.queryByTestId("spot-results")).toBeNull();
        expect(screen.getByTestId("search-category-chips")).toBeTruthy();
    });

    it("結果の見出し: 件数（13・text-2）と、右に並べ替えの置き場。写真の札は iOS の形（S9）", () => {
        render(<GalleryPageClient surface="search" />);
        const head = screen.getByTestId("search-results-head");
        expect(head.querySelector("p")!.textContent).toBe("結果: 2 件");
        expect(head.querySelector("#search-sort-slot")).toBeTruthy();
        expect(grid.tiles).toBe(true);
    });
});
