import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// **`loaded` は「API の一覧で置き換わったか」。**
//
// 初期値は `app/data/photos.json`（ビルド時のスナップショット）なので、
// 「配列が空でない」は「一覧が届いた」の代わりにならない。それで代用して
// いたせいで、ビルド後にアップロードされた写真の共有リンクに対して
// 「その写真は見つかりませんでした」と嘘をつき、しかもその判定を覚えて
// **あとから届いても開かなく**なっていた（GalleryPageClient）。
//
// **失敗したときは true にしない**のが要点。取れなかっただけで「無い」とは
// 言えないので、判断できないままにしておく（黙る側に倒す）。

const mockPublicFetch = vi.hoisted(() => vi.fn());
vi.mock("../../utils/api", () => ({ publicFetch: mockPublicFetch }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/app/data/photos.json", () => ({
    default: [{ id: "base-1", src: "a.jpg", title: "静的", category: "x", tags: [], date: "2026-01-01" }],
}));

const { usePhotos } = await import("../usePhotos");

const API_PHOTOS = [
    { id: "api-1", src: "b.jpg", title: "新着", category: "x", tags: [], date: "2026-02-01" },
];

beforeEach(() => { mockPublicFetch.mockReset(); });

describe("usePhotos の loaded", () => {
    it("最初は false（静的なスナップショットしか無い）", () => {
        mockPublicFetch.mockImplementation(() => new Promise(() => { /* 返らない */ }));
        const { result } = renderHook(() => usePhotos());
        expect(result.current.loaded).toBe(false);
        expect(result.current.photos).toHaveLength(1);   // 静的の分は出る
    });

    it("API の一覧で置き換わったら true", async () => {
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => API_PHOTOS });
        const { result } = renderHook(() => usePhotos());
        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.photos[0].id).toBe("api-1");
    });

    // **ここが要点。** 取れなかっただけで「無い」とは言えない
    it("取得に失敗したら false のまま（無いとは言わない）", async () => {
        mockPublicFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        const { result } = renderHook(() => usePhotos());
        await new Promise((r) => setTimeout(r, 20));
        expect(result.current.loaded, "失敗したのに「届いた」と言っている").toBe(false);
        expect(result.current.photos).toHaveLength(1);
    });

    it("通信が落ちても false のまま", async () => {
        mockPublicFetch.mockRejectedValue(new TypeError("Failed to fetch"));
        const { result } = renderHook(() => usePhotos());
        await new Promise((r) => setTimeout(r, 20));
        expect(result.current.loaded).toBe(false);
    });

    // 空配列は「静的のまま維持」なので、届いたことにしない
    it("空配列が返ってきたら false のまま", async () => {
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => [] });
        const { result } = renderHook(() => usePhotos());
        await new Promise((r) => setTimeout(r, 20));
        expect(result.current.loaded).toBe(false);
        expect(result.current.photos).toHaveLength(1);
    });
});
