import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// **写真が1枚も無い環境で「該当する写真がありません。」と出ていた。**
//
// 絞り込みの空表示は `filteredPhotos.length === 0 && PHOTOS.length > 0` を
// 要求するので、写真が0枚の環境（新しい環境・公開が全部消えた）はそこに
// 入らず、`GalleryGrid` の既定文言に落ちる。**絞り込んでいない人に
// 「該当」と言う**ので、条件を外そうとして探し回ることになる。

const mockUserFetch = vi.hoisted(() => vi.fn());

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
    publicFetch: vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
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

// 既定は**1枚も無い環境**（新しい環境・公開が全部消えた）。
// テストごとに差し替えられるよう、authState と同じ形にする
const photosState = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock("../../lib/hooks/usePhotos", () => ({
    usePhotos: () => ({ loaded: true, photos: photosState.current }),
}));
vi.mock("../data/photos.json", () => ({ default: [] }));

import ToastProvider from "../components/ToastProvider";
const GalleryPageClient = (await import("../GalleryPageClient")).default;

beforeEach(async () => {
    authState.current = { isAuthenticated: false, userId: null, loading: false };
    window.history.replaceState({}, "", "/");
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ userIds: [] }) });
    photosState.current = [];
    const { resetFollowingCache } = await import("../../lib/hooks/useFollow");
    resetFollowingCache();
});

describe("写真が1枚も無い環境のトップ", () => {
    it("絞り込んでいないのに「該当」と言わない", async () => {
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        await waitFor(() => expect(screen.getByText("まだ写真がありません。")).toBeInTheDocument());
        expect(screen.queryByText("該当する写真がありません。"),
            "絞り込んでいない人に「該当」と言っている").toBeNull();
    });

    // 絞り込みで0件になった側は、今までどおり「条件に一致する写真が
    // ありません。」——**取り違えると、外すべき条件があることが伝わらない**
    it("写真があって絞り込みで0件なら、従来の文言のまま", async () => {
        photosState.current = [{
            id: "p1", userId: "u1", src: "https://cdn/p1.jpg",
            title: { ja: "写真", en: "Photo" }, category: "street", tags: [],
            date: "2026-01-01", createdAt: "2026-01-01", published: true,
        }];
        window.history.replaceState({}, "", "/?q=" + encodeURIComponent("見つからない語"));

        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        await waitFor(() => expect(screen.getByText("条件に一致する写真がありません。")).toBeInTheDocument());
        expect(screen.queryByText("まだ写真がありません。"),
            "絞り込みで0件なのに「まだ無い」と言っている").toBeNull();
    });
});
