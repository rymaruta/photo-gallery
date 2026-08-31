import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// **同じタグのチップが2つ並んでいた。**
//
// 集約ページ（`/tag/<スラッグ>`）が404のときは `?tags=<スラッグ>` に
// 振り替わる。選択は `mount-fuji`、写真が持つタグは `Mount Fuji` なので、
// 完全一致で突き合わせていた頃は「生のタグ（未選択・件数つき）」と
// 「スラッグ（選択済み・件数0）」が両方出ていた。

const mockShowToast = vi.hoisted(() => vi.fn());

vi.mock("../auth/context", () => ({ useAuth: () => ({ isAuthenticated: false, userId: null, loading: false }) }));
vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: { category: { all: "すべて", names: {} }, site: { title: "Gallery" } } }),
}));
vi.mock("../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../components/stories/StoriesBar", () => ({ default: () => null }));
vi.mock("../components/GalleryGrid", () => ({ default: () => null }));
vi.mock("../components/GalleryModal", () => ({ default: () => null }));
vi.mock("../components/SearchParamWatcher", () => ({ default: () => null }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// タグのチップだけを見たいので、FilterBar は本物を使う（モックしない）
const PHOTOS = [
    { id: "p1", src: "https://cdn/a.jpg", title: "あ", category: "travel", tags: ["Mount Fuji"], date: "2026-01-01", createdAt: "2026-01-01" },
    { id: "p2", src: "https://cdn/b.jpg", title: "い", category: "travel", tags: ["night"], date: "2026-01-02", createdAt: "2026-01-02" },
];
vi.mock("../../lib/hooks/usePhotos", () => ({ usePhotos: () => ({ photos: PHOTOS, loaded: true }) }));

const GalleryPageClient = (await import("../GalleryPageClient")).default;

beforeEach(() => {
    mockShowToast.mockReset();
    window.history.replaceState({}, "", "/");
});

describe("タグのチップ", () => {
    it("スラッグで来ても、同じタグのチップは1つ", async () => {
        window.history.replaceState({}, "", "/?tags=mount-fuji");
        render(<GalleryPageClient />);

        await waitFor(() => expect(screen.getAllByRole("switch").length).toBeGreaterThan(0));
        const labels = screen.getAllByRole("switch").map((el) => el.getAttribute("aria-label") ?? "");
        const fuji = labels.filter((l) => l.toLowerCase().includes("fuji") || l.includes("mount-fuji"));
        expect(fuji, `同じタグのチップが2つ出ている: ${JSON.stringify(labels)}`).toHaveLength(1);
    });

    it("そのチップは選択済みとして出る（押せば外せる）", async () => {
        window.history.replaceState({}, "", "/?tags=mount-fuji");
        render(<GalleryPageClient />);

        const chip = await screen.findByRole("switch", { name: /Mount Fuji/ });
        expect(chip, "選択が反映されていない").toHaveAttribute("aria-checked", "true");
    });

    it("選択が無ければ今までどおり全部未選択", async () => {
        render(<GalleryPageClient />);
        await waitFor(() => expect(screen.getAllByRole("switch").length).toBeGreaterThan(0));
        for (const chip of screen.getAllByRole("switch")) {
            expect(chip).toHaveAttribute("aria-checked", "false");
        }
    });
});
