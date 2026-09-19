// lib/types/gallery.ts
// ギャラリー関連の型定義

export type GalleryFilters = {
    category: string;
    selectedTags: string[];
    query: string;
    sort: "new" | "old" | "popular";
    /**
     * 誰の写真を見るか（トップのタブ）。`all`＝みんな／`mine`＝自分／
     * `following`＝フォローしている人（こちらはグリッドではなく `TimelineFeed`）。
     * ログイン中の既定は `mine`（owner の指示）。決めるのは画面側
     */
    scope: "all" | "mine" | "following";
};

// FilterBar で使用する型（GalleryFilters と統一）
export type FilterValues = GalleryFilters;
