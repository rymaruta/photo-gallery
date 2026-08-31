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
    // 表記ゆれ: 同じタグを違う書き方で持つ写真（`fuji` が2枚、`Fuji` が1枚）。
    // **少ない方（`Fuji`）を先に置く**——「最初に見つけた表記」を代表に
    // する実装でも通ってしまうため（実際その変異で緑になった）
    { id: "p3", src: "https://cdn/c.jpg", title: "う", category: "travel", tags: ["Fuji"], date: "2026-01-03", createdAt: "2026-01-03" },
    { id: "p4", src: "https://cdn/d.jpg", title: "え", category: "travel", tags: ["fuji"], date: "2026-01-04", createdAt: "2026-01-04" },
    { id: "p5", src: "https://cdn/e.jpg", title: "お", category: "travel", tags: ["fuji"], date: "2026-01-05", createdAt: "2026-01-05" },
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
        // `Mount Fuji`（写真が持つ生のタグ）と `mount-fuji`（URL のスラッグ）を
        // 数える。**単に "fuji" を含む**で数えると、別タグの `fuji` まで
        // 巻き込む（同じファイルの表記ゆれの試験で実際に混ざった）
        const same = labels.filter((l) => l.startsWith("Mount Fuji") || l.startsWith("mount-fuji"));
        expect(same, `同じタグのチップが2つ出ている: ${JSON.stringify(labels)}`).toHaveLength(1);
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

// **表記ゆれが、件数の割れた2つのチップになっていた。**
//
// 絞り込みは `tagKey` で正規化して当てるので、`Fuji` と `fuji` の
// どちらを押しても出る写真は同じ。なのに数字だけが割れて、同じものが
// 2つ並んで見える（`dca777a` で選択判定を正規化したので、いまは
// **両方が同時に光る**）。
describe("表記ゆれのタグ", () => {
    const chips = () => screen.getAllByRole("switch").map((el) => el.getAttribute("aria-label") ?? "");

    it("同じタグは1つのチップに畳む", async () => {
        render(<GalleryPageClient />);
        await waitFor(() => expect(screen.getAllByRole("switch").length).toBeGreaterThan(0));

        const fuji = chips().filter((l) => l.toLowerCase().startsWith("fuji"));
        expect(fuji, `表記ゆれで2つ出ている: ${JSON.stringify(chips())}`).toHaveLength(1);
    });

    it("件数は合算し、代表はいちばん多い表記", async () => {
        render(<GalleryPageClient />);
        await waitFor(() => expect(screen.getAllByRole("switch").length).toBeGreaterThan(0));

        // fuji が2枚・Fuji が1枚 → 代表は "fuji"、件数は 3
        expect(chips()).toContain("fuji (3)");
    });

    it("別のタグまで畳まない（正常系）", async () => {
        render(<GalleryPageClient />);
        await waitFor(() => expect(screen.getAllByRole("switch").length).toBeGreaterThan(0));
        expect(chips().some((l) => l.startsWith("night")), "無関係のタグが消えている").toBe(true);
        expect(chips().some((l) => l.startsWith("Mount Fuji")), "別のタグまで畳んでいる").toBe(true);
    });
});
