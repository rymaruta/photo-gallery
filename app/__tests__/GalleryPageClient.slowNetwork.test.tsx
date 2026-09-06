import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// 「回線が遅い・返らない」ときの画面。実測（実ブラウザ・応答を保持）で
// 出ていた2つ:
//  - 通知や共有リンクから開いた `?photo=` が**永久に開かず、理由も出ない**
//    （3秒・10秒・30秒とも モーダルもトーストも無し）
//  - 「フォロー中」タブが**完全な空白**（読み込み中とも失敗とも分からない）

const showToast = vi.hoisted(() => vi.fn());
vi.mock("../../lib/hooks/useToast", () => ({
    useToast: () => ({ showToast, toasts: [], removeToast: vi.fn() }),
    ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, userId: "me", loading: false }) }));
vi.mock("../i18n/context", () => ({
    useLocale: () => ({ locale: "ja", labels: { category: { all: "すべて", names: {} }, site: { title: "Gallery" } } }),
}));
const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../lib/utils/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    publicFetch: vi.fn(() => new Promise(() => {})),
    userPublicFetch: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../components/FilterBar", () => ({ default: () => null }));
vi.mock("../components/stories/StoriesBar", () => ({ default: () => null }));
vi.mock("../components/GalleryGrid", () => ({ default: () => <div>grid</div> }));
vi.mock("../components/GalleryModal", () => ({ default: () => <div>modal</div> }));
// `?photo=` は `SearchParamWatcher` 経由で入る。**本物に近い形で渡す**
// （null を返す偽物だと、この経路のテストが何も測らない）
function FakeSearchParamWatcher({ name, onChange }: { name: string; onChange: (v: string | null) => void }) {
    React.useEffect(() => {
        onChange(new URLSearchParams(window.location.search).get(name));
    }, [name, onChange]);
    return null;
}
vi.mock("../components/SearchParamWatcher", () => ({ default: FakeSearchParamWatcher }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const photosState = vi.hoisted(() => ({ current: { loaded: false, failed: false } }));
vi.mock("../../lib/hooks/usePhotos", () => ({
    usePhotos: () => ({ photos: [], loading: false, ...photosState.current }),
}));

import ToastProvider from "../components/ToastProvider";
const GalleryPageClient = (await import("../GalleryPageClient")).default;

beforeEach(async () => {
    showToast.mockReset();
    photosState.current = { loaded: false, failed: false };
    window.history.replaceState({}, "", "/");
    mockUserFetch.mockReset().mockImplementation(() => new Promise(() => {}));   // 返らない
    const { resetFollowingCache } = await import("../../lib/hooks/useFollow");
    resetFollowingCache();
});

describe("回線が遅いとき", () => {
    it("一覧が取れないままなら、開けない写真の理由を出す", async () => {
        photosState.current = { loaded: false, failed: true };
        window.history.replaceState({}, "", "/?photo=abc");
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        await waitFor(() => expect(showToast).toHaveBeenCalled());
        expect(showToast.mock.calls[0][0]).toMatch(/写真を読み込めませんでした/);
        expect(showToast.mock.calls[0][1]).toBe("error");
    });

    // 逆向き: **まだ来ていないだけなら黙って待つ**（届く前に嘘をつかない）
    it("まだ届いていないだけなら、何も言わずに待つ", async () => {
        photosState.current = { loaded: false, failed: false };
        window.history.replaceState({}, "", "/?photo=abc");
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        await new Promise((r) => setTimeout(r, 50));
        expect(showToast, "届く前に「読み込めませんでした」と言っている").not.toHaveBeenCalled();
    });

    it("フォロー中タブは、返ってくるまで読み込み中と言う（空白にしない）", async () => {
        photosState.current = { loaded: true, failed: false };
        window.history.replaceState({}, "", "/?feed=following");
        render(<ToastProvider><GalleryPageClient /></ToastProvider>);
        await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("読み込み中"));
        // 「0人です」とは言わない
        expect(screen.queryByText(/フォロー中の人はまだいません|0人/)).toBeNull();
    });
});
