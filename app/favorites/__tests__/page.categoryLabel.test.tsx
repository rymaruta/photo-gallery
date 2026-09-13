import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";
import { ja } from "@/app/i18n/labels";

/**
 * **いいね一覧のカテゴリ行が空欄になった回帰の、入口側の見張り。**
 *
 * 表示名の地図の鍵をスラッグに変えた回で、日本語の別名で保存された写真
 * （実データ30枚のうち9枚）のカテゴリ行が**空欄**になった。読む側
 * （`GalleryGrid`）は**生の値**で引き、落とし先を持たないため。
 *
 * **この画面を描くテストが1本も無かった**ので、フルスイート4,828件が
 * 緑のまま通った。地図を作る規則（`photoCategoryMap`）と読む側の契約は
 * それぞれ別のテストで見ているが、**この画面がその規則を使っているか**は
 * ここでしか見られない（地図を渡すのをやめる変異が素通りしていた）。
 */
const photos: Photo[] = [
    { id: "a", src: "https://cdn.example.com/uploads/a.jpg", title: { ja: "写真A" }, category: "建物", tags: [] },
    { id: "b", src: "https://cdn.example.com/uploads/b.jpg", title: { ja: "写真B" }, category: "landscape", tags: [] },
] as unknown as Photo[];

vi.mock("../../../lib/hooks/useFavorites", () => ({
    useFavorites: () => ({ favorites: ["a", "b"], isFavorite: () => true, toggle: vi.fn() }),
}));
vi.mock("../../../lib/hooks/usePhotos", () => ({
    // **正規化しない**（本物と同じ）。ここで揃えてしまうと、
    // 鍵と読む側の食い違いという当の問題が観測できない
    usePhotos: () => ({ photos, loaded: true, failed: false }),
}));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: ja }) }));

const FavoritesPage = (await import("../page")).default;

describe("いいね一覧のカテゴリ行", () => {
    it("別名で保存された写真も、飛び先と同じ名前で出る（空欄にしない）", () => {
        render(<FavoritesPage />);
        expect(screen.getByText("写真A")).toBeInTheDocument();
        expect(screen.getByText("建築"), "別名の写真のカテゴリが空欄になっている").toBeInTheDocument();
        expect(screen.queryByText("建物"), "飛び先と違う言葉を出している").toBeNull();
        expect(screen.getByText("風景"), "スラッグの写真のカテゴリが出ていない").toBeInTheDocument();
    });
});
