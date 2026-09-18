import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * **「おすすめ」は運営が選ぶ**（owner の要望・手で決める）。
 *
 * まとめ方は `lib/utils/__tests__/featured.test.ts`、トップの配線は
 * `GalleryPageClient.featured.test.tsx` が見る。ここは**印の付け外し**。
 *
 * **自分の編集画面（`/user/edit`）には置かない**——利用者が自分の写真を
 * トップへ出せると「おすすめ」の意味が消える。その不在もここで見る。
 */
const mockAuthFetch = vi.hoisted(() => vi.fn());
// **毎回新しい関数を返さない。** 取得の effect が `showToast` に依存して
// いるので、再描画のたびに再取得が走って読み込み画面のまま固まる
// （このリポジトリが `useRouter` で一度踏んだ型）
const mockShowToast = vi.hoisted(() => vi.fn());
const stableRouter = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };

vi.mock("next/navigation", () => ({
    useRouter: () => stableRouter,
    useSearchParams: () => ({ get: (k: string) => (k === "id" ? "A" : null) }),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    authenticatedFetch: mockAuthFetch,
}));

const EditPage = (await import("../page")).default;

const PHOTO = {
    id: "A", src: "https://cdn/A.jpg", title: { en: "", ja: "海" },
    location: "北海道", category: "風景", date: "2024-10-12", tags: [], published: true, exif: {},
};

const load = async (over: Record<string, unknown> = {}) => {
    mockAuthFetch.mockImplementation((url: string, init?: { method?: string }) => {
        if (init?.method === "PUT") return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
        // **管理の取得は一覧を返す**（ページが id で探す）。1件の object を
        // 返すと `find` に来る前に落ちて「写真の読み込みに失敗しました」になる
        return Promise.resolve({ ok: true, json: async () => [{ ...PHOTO, ...over }] });
    });
    render(<EditPage />);
    await screen.findByDisplayValue("北海道");
};
const putBody = () => {
    const call = mockAuthFetch.mock.calls.find((c) => (c[1] as { method?: string })?.method === "PUT");
    return JSON.parse((call?.[1] as { body: string }).body) as Record<string, unknown>;
};

beforeEach(() => { mockAuthFetch.mockReset(); stableRouter.push.mockReset(); });

describe("管理画面: おすすめの付け外し", () => {
    it("切り替えがある", async () => {
        await load();
        expect(screen.getByRole("switch", { name: /おすすめ/ }), "導線が無い").toBeInTheDocument();
    });

    it("いまの状態を読み込んで出す", async () => {
        await load({ featured: true });
        expect(screen.getByRole("switch", { name: /おすすめ/ }), "付いているのに未選択に見える")
            .toHaveAttribute("aria-checked", "true");
    });

    it("印が無ければ未選択", async () => {
        await load();
        expect(screen.getByRole("switch", { name: /おすすめ/ })).toHaveAttribute("aria-checked", "false");
    });

    it("押して保存すると、印が送られる", async () => {
        await load();
        await userEvent.click(screen.getByRole("switch", { name: /おすすめ/ }));
        await userEvent.click(screen.getByRole("button", { name: /保存/ }));
        await waitFor(() => expect(putBody().featured, "印が送られていない").toBe(true));
    });

    it("押し直すと外れる", async () => {
        await load({ featured: true });
        await userEvent.click(screen.getByRole("switch", { name: /おすすめ/ }));
        await userEvent.click(screen.getByRole("button", { name: /保存/ }));
        await waitFor(() => expect(putBody().featured, "外せていない").toBe(false));
    });
});
