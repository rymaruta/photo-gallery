// lib/types/gallery.ts
// ギャラリー関連の型定義

export type GalleryFilters = {
    category: string;
    selectedTags: string[];
    query: string;
    sort: "new" | "old" | "popular";
};

// FilterBar で使用する型（GalleryFilters と統一）
export type FilterValues = GalleryFilters;
