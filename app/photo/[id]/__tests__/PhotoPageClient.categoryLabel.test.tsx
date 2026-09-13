import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Photo } from "@/lib/data/photos";
import { collectionPath, categoryDisplayName, slugify } from "@/lib/utils/collections";
import { ja } from "@/app/i18n/labels";

/**
 * **チップの字と、飛んだ先の見出しを揃える。**
 *
 * `app/i18n/labels.ts` の `category.names` は**スラッグで引く表**
 * （`architecture` → `建築`）。写真ページは**保存されている生の値**を鍵に
 * していたので、別名で保存された写真だけ表に当たらず生のまま出ていた。
 * 実ビルド（2026-09-13）で数えた:
 *
 *     写真ページ1枚   チップ「建物」 → /category/architecture（見出し「建築の写真」）
 *     写真ページ5枚   チップ「建築」 → 同じ先
 *     集約ページ      チップ「建築6」 → 同じ先
 *
 * **同じ場所を指すのに、そこだけ違う言葉**を出していた。
 *
 * ここは `labels` を**本物**でモックする——`collectionLinks.test.tsx` は
 * `labels: {}` なので、表を引けず生の値がそのまま出る＝この食い違いを
 * 原理的に観測できない（あちらが見ているのは href だけ）。
 */
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja", labels: ja }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    userFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    publicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
vi.mock("../../../components/CommentSection", () => ({ default: () => null }));
vi.mock("../../../components/RelatedPhotos", () => ({ default: () => null }));
vi.mock("../../../components/ProfileLink", () => ({ default: () => null }));
vi.mock("../../../components/MusicCard", () => ({ default: () => null }));
vi.mock("../../../../lib/hooks/usePhotoLikes", () => ({
    usePhotoLikes: () => ({ liked: false, count: 0, pending: false, toggle: vi.fn() }),
}));
vi.mock("../../../../lib/utils/music", () => ({ searchSongs: vi.fn(), parseMusicEmbed: () => null }));

const PhotoPageClient = (await import("../PhotoPageClient")).default;

const photoWith = (category: string) => ({
    id: "p1",
    src: "https://cdn.example.com/uploads/owner-1/a.jpg",
    userId: "owner-1",
    title: "テスト写真",
    category,
} as unknown as Photo);

/** 飛び先の集約ページが名乗る名前（見出しの決め方と同じ規則） */
const headingName = (raw: string) => categoryDisplayName(slugify(raw, "category"));

describe("カテゴリのチップの字", () => {
    // **これが直した本体。** 実データに1枚だけある形
    it("別名で保存されていても、飛び先が名乗る名前で出す", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={photoWith("建物")} />);
        await screen.findByText("テスト写真");
        expect(headingName("建物"), "前提が崩れている（別名表が変わった）").toBe("建築");
        const chip = screen.getByText("建築");
        expect(chip.closest("a")?.getAttribute("href")).toBe(collectionPath("category", "architecture"));
        expect(screen.queryByText("建物"), "飛び先と違う言葉を出している").toBeNull();
    });

    it("スラッグで保存されていても同じ名前になる", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={photoWith("architecture")} />);
        await screen.findByText("テスト写真");
        expect(screen.getByText("建築").closest("a")?.getAttribute("href"))
            .toBe(collectionPath("category", "architecture"));
    });

    // 別名表に無いカテゴリは、本人が書いた言葉のまま
    it("表に無いカテゴリは生のまま出す", async () => {
        render(<PhotoPageClient photoId="p1" initialPhoto={photoWith("ご飯")} />);
        await screen.findByText("テスト写真");
        expect(headingName("ご飯"), "前提が崩れている（別名表に載った）").toBeUndefined();
        expect(screen.getByText("ご飯").closest("a")?.getAttribute("href"))
            .toBe(collectionPath("category", "ご飯"));
    });
});
