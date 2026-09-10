import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **管理画面だけ「個別ページは残る」と言っていなかった。**
// 利用者側の3画面は `toastWithStaticPage` で毎回言うのに、ここは固定文。
// 本番は `REBUILD_DISPATCH_TOKEN` 未設定なので毎回残る＝**管理者だけが
// 「消えた／隠れた」と思い込む**状態だった。
//
// 直したのに**テストを1本も足しておらず**、トーストを元の固定文に戻す
// 変異が 4,249件すべて緑だった（レビューが実証）。

const mockAuthFetch = vi.hoisted(() => vi.fn());
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
    id: "A", src: "https://cdn/A.jpg",
    title: { en: "", ja: "海" },
    location: "北海道", category: "風景", date: "2024-10-12", tags: [], published: true, exif: {},
};

const toasts = () => mockShowToast.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
    mockShowToast.mockReset();
    stableRouter.push.mockReset();
    mockAuthFetch.mockReset();
});

/** 読み込み → 撮影地を消して保存。PUT の応答は `res` */
async function clearLocationAndSave(res: Record<string, unknown>) {
    mockAuthFetch.mockImplementation((url: string, init?: { method?: string }) => {
        if (init?.method === "PUT") return Promise.resolve({ ok: true, json: async () => res });
        return Promise.resolve({ ok: true, json: async () => [PHOTO] });
    });
    render(<EditPage />);
    const loc = await screen.findByDisplayValue("北海道");
    await userEvent.clear(loc);
    await userEvent.click(screen.getByRole("button", { name: /保存/ }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
}

describe("管理画面の保存: 静的ページの断り", () => {
    it("消した内容がページに残るなら、そう言う", async () => {
        await clearLocationAndSave({ success: true, photo: PHOTO, staticOutdated: true });
        expect(toasts()[0], "管理者だけが「消えた」と思い込む").toMatch(/残ることがあります/);
    });

    it("隠したページがまだ取れるなら、そう言う", async () => {
        await clearLocationAndSave({ success: true, photo: PHOTO, staticStale: true });
        expect(toasts()[0]).toMatch(/残ることがあります/);
    });

    // **毎回は言わない。** 公開中の写真を保存するたびに断りが出ると、
    // 肝心のときに読まれない
    it("掃除が届いたなら、今までどおり", async () => {
        await clearLocationAndSave({ success: true, photo: PHOTO });
        expect(toasts()[0]).toBe("保存しました");
    });

    // **`readApiError` に寄せる。** 自前で `err.error` を読んでいたので、
    // API Gateway の期限切れ応答 `{"message":"Unauthorized"}` には
    // `error` が無く「保存に失敗しました」に落ちていた
    // ——押し直しても直らないのに、直りそうな文言だった。
    // 同じ管理画面でも削除は寄せ済みだった（対の乖離）
    it("セッション切れは、押し直せば直る文言にしない", async () => {
        mockAuthFetch.mockImplementation((url: string, init?: { method?: string }) => {
            if (init?.method === "PUT") {
                return Promise.resolve({
                    ok: false, status: 401,
                    clone: () => ({ json: async () => ({ message: "Unauthorized" }) }),
                    json: async () => ({ message: "Unauthorized" }),
                });
            }
            return Promise.resolve({ ok: true, json: async () => [PHOTO] });
        });
        render(<EditPage />);
        await screen.findByDisplayValue("北海道");
        await userEvent.click(screen.getByRole("button", { name: /保存/ }));

        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        expect(toasts()[0], "押し直しても直らないのに、直りそうな文言").toMatch(/ログイン|セッション/);
        expect(stableRouter.push, "失敗したのに一覧へ戻している").not.toHaveBeenCalled();
    });
});
