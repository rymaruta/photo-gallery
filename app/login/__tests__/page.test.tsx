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
const mockReplace = vi.fn();
const mockLogin = vi.fn();
const mockShowToast = vi.fn();
const mockUserFetch = vi.fn();
const mockForgotPassword = vi.fn();
const mockConfirmForgotPassword = vi.fn();

let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: mockReplace }),
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
    mockReplace.mockReset();
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

    // **`next` を落としていた。** 招待リンクや共有リンクから来た未登録の人が
    // ここを押すと行き先が消え、登録を終えると自分の空プロフィールに着地する
    it("next があれば、新規登録のリンクにも引き継ぐ", () => {
        mockSearchParams = new URLSearchParams("next=%2Fj%3Ft%3Dabc");
        render(<LoginPage />);
        expect(screen.getByRole("link", { name: "新規登録" }))
            .toHaveAttribute("href", `/signup?next=${encodeURIComponent("/j?t=abc")}`);
    });

    it("外部のURLを next に入れられても、新規登録には付けない", () => {
        mockSearchParams = new URLSearchParams("next=https%3A%2F%2Fevil.example%2Fx");
        render(<LoginPage />);
        expect(screen.getByRole("link", { name: "新規登録" })).toHaveAttribute("href", "/signup");
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
            expect(mockReplace).toHaveBeenCalledWith("/users?id=my-sub-123");
        });
        expect(mockShowToast).toHaveBeenCalledWith("ログインしました", "success");
    });

    // **`next` の振る舞いを見るテストが1本も無かった。**
    // `searchParams?.get("next")` を `"nxt"` に書き換えても、login・
    // guardRedirects・routes・useMemberGate の 88件が緑（実測）。
    // `guardRedirects.test.ts` は「その1行の文字列がある」ことしか見ない。
    // 壊れると、写真の共有リンクや招待リンクを踏んでログインした人が
    // 全員、自分のプロフィールに着地する
    it("next があれば、そこへ戻す（自分のプロフィールへ流さない）", async () => {
        mockSearchParams = new URLSearchParams("next=%2Fphoto%2Fabc");
        mockLogin.mockResolvedValue({ success: true, userId: "my-sub-123" });
        const user = userEvent.setup();
        render(<LoginPage />);

        await user.type(screen.getByPlaceholderText(/example@email\.com/), "user@example.com");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: "ログイン" }));

        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/photo/abc"));
    });

    // 外へ飛ばす値は捨てる（`safeNextPath`。この関数自体は
    // `lib/__tests__/routes.test.ts` が手厚く見ている）
    it("外部のURLを next に入れられても、そこへは飛ばさない", async () => {
        mockSearchParams = new URLSearchParams("next=https%3A%2F%2Fevil.example%2Fx");
        mockLogin.mockResolvedValue({ success: true, userId: "my-sub-123" });
        const user = userEvent.setup();
        render(<LoginPage />);

        await user.type(screen.getByPlaceholderText(/example@email\.com/), "user@example.com");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: "ログイン" }));

        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/users?id=my-sub-123"));
        expect(mockReplace).not.toHaveBeenCalledWith(expect.stringContaining("evil.example"));
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
            expect(mockReplace).toHaveBeenCalledWith("/");
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
        expect(mockReplace, "遷移しないはずが replace で飛んでいる").not.toHaveBeenCalled();
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
    // 保存キーはメールアドレスで区切る。共有端末で、登録を途中でやめた人の
    // 表示名が次にログインした別人に付いてしまうため。
    it("登録時に控えた表示名があれば PUT /user/profile を呼んで成功時に削除する", async () => {
        localStorageMock.setItem("jp_pending_name_u@example.com", "テスト太郎");
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
            expect(localStorageMock.getItem("jp_pending_name_u@example.com")).toBeNull();
        });
        expect(mockReplace).toHaveBeenCalledWith("/");
    });

    it("既にプロフィールに displayName がある場合は PUT せず、pending キーだけ削除する", async () => {
        localStorageMock.setItem("jp_pending_name_u@example.com", "古い名前");
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

        await waitFor(() => { expect(mockReplace).toHaveBeenCalledWith("/"); });
        // PUT は呼ばれていない（既存プロフィールを上書きしない）
        const putCalls = mockUserFetch.mock.calls.filter(
            (c: unknown[]) => (c[1] as RequestInit | undefined)?.method === "PUT",
        );
        expect(putCalls).toHaveLength(0);
        // pending キーは掃除される
        expect(localStorageMock.getItem("jp_pending_name_u@example.com")).toBeNull();
    });

    it("別のメールアドレスで控えた表示名は使わない（共有端末での取り違え）", async () => {
        localStorageMock.setItem("jp_pending_name_someone-else@example.com", "たろう");
        mockLogin.mockResolvedValue({ success: true });
        mockUserFetch.mockImplementation(async (_path: string, options?: RequestInit) => {
            if (!options?.method) return { ok: true, json: async () => ({ userId: "u1" }) };
            return { ok: true };
        });

        const user = userEvent.setup();
        render(<LoginPage />);
        await user.type(screen.getByPlaceholderText(/example@email\.com/), "u@example.com");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: "ログイン" }));

        await waitFor(() => { expect(mockReplace).toHaveBeenCalledWith("/"); });
        const putCalls = mockUserFetch.mock.calls.filter(
            (c: unknown[]) => (c[1] as RequestInit | undefined)?.method === "PUT",
        );
        expect(putCalls).toHaveLength(0);
        // 他人の分は消さない
        expect(localStorageMock.getItem("jp_pending_name_someone-else@example.com")).toBe("たろう");
    });

    it("jp_pending_displayName が無ければ PUT /user/profile を呼ばない", async () => {
        mockLogin.mockResolvedValue({ success: true });
        const user = userEvent.setup();
        render(<LoginPage />);

        await user.type(screen.getByPlaceholderText(/example@email\.com/), "u@example.com");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: "ログイン" }));

        await waitFor(() => { expect(mockReplace).toHaveBeenCalledWith("/"); });
        expect(mockUserFetch).not.toHaveBeenCalled();
    });

    it("PUT /user/profile が失敗してもログインは成功扱いで `/` へリダイレクトする", async () => {
        localStorageMock.setItem("jp_pending_name_u@example.com", "失敗太郎");
        mockLogin.mockResolvedValue({ success: true });
        mockUserFetch.mockResolvedValue({ ok: false, status: 500 });

        const user = userEvent.setup();
        render(<LoginPage />);
        await user.type(screen.getByPlaceholderText(/example@email\.com/), "u@example.com");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: "ログイン" }));

        await waitFor(() => { expect(mockReplace).toHaveBeenCalledWith("/"); });
        // 失敗時は localStorage に残ったまま（次回ログインで再試行できる）
        expect(localStorageMock.getItem("jp_pending_name_u@example.com")).toBe("失敗太郎");
    });

    it("PUT /user/profile が例外を投げてもログイン成功扱いで `/` へリダイレクトする", async () => {
        localStorageMock.setItem("jp_pending_name_u@example.com", "例外太郎");
        mockLogin.mockResolvedValue({ success: true });
        mockUserFetch.mockRejectedValue(new Error("network down"));

        const user = userEvent.setup();
        render(<LoginPage />);
        await user.type(screen.getByPlaceholderText(/example@email\.com/), "u@example.com");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: "ログイン" }));

        await waitFor(() => { expect(mockReplace).toHaveBeenCalledWith("/"); });
        // 例外時も localStorage に残す（再ログインで再試行）
        expect(localStorageMock.getItem("jp_pending_name_u@example.com")).toBe("例外太郎");
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
