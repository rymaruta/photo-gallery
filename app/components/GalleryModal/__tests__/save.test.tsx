import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// 拡大表示（モーダル）の保存ボタン。**いいねとは別の口**を叩くこと、
// 未ログインでは案内を出すこと、写真を送ったらしおりが持ち越されないこと。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({ isAuthenticated: true, loading: false }));

vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    userFetch: mockUserFetch,
    userPublicFetch: mockUserPublicFetch,
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
}));
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ ...authState }) }));
vi.mock("../../../music/MusicContext", () => ({ useMusic: () => ({ play: vi.fn() }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

import { resetFavoritesCache } from "../../../../lib/hooks/useFavorites";
import GalleryModal from "../index";
import type { Photo } from "@/lib/data/photos";

const photo = (id: string): Photo => ({
    id, src: `https://cdn.example.com/uploads/u1/${id}.jpg`,
    title: { ja: "写真", en: "Photo" }, tags: [], likes: 3,
});

/** 既定: いいねも保存も「まだ付いていない」 */
function defaultRoutes(path: string) {
    if (path.startsWith("/user/likes/")) return { ok: true, json: async () => ({ liked: false }) };
    if (path.startsWith("/user/saves/")) return { ok: true, json: async () => ({ saved: false }) };
    if (path.endsWith("/save")) return { ok: true, json: async () => ({ saved: true }) };
    return { ok: true, json: async () => ({ likes: 4 }) };
}

beforeEach(() => {
    localStorage.clear();
    resetFavoritesCache();
    authState.isAuthenticated = true;
    authState.loading = false;
    mockShowToast.mockReset();
    mockUserPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ likes: 3 }) });
    mockUserFetch.mockReset().mockImplementation((p: string) => Promise.resolve(defaultRoutes(p)));
});
afterEach(() => { localStorage.clear(); });

function setup(index = 0) {
    return render(
        <GalleryModal
            photos={[photo("p1"), photo("p2")]}
            currentIndex={index}
            onClose={vi.fn()} onNext={vi.fn()} onPrev={vi.fn()}
            locale="ja"
        />,
    );
}

describe("拡大表示の保存ボタン", () => {
    it("いいねとは別のボタンとして出る", async () => {
        setup();
        expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "いいね" })).toBeTruthy();
    });

    it("押すと `/photos/<id>/save` へ POST し、しおりが付く", async () => {
        setup();
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(screen.getByRole("button", { name: "保存を取り消す" })).toBeTruthy());
        expect(mockUserFetch).toHaveBeenCalledWith("/photos/p1/save", { method: "POST" });
        // **いいねは飛ばない**（別の棚）
        expect(mockUserFetch).not.toHaveBeenCalledWith("/photos/p1/like", expect.anything());
    });

    it("保存済みから押すと DELETE", async () => {
        mockUserFetch.mockImplementation((p: string) => Promise.resolve(
            p.startsWith("/user/saves/") ? { ok: true, json: async () => ({ saved: true }) }
                : p.endsWith("/save") ? { ok: true, json: async () => ({ saved: false }) }
                    : defaultRoutes(p)));
        setup();
        await waitFor(() => expect(screen.getByRole("button", { name: "保存を取り消す" })).toBeTruthy());
        fireEvent.click(screen.getByRole("button", { name: "保存を取り消す" }));
        await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeTruthy());
        expect(mockUserFetch).toHaveBeenLastCalledWith("/photos/p1/save", { method: "DELETE" });
    });

    // **未ログインは「失敗」ではない。** 「保存できませんでした。もう一度
    // お試しください」と言われても、押し直して直る話ではない
    it("未ログインならログインを促し、サーバーへは何も送らない", async () => {
        authState.isAuthenticated = false;
        setup();
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        expect(mockShowToast.mock.calls[0][0]).toContain("ログイン");
        expect(mockUserFetch).not.toHaveBeenCalledWith("/photos/p1/save", expect.anything());
        // しおりは付かない（付くと「保存した」と見えるのに、どこにも残らない）
        expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
    });

    it("失敗したらトーストで伝え、しおりは戻る", async () => {
        const body = { error: "保存に失敗しました" };
        mockUserFetch.mockImplementation((p: string) => Promise.resolve(
            p.endsWith("/save") && !p.startsWith("/user/")
                ? { ok: false, status: 500, json: async () => body, clone: () => ({ json: async () => body }) }
                : defaultRoutes(p)));
        setup();
        fireEvent.click(screen.getByRole("button", { name: "保存" }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("保存に失敗しました", "error"));
        expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
    });

    // モーダルは**同じフックのまま**次の写真へ進む。持ち越すと、1枚目の
    // しおりが2枚目にも付いて見え、押すと解除が飛ぶ
    it("写真を送ったら、しおりは持ち越さない", async () => {
        const saved = new Set(["p1"]);
        mockUserFetch.mockImplementation((p: string) => Promise.resolve(
            p.startsWith("/user/saves/")
                ? { ok: true, json: async () => ({ saved: saved.has(p.slice("/user/saves/".length)) }) }
                : defaultRoutes(p)));
        const { rerender } = setup(0);
        await waitFor(() => expect(screen.getByRole("button", { name: "保存を取り消す" })).toBeTruthy());

        rerender(
            <GalleryModal
                photos={[photo("p1"), photo("p2")]}
                currentIndex={1}
                onClose={vi.fn()} onNext={vi.fn()} onPrev={vi.fn()}
                locale="ja"
            />,
        );
        await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeTruthy());
    });

    it("いいねのボタンと重ならない位置に置く（44px の当たりが並ぶ）", () => {
        setup();
        const save = screen.getByRole("button", { name: "保存" });
        const like = screen.getByRole("button", { name: "いいね" });
        // **px で書く。** 640px 未満で root が 14px に落ちるので rem は縮み、
        // 隣のボタンと重なる
        expect(save.className).toContain("right-[120px]");
        expect(like.className).toContain("right-[64px]");
    });
});
