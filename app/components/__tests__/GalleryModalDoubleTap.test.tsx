import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// **ダブルタップいいねが「時間だけ」で判定していた。**
//
// 350ms 以内なら**画面の端と端**を叩いてもいいねになる。スワイプで写真を
// 送ってからタップした場合も、指がまったく別の場所でも成立する。
// さらに `lastTapRef` は写真が変わってもリセットされないので、
// 1タップ → 素早く次の写真へ → タップ、が「次の写真へのいいね」になりうる
// （このモーダルは同じフックのまま次の写真へ進む作り）。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockUserPublicFetch = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../lib/utils/api")>()),
    userFetch: mockUserFetch,
    userPublicFetch: mockUserPublicFetch,
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
}));
vi.mock("../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../music/MusicContext", () => ({ useMusic: () => ({ play: vi.fn() }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import { resetFavoritesCache } from "../../../lib/hooks/useFavorites";
import GalleryModal from "../GalleryModal";
import type { Photo } from "@/lib/data/photos";

const photos: Photo[] = [
    { id: "p1", src: "https://cdn/p1.jpg", title: { ja: "1枚目", en: "1" }, tags: [], likes: 3 },
    { id: "p2", src: "https://cdn/p2.jpg", title: { ja: "2枚目", en: "2" }, tags: [], likes: 5 },
];

/** いいねの POST が飛んだ回数 */
const likePosts = () => mockUserFetch.mock.calls.filter(
    (c) => String(c[0]).includes("/like") && (c[1] as { method?: string } | undefined)?.method === "POST").length;

beforeEach(() => {
    localStorage.clear();
    resetFavoritesCache();
    mockUserPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ likes: 3 }) });
    mockUserFetch.mockReset().mockImplementation((path: string) =>
        Promise.resolve(String(path).startsWith("/user/likes/")
            ? { ok: true, json: async () => ({ liked: false }) }
            : { ok: true, json: async () => ({ likes: 4 }) }));
});
afterEach(() => localStorage.clear());

function view(index: number) {
    return <GalleryModal photos={photos} currentIndex={index} onClose={vi.fn()}
        onNext={vi.fn()} onPrev={vi.fn()} locale="ja" />;
}

/** 画像エリア（スワイプとタップを受ける箱） */
const tapArea = () => screen.getByAltText("1枚目").closest("div") as HTMLElement;

describe("ダブルタップいいね", () => {
    it("同じ場所を素早く2回叩けばいいねになる（正常系）", async () => {
        render(view(0));
        const area = tapArea();
        fireEvent.click(area, { clientX: 100, clientY: 200 });
        fireEvent.click(area, { clientX: 105, clientY: 205 });

        await waitFor(() => expect(likePosts()).toBe(1));
    });

    it("離れた場所を2回叩いてもいいねにしない", async () => {
        render(view(0));
        const area = tapArea();
        fireEvent.click(area, { clientX: 20, clientY: 40 });
        fireEvent.click(area, { clientX: 300, clientY: 500 });

        await new Promise((r) => setTimeout(r, 30));
        expect(likePosts(), "画面の端と端を叩いただけでいいねしている").toBe(0);
    });

    it("写真が変わったらタップの記録を捨てる", async () => {
        const { rerender } = render(view(0));
        fireEvent.click(tapArea(), { clientX: 100, clientY: 200 });

        rerender(view(1));   // 次の写真へ
        const next = screen.getByAltText("2枚目").closest("div") as HTMLElement;
        fireEvent.click(next, { clientX: 100, clientY: 200 });

        await new Promise((r) => setTimeout(r, 30));
        expect(likePosts(), "前の写真のタップが次の写真のいいねになっている").toBe(0);
    });
});
