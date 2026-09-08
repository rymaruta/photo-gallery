import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AUTH_REQUIRED_MESSAGE, NETWORK_UNREACHABLE_MESSAGE } from "../../../../lib/utils/api";

// **セッションが切れているのに「保存に失敗しました。」だけ出していた。**
// 裸の catch がトークン切れを塗り潰すので、**再ログインすれば直ると
// 分からず**、同じ操作を繰り返すことになる。
// 同じファイルのアバター・カバーは `AUTH_REQUIRED_MESSAGE` を見分けている
// ——対の乖離。

const mockShowToast = vi.fn();
const mockUserFetch = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", async () => {
    const actual = await vi.importActual<typeof import("../../../../lib/utils/api")>("../../../../lib/utils/api");
    return { ...actual, userFetch: (...args: unknown[]) => mockUserFetch(...args) };
});
vi.mock("../../../../lib/utils/image", () => ({
    toUploadSafeFile: async (f: File) => f,
    UnstrippableFileError: class extends Error {},
    AVATAR_MAX_PX: 512, COVER_MAX_PX: 1280,
}));
vi.mock("../../../components/DeleteAccountModal", () => ({ default: () => null }));

const ProfilePage = (await import("../page")).default;

const STORED = { userId: "u1", username: "tabibito", displayName: "旅人", bio: "こんにちは" };
const toasts = () => mockShowToast.mock.calls.map((c) => String(c[0]));

beforeEach(() => { mockShowToast.mockReset(); mockUserFetch.mockReset(); });

async function openAndSave(onSave: () => Promise<unknown>) {
    // 起動時の読み込みは1回だけ。2回消費すると保存の PUT が
    // 「成功した応答」を食べてしまう（最初これで空振りした）
    mockUserFetch
        .mockResolvedValueOnce({ ok: true, json: async () => STORED })
        .mockImplementation((_p: string, init?: { method?: string }) =>
            init?.method === "PUT" ? onSave() : Promise.resolve({ ok: true, json: async () => ({}) }));
    render(<ProfilePage />);
    const bio = await screen.findByDisplayValue("こんにちは");
    await userEvent.type(bio, "！");
    await userEvent.click(await screen.findByRole("button", { name: /保存/ }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
}

describe("/user/profile の保存: 理由を塗り潰さない", () => {
    it("セッションが切れていたら、そう伝える（押し直しても直らないので）", async () => {
        await openAndSave(() => Promise.reject(new Error(AUTH_REQUIRED_MESSAGE)));
        expect(toasts(), "「保存に失敗しました。」で塗り潰している").toContain(AUTH_REQUIRED_MESSAGE);
    });

    it("通信が落ちただけなら、今までどおり「保存に失敗しました。」", async () => {
        await openAndSave(() => Promise.reject(new TypeError("Failed to fetch")));
        expect(toasts()).toContain("保存に失敗しました。");
        expect(toasts(), "無関係な失敗にログインの話を出している").not.toContain(AUTH_REQUIRED_MESSAGE);
    });

    // **確かめられなかっただけの回に「ログインしてください」と言わない。**
    // 言われたとおりログインし直そうにも、その通信も通らない
    it("通信できないときは、そう伝える（ログインの話をしない）", async () => {
        await openAndSave(() => Promise.reject(new Error(NETWORK_UNREACHABLE_MESSAGE)));
        expect(toasts()).toContain(NETWORK_UNREACHABLE_MESSAGE);
        expect(toasts(), "通信の問題なのにログインの話をしている").not.toContain(AUTH_REQUIRED_MESSAGE);
    });

    it("サーバーが理由を返したときは、その文言（既存の振る舞い）", async () => {
        await openAndSave(async () => ({ ok: false, status: 409, json: async () => ({ error: "そのユーザー名は既に使われています" }) }));
        expect(toasts()).toContain("そのユーザー名は既に使われています");
    });
});
