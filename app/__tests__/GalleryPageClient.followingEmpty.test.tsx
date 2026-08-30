import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// **取得中と「0人」を同じ画面にしていた。**
//
// `followingIds` の初期値は空の Set なので、取得が終わる前のフォロー中
// フィードは必ず0件になる。そのまま「フォローした人の写真がここに
// 集まります。」を出すと、何人もフォローしている人にも、回線が遅い間ずっと
// 「誰もフォローしていない人」の画面を見せることになる。
//
// もうひとつ、**0件の理由を取り違えていた**。検索語やカテゴリで0件に
// なった回にも同じ文言を出していたので、抜けるには「みんなの写真を見る」
// →まだ0件→「フィルターをリセット」と2手かかっていた。

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
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// フォローしている u1 の写真が1枚ある状態
vi.mock("../../lib/hooks/usePhotos", () => ({
    usePhotos: () => ({
        loaded: true,
        photos: [{
            id: "p1", userId: "u1", src: "https://cdn/p1.jpg",
            title: { ja: "友達の写真", en: "Friend" }, category: "street", tags: [],
            date: "2026-01-01", createdAt: "2026-01-01", published: true,
        }],
    }),
}));

import ToastProvider from "../components/ToastProvider";
const GalleryPageClient = (await import("../GalleryPageClient")).default;

const EMPTY = /フォローした人の写真がここに集まります/;

beforeEach(async () => {
    window.history.replaceState({}, "", "/");
    mockUserFetch.mockReset();
    const { resetFollowingCache } = await import("../../lib/hooks/useFollow");
    resetFollowingCache();
});

describe("フォロー中フィードの空表示", () => {
    it("取得が終わるまで「0人」の画面を出さない", async () => {
        let settle: ((v: unknown) => void) | null = null;
        mockUserFetch.mockImplementation(() => new Promise((res) => { settle = res; }));

        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        fireEvent.click(await screen.findByRole("button", { name: "フォロー中" }));

        expect(screen.queryByText(EMPTY), "取得中なのに「0人」の画面を出している").toBeNull();

        settle!({ ok: true, json: async () => ({ userIds: ["u1"] }) });
        // 届いたら写真が出る（＝空表示にはならない）
        await waitFor(() => expect(screen.queryByText(EMPTY)).toBeNull());
    });

    it("本当に0人なら、今までどおり案内を出す", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ userIds: [] }) });

        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        fireEvent.click(await screen.findByRole("button", { name: "フォロー中" }));

        expect(await screen.findByText(EMPTY)).toBeInTheDocument();
    });

    it("検索語で0件になったときは「条件に一致する写真がありません」を出す", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ userIds: ["u1"] }) });
        window.history.replaceState({}, "", "/?feed=following&q=zzzznomatch");

        render(<ToastProvider><GalleryPageClient /></ToastProvider>);

        // リセットで feed ごと戻せる方の分岐に落ちる
        expect(await screen.findByText(/条件に一致する写真がありません/)).toBeInTheDocument();
        expect(screen.queryByText(EMPTY), "0件の理由を取り違えている").toBeNull();
    });
});
