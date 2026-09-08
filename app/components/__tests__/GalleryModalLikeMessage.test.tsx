import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// **押し直しても直らない失敗を「もう一度お試しください」で済ませない。**
// フックが理由を運ぶようにしても、画面がそれを出すかは別の話
// （無視しても既定文が出るので緑になる。写真ページ側で実証した）。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../lib/utils/api")>()),
    userFetch: mockUserFetch,
    userPublicFetch: mockUserPublicFetch,
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
}));
vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../music/MusicContext", () => ({ useMusic: () => ({ play: vi.fn() }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

import { resetFavoritesCache } from "../../../lib/hooks/useFavorites";
import GalleryModal from "../GalleryModal";
import type { Photo } from "@/lib/data/photos";
import { AUTH_REQUIRED_MESSAGE, NETWORK_UNREACHABLE_MESSAGE } from "../../../lib/utils/api";

const photos: Photo[] = [{ id: "p1", src: "https://cdn/p1.jpg", title: { ja: "1枚目", en: "1" }, tags: [], likes: 3 }];

beforeEach(() => {
    localStorage.clear();
    resetFavoritesCache();
    mockShowToast.mockReset();
    mockUserPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ likes: 3 }) });
    mockUserFetch.mockReset();
});

/** ハートを押して、出たトーストの文言を返す */
async function likeWith(err: unknown) {
    mockUserFetch.mockImplementation((path: string) =>
        String(path).includes("/like") && !String(path).startsWith("/user/likes/")
            ? Promise.reject(err)
            : Promise.resolve({ ok: true, json: async () => ({ liked: false }) }));
    render(<GalleryModal photos={photos} currentIndex={0} onClose={vi.fn()} onNext={vi.fn()} onPrev={vi.fn()} locale="ja" />);
    fireEvent.click(await screen.findByRole("button", { name: "お気に入りに追加" }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    return String(mockShowToast.mock.calls[0][0]);
}

describe("モーダルのいいね: 断られた理由を出す", () => {
    it("セッションが切れていたら、その文言をそのまま出す", async () => {
        expect(await likeWith(new Error(AUTH_REQUIRED_MESSAGE))).toBe(AUTH_REQUIRED_MESSAGE);
    });

    it("通信できないときも、その文言をそのまま出す", async () => {
        expect(await likeWith(new Error(NETWORK_UNREACHABLE_MESSAGE))).toBe(NETWORK_UNREACHABLE_MESSAGE);
    });

    it("理由の分からない失敗は、今までどおりの案内", async () => {
        expect(await likeWith(new TypeError("Failed to fetch")))
            .toContain("いいねを保存できませんでした");
    });
});
