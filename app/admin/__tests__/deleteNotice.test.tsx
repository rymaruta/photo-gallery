import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **管理画面の削除だけ「個別ページは残る」と言っていなかった。**
// 利用者側の3画面は `toastWithStaticPage` で毎回言うのに、ここは固定文。
// 本番は `REBUILD_DISPATCH_TOKEN` 未設定なので毎回残る＝**管理者だけが
// 「消えた」と思い込む**状態だった。
//
// 直したのに**テストを1本も足しておらず**、トーストを元の固定文に戻す
// 変異が 4,249件すべて緑だった（レビューが実証）。

const mockShowToast = vi.hoisted(() => vi.fn());
const mockAuthFetch = vi.hoisted(() => vi.fn());
const stableRouter = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };

vi.mock("next/navigation", () => ({ useRouter: () => stableRouter }));
vi.mock("../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: true, isGeneralUser: false, loading: false }),
}));
vi.mock("../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../lib/utils/api")>()),
    authenticatedFetch: (...a: unknown[]) => mockAuthFetch(...a),
}));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const AdminPage = (await import("../page")).default;

const PHOTO = {
    id: "A", src: "https://cdn/A.jpg", title: { ja: "海", en: "" },
    location: "北海道", category: "風景", date: "2024-10-12", tags: [], published: true,
};

const toasts = () => mockShowToast.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
    mockShowToast.mockReset();
    mockAuthFetch.mockReset();
});

/** 一覧 → 削除 → 確認。DELETE の応答は `res` */
async function deletePhoto(res: Record<string, unknown>) {
    mockAuthFetch.mockImplementation((url: string, init?: { method?: string }) => {
        if (init?.method === "DELETE") return Promise.resolve({ ok: true, json: async () => res });
        return Promise.resolve({ ok: true, json: async () => [PHOTO] });
    });
    render(<AdminPage />);
    await userEvent.click(await screen.findByRole("button", { name: /削除/ }));
    // 確認シートの「削除」を押す（一覧側のボタンと同名なので最後のものを取る）
    const confirm = screen.getAllByRole("button", { name: /削除/ }).slice(-1)[0];
    await userEvent.click(confirm);
    await waitFor(() => expect(
        mockAuthFetch.mock.calls.some((c) => (c[1] as { method?: string })?.method === "DELETE"),
    ).toBe(true));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
}

describe("管理画面の削除: 静的ページの断り", () => {
    it("掃除が届かなければ、個別ページが残ることを言う", async () => {
        await deletePhoto({ success: true, staticStale: true });
        expect(toasts()[0], "管理者だけが「消えた」と思い込む").toMatch(/残ることがあります/);
    });

    // **毎回は言わない。** 届いたときまで断ると、肝心のときに読まれない
    it("掃除が届いたなら、今までどおり", async () => {
        await deletePhoto({ success: true });
        expect(toasts()[0]).toBe("写真を削除しました");
        expect(toasts()[0]).not.toMatch(/残ることがあります/);
    });
});
