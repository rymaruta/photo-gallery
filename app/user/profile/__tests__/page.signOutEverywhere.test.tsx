import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * **すべての端末からログアウトできること。**
 *
 * **Cognito はパスワードを変えても既存のトークンを失効させない。** だから
 * 「誰かに入られたかもしれない」ときに、パスワードを変えるだけでは相手の
 * セッションが残る——それを止める手段がサイトに1つも無かった
 * （`globalSignOut` はリポジトリ全体で0件だった）。
 *
 * **押した端末もログアウトになる**ので、そのままここに留めるとログイン中の
 * 顔のまま何をしても失敗する。ログイン画面へ送るところまでを見る。
 */

const mockShowToast = vi.fn();
const mockUserFetch = vi.fn();
const mockReplace = vi.hoisted(() => vi.fn());
const mockSignOutEverywhere = vi.hoisted(() => vi.fn());

vi.mock("../BlockedUsers", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: mockReplace }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));
vi.mock("../../../../lib/utils/image", () => ({
    toUploadSafeFile: async (f: File) => f,
    UnstrippableFileError: class extends Error { },
    AVATAR_MAX_PX: 512,
    COVER_MAX_PX: 1280,
}));
vi.mock("../../../components/DeleteAccountModal", () => ({ default: () => null }));
vi.mock("../../../../lib/auth/cognito", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/auth/cognito")>()),
    getCurrentEmail: async () => "me@example.com",
    signOutEverywhere: (...a: unknown[]) => mockSignOutEverywhere(...a),
}));

const ProfilePage = (await import("../page")).default;

const ok = (data: unknown) => ({ ok: true, json: async () => data });
const STORED = { userId: "u1", username: "tabibito", displayName: "旅人", bio: "こんにちは" };

async function openLoaded() {
    mockUserFetch.mockResolvedValueOnce(ok(STORED)).mockResolvedValueOnce(ok({}));
    render(<ProfilePage />);
    await screen.findByDisplayValue("旅人");
}

const btn = () => screen.getByRole("button", { name: /すべての端末からログアウトする/ });
const lastToast = () => mockShowToast.mock.calls.at(-1);

beforeEach(() => {
    mockShowToast.mockReset();
    mockUserFetch.mockReset().mockResolvedValue(ok({}));
    mockReplace.mockReset();
    mockSignOutEverywhere.mockReset().mockResolvedValue({ success: true });
});

describe("すべての端末からログアウト", () => {
    it("ボタンがあり、押すと呼ばれる", async () => {
        await openLoaded();
        await userEvent.click(btn());
        await waitFor(() => expect(mockSignOutEverywhere).toHaveBeenCalledTimes(1));
    });

    // **押した端末も落ちる。** ここに留めると、ログイン中の顔のまま
    // 何をしても失敗する状態になる
    it("成功したらログイン画面へ送る", async () => {
        await openLoaded();
        await userEvent.click(btn());
        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"));
        expect(lastToast()?.[1]).toBe("success");
        expect(lastToast()?.[0]).toContain("すべての端末");
    });

    it("失敗したら理由を出し、送り出さない", async () => {
        mockSignOutEverywhere.mockResolvedValue({ success: false, error: "ネットワークにつながりません。接続を確認してもう一度お試しください" });
        await openLoaded();
        await userEvent.click(btn());

        await waitFor(() => expect(lastToast()?.[1]).toBe("error"));
        expect(lastToast()?.[0]).toContain("ネットワーク");
        expect(mockReplace, "失敗したのにログイン画面へ送っている").not.toHaveBeenCalled();
    });

    // **パスワードを変えただけでは足りない**ことを画面で言う。言わないと
    // 「パスワードを変えたから安全」と思ったまま相手のセッションが残る
    it("パスワード変更だけでは他の端末が残る、と画面に書いてある", async () => {
        await openLoaded();
        expect(screen.getByText(/パスワードを変えただけでは他の端末はログインしたまま/)).toBeInTheDocument();
    });

    // プロフィールの保存とは別の口（パスワード・メールと同じ理由）
    it("プロフィールの保存では呼ばない", async () => {
        await openLoaded();
        await userEvent.clear(screen.getByDisplayValue("旅人"));
        await userEvent.type(screen.getByLabelText(/表示名/), "旅人2");
        await userEvent.click(screen.getByRole("button", { name: /^保存する$/ }));

        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        expect(mockSignOutEverywhere).not.toHaveBeenCalled();
        expect(mockReplace).not.toHaveBeenCalled();
    });
});
