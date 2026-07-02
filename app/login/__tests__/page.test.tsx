import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ──────────────────────────────────────────────────────────────
// localStorage モック
// ──────────────────────────────────────────────────────────────
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { store = {}; },
    };
})();
Object.defineProperty(window, "localStorage", { value: localStorageMock });

// ──────────────────────────────────────────────────────────────
// モック定義
// ──────────────────────────────────────────────────────────────
const mockPush = vi.fn();
const mockLogin = vi.fn();
const mockShowToast = vi.fn();
const mockUserFetch = vi.fn();
const mockForgotPassword = vi.fn();
const mockConfirmForgotPassword = vi.fn();

let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: vi.fn() }),
    useSearchParams: () => mockSearchParams,
}));

vi.mock("../../auth/context", () => ({
    useAuth: () => ({
        isAuthenticated: false,
        loading: false,
        login: (u: string, p: string) => mockLogin(u, p),
    }),
}));

vi.mock("../../../lib/hooks/useToast", () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock("../../../lib/auth/cognito", () => ({
    forgotPassword: (...args: unknown[]) => mockForgotPassword(...args),
    confirmForgotPassword: (...args: unknown[]) => mockConfirmForgotPassword(...args),
}));

vi.mock("../../../lib/utils/api", () => ({
    userFetch: (...args: unknown[]) => mockUserFetch(...args),
}));

vi.mock("next/link", () => ({
    default: ({ children, href }: { children: React.ReactNode; href: string }) =>
        React.createElement("a", { href }, children),
}));

import LoginPage from "../page";

beforeEach(() => {
    localStorageMock.clear();
    mockPush.mockReset();
    mockLogin.mockReset();
    mockShowToast.mockReset();
    mockUserFetch.mockReset();
    mockForgotPassword.mockReset();
    mockConfirmForgotPassword.mockReset();
    mockSearchParams = new URLSearchParams();
});

// ──────────────────────────────────────────────────────────────
// 基本的なログインフロー
// ──────────────────────────────────────────────────────────────
describe("LoginPage - 基本フロー", () => {
    it("初期表示はログインフォーム", () => {
        render(<LoginPage />);
        expect(screen.getByRole("heading", { name: "ログイン" })).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/example@email\.com/)).toBeInTheDocument();
    });

    it("?verified=1 のとき確認完了バナーが表示される", () => {
        mockSearchParams = new URLSearchParams("verified=1");
        render(<LoginPage />);
        expect(screen.getByText(/メールアドレスの確認が完了しました/)).toBeInTheDocument();
    });

    it("verifiedパラメータがないときバナーは表示されない", () => {
        render(<LoginPage />);
        expect(screen.queryByText(/メールアドレスの確認が完了しました/)).not.toBeInTheDocument();
    });

    it("ログイン成功（userIdあり）→ 自分のプロフィールページへリダイレクト", async () => {
        mockLogin.mockResolvedValue({ success: true, userId: "my-sub-123" });
        const user = userEvent.setup();
        render(<LoginPage />);

        await user.type(screen.getByPlaceholderText(/example@email\.com/), "user@example.com");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: "ログイン" }));

        await waitFor(() => {
            expect(mockPush).toHaveBeenCalledWith("/users?id=my-sub-123");
        });
        expect(mockShowToast).toHaveBeenCalledWith("ログインしました", "success");
    });

    it("ログイン成功（userIdなし）→ ルートへリダイレクト + トースト表示", async () => {
        mockLogin.mockResolvedValue({ success: true });
        const user = userEvent.setup();
        render(<LoginPage />);

        await user.type(screen.getByPlaceholderText(/example@email\.com/), "user@example.com");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: "ログイン" }));

        await waitFor(() => {
            expect(mockLogin).toHaveBeenCalledWith("user@example.com", "Password1!");
        });
        await waitFor(() => {
            expect(mockPush).toHaveBeenCalledWith("/");
        });
        expect(mockShowToast).toHaveBeenCalledWith("ログインしました", "success");
    });

    it("ログイン失敗 → エラーメッセージ表示、リダイレクトなし", async () => {
        mockLogin.mockResolvedValue({ success: false, error: "メールアドレスまたはパスワードが正しくありません" });
        const user = userEvent.setup();
        render(<LoginPage />);

        await user.type(screen.getByPlaceholderText(/example@email\.com/), "user@example.com");
        await user.type(screen.getByPlaceholderText("••••••••"), "wrongpass");
        await user.click(screen.getByRole("button", { name: "ログイン" }));

        expect(await screen.findByText(/メールアドレスまたはパスワード/)).toBeInTheDocument();
        expect(mockPush).not.toHaveBeenCalled();
    });

    it("needsVerification → 確認コード入力リンクへの誘導を表示", async () => {
        mockLogin.mockResolvedValue({
            success: false,
            needsVerification: true,
            error: "メールアドレスの確認が完了していません",
        });
        const user = userEvent.setup();
        render(<LoginPage />);

        await user.type(screen.getByPlaceholderText(/example@email\.com/), "unconfirmed@example.com");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: "ログイン" }));

        const link = await screen.findByRole("link", { name: /確認コードを入力・再送する/ });
        expect(link).toHaveAttribute("href", expect.stringContaining("/signup?email=unconfirmed%40example.com"));
    });
});

// ──────────────────────────────────────────────────────────────
// 新規登録 → ログイン後のプロフィール自動作成フロー
// ──────────────────────────────────────────────────────────────
describe("LoginPage - 表示名持ち越しによるプロフィール作成", () => {
    it("jp_pending_displayName があれば PUT /user/profile を呼んで成功時に削除する", async () => {
        localStorageMock.setItem("jp_pending_displayName", "テスト太郎");
        mockLogin.mockResolvedValue({ success: true });
        // GET（プロフィール未作成: displayName なし）→ PUT の順で呼ばれる
        mockUserFetch.mockImplementation(async (_path: string, options?: RequestInit) => {
            if (!options?.method) return { ok: true, json: async () => ({ userId: "u1" }) };
            return { ok: true };
        });

        const user = userEvent.setup();
        render(<LoginPage />);
        await user.type(screen.getByPlaceholderText(/example@email\.com/), "u@example.com");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: "ログイン" }));

        await waitFor(() => {
            expect(mockUserFetch).toHaveBeenCalledWith(
                "/user/profile",
                expect.objectContaining({
                    method: "PUT",
                    body: JSON.stringify({ displayName: "テスト太郎" }),
                }),
            );
        });
        await waitFor(() => {
            expect(localStorageMock.getItem("jp_pending_displayName")).toBeNull();
        });
        expect(mockPush).toHaveBeenCalledWith("/");
    });

    it("既にプロフィールに displayName がある場合は PUT せず、pending キーだけ削除する", async () => {
        localStorageMock.setItem("jp_pending_displayName", "古い名前");
        mockLogin.mockResolvedValue({ success: true });
        mockUserFetch.mockImplementation(async (_path: string, options?: RequestInit) => {
            if (!options?.method) return { ok: true, json: async () => ({ userId: "u1", displayName: "既存の名前", bio: "自己紹介" }) };
            return { ok: true };
        });

        const user = userEvent.setup();
        render(<LoginPage />);
        await user.type(screen.getByPlaceholderText(/example@email\.com/), "u@example.com");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: "ログイン" }));

        await waitFor(() => { expect(mockPush).toHaveBeenCalledWith("/"); });
        // PUT は呼ばれていない（既存プロフィールを上書きしない）
        const putCalls = mockUserFetch.mock.calls.filter(
            (c: unknown[]) => (c[1] as RequestInit | undefined)?.method === "PUT",
        );
        expect(putCalls).toHaveLength(0);
        // pending キーは掃除される
        expect(localStorageMock.getItem("jp_pending_displayName")).toBeNull();
    });

    it("jp_pending_displayName が無ければ PUT /user/profile を呼ばない", async () => {
        mockLogin.mockResolvedValue({ success: true });
        const user = userEvent.setup();
        render(<LoginPage />);

        await user.type(screen.getByPlaceholderText(/example@email\.com/), "u@example.com");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: "ログイン" }));

        await waitFor(() => { expect(mockPush).toHaveBeenCalledWith("/"); });
        expect(mockUserFetch).not.toHaveBeenCalled();
    });

    it("PUT /user/profile が失敗してもログインは成功扱いで `/` へリダイレクトする", async () => {
        localStorageMock.setItem("jp_pending_displayName", "失敗太郎");
        mockLogin.mockResolvedValue({ success: true });
        mockUserFetch.mockResolvedValue({ ok: false, status: 500 });

        const user = userEvent.setup();
        render(<LoginPage />);
        await user.type(screen.getByPlaceholderText(/example@email\.com/), "u@example.com");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: "ログイン" }));

        await waitFor(() => { expect(mockPush).toHaveBeenCalledWith("/"); });
        // 失敗時は localStorage に残ったまま（次回ログインで再試行できる）
        expect(localStorageMock.getItem("jp_pending_displayName")).toBe("失敗太郎");
    });

    it("PUT /user/profile が例外を投げてもログイン成功扱いで `/` へリダイレクトする", async () => {
        localStorageMock.setItem("jp_pending_displayName", "例外太郎");
        mockLogin.mockResolvedValue({ success: true });
        mockUserFetch.mockRejectedValue(new Error("network down"));

        const user = userEvent.setup();
        render(<LoginPage />);
        await user.type(screen.getByPlaceholderText(/example@email\.com/), "u@example.com");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: "ログイン" }));

        await waitFor(() => { expect(mockPush).toHaveBeenCalledWith("/"); });
        // 例外時も localStorage に残す（再ログインで再試行）
        expect(localStorageMock.getItem("jp_pending_displayName")).toBe("例外太郎");
    });
});

// ──────────────────────────────────────────────────────────────
// パスワードリセット
// ──────────────────────────────────────────────────────────────
describe("LoginPage - パスワードリセット", () => {
    it("「パスワードをお忘れですか？」→ forgot-send ステップへ", async () => {
        const user = userEvent.setup();
        render(<LoginPage />);
        await user.click(screen.getByRole("button", { name: /パスワードをお忘れですか/ }));
        expect(await screen.findByRole("heading", { name: "パスワードをリセット" })).toBeInTheDocument();
    });

    it("forgot-send 成功 → forgot-confirm ステップへ", async () => {
        mockForgotPassword.mockResolvedValue({ success: true });
        const user = userEvent.setup();
        render(<LoginPage />);

        await user.click(screen.getByRole("button", { name: /パスワードをお忘れですか/ }));
        await user.type(screen.getByPlaceholderText(/example@email\.com/), "reset@example.com");
        await user.click(screen.getByRole("button", { name: /確認コードを送信/ }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "コードを確認" })).toBeInTheDocument();
        });
        expect(mockForgotPassword).toHaveBeenCalledWith("reset@example.com");
    });
});
