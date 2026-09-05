import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// **100件中1件が壊れているだけで、ページ全体が落ちていた。**
//
// `GET /photos` の応答は `Array.isArray` までしか見ずに状態へ入れていた。
// 中身は描画の途中で読むので（`useGallery` の `p.category`・`p.tags.map`）、
// `null` が1件混じると `TypeError` になり、`ErrorBoundary` のカードが
// **ヘッダーごと画面を覆う**。ここで確かめるのは「一覧が生き残ること」。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());

const authState = vi.hoisted(() => ({
    current: { isAuthenticated: true, userId: "me" as string | null, loading: false },
}));
vi.mock("../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: { category: { all: "すべて", names: {} }, site: { title: "Gallery" } } }),
}));
vi.mock("../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    userFetch: (...args: unknown[]) => mockUserFetch(...args),
    publicFetch: (...args: unknown[]) => mockPublicFetch(...args),
    userPublicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
}));
vi.mock("../components/FilterBar", () => ({ default: () => null }));
vi.mock("../components/stories/StoriesBar", () => ({ default: () => null }));
// 既定文言に落ちたことが見えるよう、本物に近い形で出す
vi.mock("../components/GalleryGrid", () => ({
    default: ({ photos }: { photos: unknown[] }) =>
        photos.length === 0 ? <div>該当する写真がありません。</div> : <div>grid</div>,
}));
vi.mock("../components/GalleryModal", () => ({ default: () => null }));
vi.mock("../components/SearchParamWatcher", () => ({ default: () => null }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

// 既定は**1枚も無い環境**（新しい環境・公開が全部消えた）。
// テストごとに差し替えられるよう、authState と同じ形にする
// **`usePhotos` はモックしない。** 読めない行を落とすのはあのフックの中で、
// そこを差し替えるとこのテストは何も守らない
vi.mock("../data/photos.json", () => ({ default: [] }));


beforeEach(async () => {
    authState.current = { isAuthenticated: false, userId: null, loading: false };
    window.history.replaceState({}, "", "/");
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ userIds: [] }) });
    const { resetFollowingCache } = await import("../../lib/hooks/useFollow");
    resetFollowingCache();
});

const GalleryPageClient = (await import("../GalleryPageClient")).default;
const ErrorBoundary = (await import("../components/ErrorBoundary")).default;

const photo = (id: string) => ({
    id, src: `https://cdn/${id}.jpg`, title: id, category: "landscape",
    tags: ["旅"], date: "2026-01-01", published: true, userId: "me",
});

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockPublicFetch.mockReset();
});

describe("読めない行が1件混じっても、一覧は生き残る", () => {
    it("壊れた行があってもエラーカードにならない", async () => {
        mockPublicFetch.mockResolvedValue({
            ok: true,
            json: async () => [photo("a"), null, photo("b"), { id: "c", tags: "配列でない" }],
        });
        render(<ErrorBoundary><GalleryPageClient /></ErrorBoundary>);
        await waitFor(() => expect(mockPublicFetch).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 30));
        expect(screen.queryByText(/予期しないエラー/), "ページ全体が落ちている").toBeNull();
        expect(screen.getByText("grid")).toBeInTheDocument();
    });

    // 正常系: 全部読める応答は今までどおり
    it("全部読める応答は今までどおり出る", async () => {
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => [photo("a"), photo("b")] });
        render(<ErrorBoundary><GalleryPageClient /></ErrorBoundary>);
        await waitFor(() => expect(mockPublicFetch).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 30));
        expect(screen.queryByText(/予期しないエラー/)).toBeNull();
        expect(screen.getByText("grid")).toBeInTheDocument();
    });
});
