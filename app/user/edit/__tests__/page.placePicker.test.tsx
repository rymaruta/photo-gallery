import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **地図に出す位置は、撮影者本人が選ぶ。**
// 地名は自由入力なので、機械では「福岡」が福岡市か富山県の福岡町か決められない
// （本番のドライランでどちらも起きた: 「福岡」→ 富山県の福岡町、
// 「土谷棚田」→ 名古屋市の図書館）。当てに行くのをやめて、候補を出して選ばせる。

const mockUserFetch = vi.hoisted(() => vi.fn());
const showToast = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams("id=p1"),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast }) }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    readApiError: async (_r: Response, f: string) => f,
}));

const EditPage = (await import("../page")).default;

const PHOTO = { id: "p1", src: "s", userId: "me", title: "海", location: "福岡", published: true };
const CANDIDATES = [
    { label: "福岡市, 福岡県, 日本", lat: 33.59, lng: 130.4 },
    { label: "福岡, 高岡市, 富山県, 日本", lat: 36.71, lng: 136.93 },
];

/** 保存で送った本文 */
const savedBody = () => {
    const call = mockUserFetch.mock.calls.find((c) => (c[1] as { method?: string })?.method === "PUT");
    return call ? JSON.parse((call[1] as { body: string }).body) : null;
};

beforeEach(() => {
    showToast.mockReset();
    mockUserFetch.mockReset().mockImplementation((url: string, init?: { method?: string }) => {
        if (url.startsWith("/geocode/search")) {
            return Promise.resolve({ ok: true, json: async () => ({ results: CANDIDATES }) });
        }
        if (!init?.method) return Promise.resolve({ ok: true, json: async () => [PHOTO] });
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
    });
});

describe("地図に出す位置を選ぶ", () => {
    it("未設定なら、そう伝える（勝手に地図へ出さない）", async () => {
        render(<EditPage />);
        expect(await screen.findByTestId("coords-state")).toHaveTextContent("未設定");
    });

    it("押したときだけ探しに行き、候補から選ぶと保存に載る", async () => {
        const user = userEvent.setup();
        render(<EditPage />);
        await screen.findByDisplayValue("海");

        // **打鍵では投げない**（Nominatim は打鍵ごとの検索を規約で禁じている）
        expect(mockUserFetch.mock.calls.some((c) => String(c[0]).startsWith("/geocode/search"))).toBe(false);

        await user.click(screen.getByRole("button", { name: "この場所名で候補を出す" }));
        await waitFor(() => expect(mockUserFetch.mock.calls.some((c) => String(c[0]).includes("/geocode/search"))).toBe(true));
        expect(decodeURIComponent(String(mockUserFetch.mock.calls.find((c) => String(c[0]).includes("/geocode/search"))![0]))).toContain("q=福岡");

        // 同名の別の場所も並ぶ——どちらが正しいかは撮影者しか知らない
        await user.click(await screen.findByRole("button", { name: "福岡, 高岡市, 富山県, 日本" }));
        expect(screen.getByTestId("coords-state")).toHaveTextContent("36.71, 136.93");

        await user.click(screen.getByRole("button", { name: "保存する" }));
        await waitFor(() => expect(savedBody()).toBeTruthy());
        expect(savedBody().coords).toEqual({ lat: 36.71, lng: 136.93 });
    });

    it("地名が空なら探せない（空で投げない）", async () => {
        const user = userEvent.setup();
        render(<EditPage />);
        const loc = await screen.findByDisplayValue("福岡");
        await user.clear(loc);
        expect(screen.getByRole("button", { name: "この場所名で候補を出す" })).toBeDisabled();
    });

    it("見つからなければ、次にやることを伝える", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (url.startsWith("/geocode/search")) return Promise.resolve({ ok: true, json: async () => ({ results: [] }) });
            if (!init?.method) return Promise.resolve({ ok: true, json: async () => [PHOTO] });
            return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
        });
        const user = userEvent.setup();
        render(<EditPage />);
        await screen.findByDisplayValue("海");
        await user.click(screen.getByRole("button", { name: "この場所名で候補を出す" }));
        await waitFor(() => expect(showToast).toHaveBeenCalled());
        expect(showToast.mock.calls.at(-1)![0]).toMatch(/市区町村を足すと/);
    });

    // 逆向き: 位置を触らない保存では coords を送らない（別タブの編集を消さない）
    it("位置を触らなければ、保存に coords は載らない", async () => {
        const user = userEvent.setup();
        render(<EditPage />);
        const title = await screen.findByDisplayValue("海");
        await user.clear(title);
        await user.type(title, "海辺");
        await user.click(screen.getByRole("button", { name: "保存する" }));
        await waitFor(() => expect(savedBody()).toBeTruthy());
        expect(savedBody()).not.toHaveProperty("coords");
    });

    it("すでに位置があれば「地図に出さない」で外せる", async () => {
        mockUserFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (!init?.method) return Promise.resolve({ ok: true, json: async () => [{ ...PHOTO, coords: { lat: 35.68, lng: 139.76 } }] });
            return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
        });
        const user = userEvent.setup();
        render(<EditPage />);
        await waitFor(() => expect(screen.getByTestId("coords-state")).toHaveTextContent("35.68, 139.76"));
        await user.click(screen.getByRole("button", { name: "地図に出さない" }));
        expect(screen.getByTestId("coords-state")).toHaveTextContent("未設定");
        await user.click(screen.getByRole("button", { name: "保存する" }));
        await waitFor(() => expect(savedBody()).toBeTruthy());
        expect(savedBody().coords).toBeNull();
    });
});
