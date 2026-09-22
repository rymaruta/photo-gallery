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

// ブロック一覧は別のテスト（`BlockedUsers.test.tsx`）が見る
vi.mock("../BlockedUsers", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: mockReplace }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));
vi.mock("../../../components/DeleteAccountModal", () => ({ default: () => null }));
vi.mock("../../../../lib/auth/cognito", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/auth/cognito")>()),
    getCurrentEmail: async () => "me@example.com",
    signOutEverywhere: (...a: unknown[]) => mockSignOutEverywhere(...a),
}));

const SettingsPage = (await import("../page")).default;

const ok = (data: unknown) => ({ ok: true, json: async () => data });

// プロフィールの読み込みはこの画面に無い（`/user/profile` に残っている）。
// 描くだけで、いまのメールアドレスを読む `getCurrentEmail` の解決を待つ
async function openLoaded() {
    render(<SettingsPage />);
    await screen.findByRole("heading", { name: "設定" });
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
    // 元はプロフィール編集と同じ画面にあり、「保存を押したら全端末から
    // ログアウトされた」形にしていないことを見張っていた。
    // `/user/settings` へ分けた 2026-09-21 以降は**構造的に起こりえない**
    // ——この画面に保存ボタンが無い。判定を言い換える
    it("プロフィールを保存する口を持たない（混ざりようが無い）", async () => {
        await openLoaded();

        expect(screen.queryByRole("button", { name: /^保存する$/ }),
            "設定にプロフィールの保存ボタンが戻っている").toBeNull();
        expect(screen.queryByLabelText(/表示名/),
            "設定にプロフィールの項目が戻っている").toBeNull();
        // 描いただけでは何も起きない（押すまで送らない・送り出さない）
        expect(mockSignOutEverywhere).not.toHaveBeenCalled();
        expect(mockReplace).not.toHaveBeenCalled();
    });
});
