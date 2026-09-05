import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// **写真が取れないと、編集画面から写真の枠ごと消えていた。**
// `w-full max-h-64 object-contain` は高さを予約しないので、403/404 になると
// **358x0 に潰れる**（Chromium 実測: 成功 358x256 → 失敗 358x0）。
// 削除済みの写真の URL が静的HTMLに残っている間（再ビルドまで最大7日）や、
// 原本が消えている古い行で起きる。「どの写真を触っているか」が消える。

const mockUserFetch = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams("id=p1"),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
// **`showToast` は同一性を保つ。** 毎回新しい関数を返すと、取得の effect の
// deps が毎描画で変わって再取得が走る（本番の `useToast` は useCallback で
// 安定しているので、これはハーネス側の作り物）
const mockShowToast = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    readApiError: async (_r: Response, f: string) => f,
}));

const EditPage = (await import("../page")).default;

const PHOTOS = [{ id: "p1", src: "https://cdn/gone.jpg", userId: "me", title: "湖", location: "パリ" }];

beforeEach(() => {
    mockUserFetch.mockReset().mockImplementation((_url: string, init?: { method?: string }) =>
        Promise.resolve(init?.method
            ? { ok: true, json: async () => ({ success: true }) }
            : { ok: true, json: async () => PHOTOS }));
});

const photoImg = () =>
    Array.from(document.body.querySelectorAll("img")).find((el) => el.getAttribute("src")?.includes("gone.jpg"));

describe("編集画面の写真が取れないとき", () => {
    it("枠ごと消さずに理由を出す", async () => {
        render(<EditPage />);
        await screen.findByDisplayValue("湖");

        const img = photoImg();
        expect(img, "編集中の写真が出ていない").toBeDefined();
        fireEvent.error(img!);

        expect(screen.getByText("画像を読み込めません")).toBeInTheDocument();
        // 潰れた img を残さない（高さ0の帯が残ると、何も無いのと同じ）
        expect(photoImg(), "取れなかった img をそのまま残している").toBeUndefined();
        // 編集そのものは続けられる
        expect(screen.getByDisplayValue("湖")).toBeInTheDocument();
    });

    // 正常系: 読み込める写真では何も出さない
    it("読み込める写真では出さない", async () => {
        render(<EditPage />);
        await screen.findByDisplayValue("湖");
        expect(screen.queryByText("画像を読み込めません")).toBeNull();
        expect(photoImg()).toBeDefined();
    });
});
