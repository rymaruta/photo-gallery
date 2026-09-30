import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// **今日の一問の入口**（`QuizEntry`）。ホームの3つのタブのどれでも同じ位置（タブの直下）に
// 1行だけ出し、「さがす」の面には出さない。
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

describe("ホームの今日の一問の入口", () => {
    it("ホームにはタブの直下に1行・行き先は /q・先読みしない", async () => {
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        const entry = await screen.findByTestId("home-quiz-entry");
        expect(entry.getAttribute("href")).toBe("/q");
        expect(entry.textContent).toContain("この写真はどこ？");
        // タブの列の直後（どのタブでも同じ位置）
        const tabs = screen.getByRole("tablist");
        expect(tabs.nextElementSibling).toBe(entry);
    });

    it("「さがす」の面には出さない", async () => {
        render(<ToastProvider><GalleryPageClient surface="search" /></ToastProvider>);
        await waitFor(() => expect(screen.queryByRole("tablist")).toBeNull());
        expect(screen.queryByTestId("home-quiz-entry")).toBeNull();
    });
});
