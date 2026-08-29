import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// フォロー中一覧の取得失敗が「誰もフォローしていない」フィードと同じ
// 空表示に化けていた（SW-b1）。失敗は失敗と伝えて再試行を出す。

const mockUserFetch = vi.hoisted(() => vi.fn());

vi.mock("../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, userId: "me", loading: false }),
}));
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
vi.mock("../components/GalleryGrid", () => ({ default: () => null }));
vi.mock("../components/GalleryModal", () => ({ default: () => null }));
vi.mock("../components/SearchParamWatcher", () => ({ default: () => null }));
vi.mock("../../lib/hooks/usePhotos", () => ({ usePhotos: () => ({ photos: [] }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import ToastProvider from "../components/ToastProvider";
const GalleryPageClient = (await import("../GalleryPageClient")).default;

beforeEach(async () => {
    mockUserFetch.mockReset();
    const { resetFollowingCache } = await import("../../lib/hooks/useFollow");
    resetFollowingCache();
});

describe("フォロー中フィードの取得失敗", () => {
    it("空表示と混ぜず、再試行で立て直す", async () => {
        mockUserFetch
            .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })   // 1回目失敗
            .mockResolvedValue({ ok: true, json: async () => ({ userIds: [] }) });        // 再試行は成功

        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        fireEvent.click(await screen.findByRole("button", { name: "フォロー中" }));

        expect(await screen.findByText(/フォロー中の一覧を読み込めませんでした/)).toBeInTheDocument();
        // 空フィードの文言（0件と同じ見た目）にはしない
        expect(screen.queryByText(/フォローした人の写真がここに集まります/)).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "もう一度読み込む" }));
        // 成功したら通常の空フィード表示へ（フォロー0人なので）
        expect(await screen.findByText(/フォローした人の写真がここに集まります/)).toBeInTheDocument();
        expect(screen.queryByText(/読み込めませんでした/)).toBeNull();
    });
});
