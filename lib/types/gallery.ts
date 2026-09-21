// lib/types/gallery.ts
// ギャラリー関連の型定義

export type GalleryFilters = {
    category: string;
    selectedTags: string[];
    query: string;
    sort: "new" | "old" | "popular";
    /**
     * 誰の・どの写真を見るか（トップのタブ）。
     *   `all`      … 新着（みんなの写真を投稿の新しい順）
     *   `featured` … おすすめ（**運営が選んだ写真**。人気順ではない）
     *   `following`… フォロー中（`TimelineFeed` が描く）
     */
    scope: "all" | "featured" | "following";
};

// FilterBar で使用する型（GalleryFilters と統一）
export type FilterValues = GalleryFilters;
