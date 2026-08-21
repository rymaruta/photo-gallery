import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// 退会は不可逆で、しかも**2つの系にまたがる**（サーバーのデータと Cognito の
// アカウント）。順序を誤ると、利用者に何も知らせないまま矛盾した状態になる:
//
//   ログインしたままタブを放置してリフレッシュトークンが古くなる
//   → 退会を押す → DELETE /user/account は 200（写真も S3 もプロフィールも消える）
//   → Cognito の削除が「セッションが無効です」で失敗
//   → 画面には「退会処理に失敗しました」とだけ出る
//   利用者はログインしたままで、ギャラリーだけが空になる。
//   「失敗した」と言われているので、消えたことに気づく手がかりが無い。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockGetCurrentSession = vi.hoisted(() => vi.fn());
const mockCognitoDelete = vi.hoisted(() => vi.fn());
const mockSignOut = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());

const stableRouter = { push: mockPush, replace: vi.fn() };
vi.mock("next/navigation", () => ({
    useRouter: () => stableRouter,
    usePathname: () => "/user/profile",
}));
vi.mock("../../../lib/utils/api", () => ({ userFetch: mockUserFetch }));
vi.mock("../../../lib/auth/cognito", () => ({
    signIn: vi.fn(),
    signOut: mockSignOut,
    getCurrentSession: mockGetCurrentSession,
    deleteAccount: mockCognitoDelete,
}));
vi.mock("../../../lib/hooks/useFollow", () => ({ resetFollowingCache: vi.fn() }));

const { AuthProvider, useAuth } = await import("../context");

/** 退会を押して、返ってきた結果をそのまま画面に出すだけの部品 */
function Harness() {
    const { deleteAccount } = useAuth();
    const [result, setResult] = React.useState<string>("");
    return (
        <>
            <button onClick={() => void deleteAccount().then((r) => setResult(JSON.stringify(r)))}>
                退会する
            </button>
            <output>{result}</output>
        </>
    );
}

const validSession = { isValid: () => true, getIdToken: () => ({ getJwtToken: () => "jwt" }) };
const expiredSession = { isValid: () => false, getIdToken: () => ({ getJwtToken: () => "jwt" }) };

const clickDelete = async () => {
    render(<AuthProvider><Harness /></AuthProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "退会する" }));
};
const result = async () => {
    await waitFor(() => expect(screen.getByRole("status").textContent).not.toBe(""));
    return JSON.parse(screen.getByRole("status").textContent!) as { success: boolean; error?: string };
};

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    mockGetCurrentSession.mockReset().mockResolvedValue(validSession);
    mockCognitoDelete.mockReset().mockResolvedValue({ success: true });
    mockSignOut.mockReset();
    mockPush.mockReset();
});

describe("退会: 消す前に、後段が通ることを確かめる", () => {
    it("セッションが切れていたら、サーバーのデータを消しに行かない", async () => {
        mockGetCurrentSession.mockResolvedValue(expiredSession);
        await clickDelete();

        const r = await result();
        expect(r.success).toBe(false);
        // ここが肝。DELETE を投げていない＝写真もプロフィールも残っている
        const deletes = mockUserFetch.mock.calls.filter(
            (c) => (c[1] as { method?: string } | undefined)?.method === "DELETE");
        expect(deletes).toHaveLength(0);
        expect(mockCognitoDelete).not.toHaveBeenCalled();
        expect(r.error).toContain("ログインし直して");
    });

    it("セッションがそもそも無ければ何も消さない", async () => {
        mockGetCurrentSession.mockResolvedValue(null);
        await clickDelete();

        expect((await result()).success).toBe(false);
        expect(mockUserFetch.mock.calls.filter(
            (c) => (c[1] as { method?: string } | undefined)?.method === "DELETE")).toHaveLength(0);
    });

    // 事前確認を通ってもなお Cognito 側が落ちることはある（通信断など）。
    // そのときは「何も起きなかった」と読める文言にしない。
    it("データ削除後に Cognito が落ちたら、消えたことを伝える", async () => {
        mockCognitoDelete.mockResolvedValue({ success: false, error: "セッションが無効です" });
        await clickDelete();

        const r = await result();
        expect(r.success).toBe(false);
        expect(r.error).toContain("削除されました");
        expect(r.error).toContain("アカウント自体の削除だけが残っています");
        // 「退会処理に失敗しました」だけ、では読み手に何も伝わらない
        expect(r.error).not.toBe("アカウントの削除に失敗しました");
    });

    it("サーバー側が落ちたら Cognito は消さない（消えないアカウントを残さない）", async () => {
        mockUserFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        await clickDelete();

        expect((await result()).success).toBe(false);
        expect(mockCognitoDelete).not.toHaveBeenCalled();
    });

    it("両方通れば成功し、サインアウトしてトップへ戻す", async () => {
        await clickDelete();

        expect((await result()).success).toBe(true);
        expect(mockSignOut).toHaveBeenCalled();
        expect(mockPush).toHaveBeenCalledWith("/");
    });
});
