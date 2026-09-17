import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * トップの「すべて / フォロー中」。
 *
 * **「フォロー中」はもう一覧のふるいではなく、`/timeline` へのリンク。**
 * 以前はこの一覧に掛けるふるいで、出るのはサムネのグリッド＝誰の写真か
 * 見えなかった（owner の「混ざってる」）。ふるいの残骸（`?feed=`）が
 * 戻っていないこともここで見る。
 */
const authState = vi.hoisted(() => ({ current: { isAuthenticated: true, userId: "me", loading: false } }));
vi.mock("../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: { category: { all: "すべて", names: {} }, site: { title: "Gallery" } } }),
}));
vi.mock("../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../components/stories/StoriesBar", () => ({ default: () => null }));
vi.mock("../components/FilterBar", () => ({ default: () => null }));
vi.mock("../components/GalleryModal", () => ({ default: () => null }));
vi.mock("../components/SearchParamWatcher", () => ({ default: () => null }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const gridProps = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock("../components/GalleryGrid", () => ({
    default: (p: { photos: Array<{ id: string }> }) => { gridProps.ids = p.photos.map((x) => x.id); return null; },
}));

const PHOTOS = [
    { id: "mine", userId: "me", src: "https://cdn/a.jpg", title: "自分", category: "travel", tags: [], date: "2026-01-01", createdAt: "2026-01-01" },
    { id: "theirs", userId: "u1", src: "https://cdn/b.jpg", title: "他人", category: "travel", tags: [], date: "2026-01-02", createdAt: "2026-01-02" },
];
vi.mock("../../lib/hooks/usePhotos", () => ({ usePhotos: () => ({ photos: PHOTOS, loaded: true, failed: false }) }));

const GalleryPageClient = (await import("../GalleryPageClient")).default;

beforeEach(() => {
    authState.current = { isAuthenticated: true, userId: "me", loading: false };
    window.history.replaceState({}, "", "/");
});

describe("トップの すべて / フォロー中", () => {
    it("ログイン中は出て、「フォロー中」は /timeline へのリンク（「すべて」が選択中）", () => {
        render(<GalleryPageClient />);
        const following = screen.getByRole("link", { name: "フォロー中" });
        expect(following.getAttribute("href")).toBe("/timeline");
        expect(following).not.toHaveAttribute("aria-current");
        expect(screen.getByRole("link", { name: "すべて" })).toHaveAttribute("aria-current", "page");
        // ふるいのボタンには戻っていない
        expect(screen.queryByRole("button", { name: "フォロー中" })).toBeNull();
    });

    it("未ログインには出さない（フォローが無いので行き先が空）", () => {
        authState.current = { isAuthenticated: false, userId: "", loading: false };
        render(<GalleryPageClient />);
        expect(screen.queryByRole("link", { name: "フォロー中" })).toBeNull();
    });

    // 旧 URL（`/?feed=following`）を開いても、一覧が空にならない
    // ——ふるいは撤去したので、知らないクエリとして無視される
    it("旧 URL の ?feed=following は無視して、みんなの写真を出す", () => {
        window.history.replaceState({}, "", "/?feed=following");
        render(<GalleryPageClient />);
        expect(gridProps.ids.sort()).toEqual(["mine", "theirs"]);
        expect(screen.queryByText(/フォローした人の写真がここに集まります|読み込み中/)).toBeNull();
    });
});
