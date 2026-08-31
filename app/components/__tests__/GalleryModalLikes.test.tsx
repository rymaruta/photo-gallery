import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// モーダルのいいねがサーバーに届くこと。
//
// 以前はここだけ useFavorites を直接呼んでいたため、押しても端末ローカルに
// 溜まるだけで、公開のいいね数も投稿者への通知も動かなかった（個別ページでは動く）。
// ビルド後の新着写真はモーダルでしか見られないので、その写真へのいいねは
// 必ず失われていた。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/utils/api", () => ({
    userFetch: mockUserFetch,
    userPublicFetch: mockUserPublicFetch,
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
}));

vi.mock("../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, loading: false }),
}));

vi.mock("../../music/MusicContext", () => ({
    useMusic: () => ({ play: vi.fn() }),
}));

vi.mock("../../../lib/hooks/useToast", () => ({
    useToast: () => ({ showToast: vi.fn() }),
}));

import { resetFavoritesCache } from "../../../lib/hooks/useFavorites";
import GalleryModal from "../GalleryModal";
import type { Photo } from "@/lib/data/photos";

const photo: Photo = {
    id: "p1",
    src: "https://cdn.example.com/uploads/u1/p1.jpg",
    title: { ja: "写真", en: "Photo" },
    tags: [],
    likes: 3,
};

beforeEach(() => {
    localStorage.clear();
    resetFavoritesCache(); // お気に入りはモジュール内にキャッシュされる
    mockUserPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ likes: 3 }) });
    // /user/likes/<id>（自分のいいね状態）と /photos/<id>/like（更新）で
    // 返すものが違う。パスで出し分ける。
    mockUserFetch.mockReset().mockImplementation((path: string) =>
        Promise.resolve(path.startsWith("/user/likes/")
            ? { ok: true, json: async () => ({ liked: false }) }
            : { ok: true, json: async () => ({ likes: 4 }) }));
});
afterEach(() => { localStorage.clear(); });

function setup() {
    render(
        <GalleryModal
            photos={[photo]}
            currentIndex={0}
            onClose={vi.fn()}
            onNext={vi.fn()}
            onPrev={vi.fn()}
            locale="ja"
        />,
    );
}

describe("GalleryModal のいいね", () => {
    it("ハートを押すとユーザーAPIに POST する", async () => {
        setup();
        fireEvent.click(screen.getByRole("button", { name: "お気に入りに追加" }));
        await waitFor(() => {
            expect(mockUserFetch).toHaveBeenCalledWith(
                "/photos/p1/like",
                expect.objectContaining({ method: "POST" }),
            );
        });
    });

    it("いいね済みならもう一度押すと DELETE する", async () => {
        setup();
        fireEvent.click(screen.getByRole("button", { name: "お気に入りに追加" }));
        await waitFor(() => screen.getByRole("button", { name: "お気に入りから外す" }));
        fireEvent.click(screen.getByRole("button", { name: "お気に入りから外す" }));
        await waitFor(() => {
            expect(mockUserFetch).toHaveBeenLastCalledWith(
                "/photos/p1/like",
                expect.objectContaining({ method: "DELETE" }),
            );
        });
    });
});
