// lib/types/gallery.ts
// ギャラリー関連の型定義

export type GalleryFilters = {
    category: string;
    selectedTags: string[];
    query: string;
    sort: "new" | "old" | "popular";
    /**
     * 誰の・どの写真を見るか（トップのタブ）。
     *   `all`      … 新着（みんなの写真を新しい順。**撮影日があれば撮影日**・`compareNewest`）
     *   `featured` … おすすめ（運営が選んだ写真を先に、残りはいいねの多い順・同点は投稿の
     *                新しい順・`recommendedOrder`。iOS の `HomeFeed` と同じ。ホームだけ）
     *   `following`… フォロー中（`TimelineFeed` が描く）
     */
    scope: "all" | "featured" | "following";
};

// FilterBar で使用する型（GalleryFilters と統一）
export type FilterValues = GalleryFilters;
