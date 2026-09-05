import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// 利用者の編集画面（`app/user/edit`）と同じ穴。`w-full max-h-64 object-contain`
// は高さを予約しないので、写真が 403/404 になると **358x0 に潰れて**
// 「どの写真を触っているか」が画面から消える（Chromium 実測）。

const mockAuthFetch = vi.hoisted(() => vi.fn());
const stableRouter = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };

vi.mock("next/navigation", () => ({
    useRouter: () => stableRouter,
    useSearchParams: () => ({ get: (k: string) => (k === "id" ? "A" : null) }),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
// **`showToast` は同一性を保つ。** 毎回新しい関数を返すと、取得の effect の
// deps が毎描画で変わって再取得が走る（本番の `useToast` は useCallback で
// 安定しているので、これはハーネス側の作り物）
const mockShowToast = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", () => ({ authenticatedFetch: mockAuthFetch }));

const EditPage = (await import("../page")).default;

const PHOTO = {
    id: "A", src: "https://cdn/gone.jpg",
    title: { ja: "海の朝" }, location: "北海道", category: "風景",
    tags: ["朝"], published: true, exif: {},
};

beforeEach(() => {
    mockAuthFetch.mockReset().mockImplementation((_url: string, init?: { method?: string }) =>
        Promise.resolve(init?.method === "PUT"
            ? { ok: true, json: async () => ({ success: true }) }
            : { ok: true, json: async () => [PHOTO] }));
});

const photoImg = () =>
    Array.from(document.body.querySelectorAll("img")).find((el) => el.getAttribute("src")?.includes("gone.jpg"));

describe("管理の編集画面の写真が取れないとき", () => {
    it("枠ごと消さずに理由を出す", async () => {
        render(<EditPage />);
        await screen.findByDisplayValue("海の朝");

        const img = photoImg();
        expect(img, "編集中の写真が出ていない").toBeDefined();
        fireEvent.error(img!);

        expect(await screen.findByText("画像を読み込めません")).toBeInTheDocument();
        expect(photoImg(), "取れなかった img をそのまま残している").toBeUndefined();
        expect(screen.getByDisplayValue("海の朝")).toBeInTheDocument();
    });

    it("読み込める写真では出さない", async () => {
        render(<EditPage />);
        await screen.findByDisplayValue("海の朝");
        expect(screen.queryByText("画像を読み込めません")).toBeNull();
        expect(photoImg()).toBeDefined();
    });
});
