import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ──────────────────────────────────────────────────────────────
// localStorage モック（DBが残らないように各テストでclear）
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
const mockSignUp = vi.fn();
const mockConfirmSignUp = vi.fn();
const mockResend = vi.fn();
const mockShowToast = vi.fn();

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

vi.mock("../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: false, loading: false }),
}));

vi.mock("../../../lib/hooks/useToast", () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock("../../../lib/auth/cognito", () => ({
    signUp: (...args: unknown[]) => mockSignUp(...args),
    confirmSignUp: (...args: unknown[]) => mockConfirmSignUp(...args),
    resendConfirmationCode: (...args: unknown[]) => mockResend(...args),
}));

// next/link は children をそのままレンダリング
vi.mock("next/link", () => ({
    default: ({ children, href }: { children: React.ReactNode; href: string }) =>
        React.createElement("a", { href }, children),
}));

// SUT
import SignupPage from "../page";

beforeEach(() => {
    localStorageMock.clear();
    mockPush.mockReset();
    mockSignUp.mockReset();
    mockConfirmSignUp.mockReset();
    mockResend.mockReset();
    mockShowToast.mockReset();
    // URLパラメータをデフォルトに戻す
    window.history.replaceState({}, "", "/signup");
});

// ──────────────────────────────────────────────────────────────
// 登録ステップ
// ──────────────────────────────────────────────────────────────
describe("SignupPage - 登録ステップ", () => {
    it("初期表示は登録フォーム", () => {
        render(<SignupPage />);
        expect(screen.getByRole("heading", { name: "アカウント作成" })).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/example@email\.com/)).toBeInTheDocument();
    });

    it("表示名・メール・パスワード・確認パスワードのフィールドが揃っている", () => {
        render(<SignupPage />);
        expect(screen.getByPlaceholderText("あなたの名前（後で変更できます）")).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/example@email\.com/)).toBeInTheDocument();
        expect(screen.getByPlaceholderText("8文字以上")).toBeInTheDocument();
        expect(screen.getByPlaceholderText("••••••••")).toBeInTheDocument();
    });

    it("パスワード不一致でエラーを表示し、signUpは呼ばれない", async () => {
        const user = userEvent.setup();
        render(<SignupPage />);
        await user.type(screen.getByPlaceholderText(/example@email\.com/), "u@example.com");
        await user.type(screen.getByPlaceholderText("8文字以上"), "Password1!");
        await user.type(screen.getByPlaceholderText("••••••••"), "Different1!");
        await user.click(screen.getByRole("button", { name: /確認コードを送信/ }));
        expect(await screen.findByText("パスワードが一致しません")).toBeInTheDocument();
        expect(mockSignUp).not.toHaveBeenCalled();
    });

    it("パスワード8文字未満でエラーを表示する", async () => {
        const user = userEvent.setup();
        render(<SignupPage />);
        await user.type(screen.getByPlaceholderText(/example@email\.com/), "u@example.com");
        await user.type(screen.getByPlaceholderText("8文字以上"), "Pass1");
        await user.type(screen.getByPlaceholderText("••••••••"), "Pass1");
        await user.click(screen.getByRole("button", { name: /確認コードを送信/ }));
        expect(await screen.findByText("パスワードは8文字以上で入力してください")).toBeInTheDocument();
        expect(mockSignUp).not.toHaveBeenCalled();
    });

    it("登録成功 → verify ステップへ遷移し、UUIDをlocalStorageに保存する", async () => {
        mockSignUp.mockResolvedValue({ success: true, username: "uuid-1234-5678" });
        const user = userEvent.setup();
        render(<SignupPage />);

        await user.type(screen.getByPlaceholderText(/example@email\.com/), "newuser@example.com");
        await user.type(screen.getByPlaceholderText("8文字以上"), "Password1!");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: /確認コードを送信/ }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "メールを確認" })).toBeInTheDocument();
        });
        expect(mockSignUp).toHaveBeenCalledWith("newuser@example.com", "Password1!");
        const saved = localStorageMock.getItem("jp_verify_newuser@example.com");
        expect(saved).toBeTruthy();
        expect(JSON.parse(saved!).username).toBe("uuid-1234-5678");
    });

    // メールアドレスで区切って控える。共有端末で、登録を途中でやめた人の
    // 表示名が次にログインした別人に付くのを防ぐ。
    it("displayName を入力していたらメールアドレス付きのキーに控える", async () => {
        mockSignUp.mockResolvedValue({ success: true, username: "uuid-xyz" });
        const user = userEvent.setup();
        render(<SignupPage />);

        await user.type(screen.getByPlaceholderText("あなたの名前（後で変更できます）"), "テスト太郎");
        await user.type(screen.getByPlaceholderText(/example@email\.com/), "newuser@example.com");
        await user.type(screen.getByPlaceholderText("8文字以上"), "Password1!");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: /確認コードを送信/ }));

        await waitFor(() => {
            expect(localStorageMock.getItem("jp_pending_name_newuser@example.com")).toBe("テスト太郎");
            // 端末で共有される裸のキーには書かない
            expect(localStorageMock.getItem("jp_pending_displayName")).toBeNull();
        });
    });

    it("displayName が空欄なら控えない", async () => {
        mockSignUp.mockResolvedValue({ success: true, username: "uuid-xyz" });
        const user = userEvent.setup();
        render(<SignupPage />);

        await user.type(screen.getByPlaceholderText(/example@email\.com/), "newuser@example.com");
        await user.type(screen.getByPlaceholderText("8文字以上"), "Password1!");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: /確認コードを送信/ }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "メールを確認" })).toBeInTheDocument();
        });
        expect(localStorageMock.getItem("jp_pending_name_newuser@example.com")).toBeNull();
    });

    it("登録失敗（不明エラー） → エラーメッセージを表示する", async () => {
        mockSignUp.mockResolvedValue({ success: false, error: "予期せぬエラー" });
        const user = userEvent.setup();
        render(<SignupPage />);

        await user.type(screen.getByPlaceholderText(/example@email\.com/), "u@x.com");
        await user.type(screen.getByPlaceholderText("8文字以上"), "Password1!");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: /確認コードを送信/ }));

        expect(await screen.findByText("予期せぬエラー")).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "アカウント作成" })).toBeInTheDocument();
    });

    it("AliasExistsException + 保存UUIDあり → resendCodeを呼んでverifyへ", async () => {
        // 事前に過去のUUIDをlocalStorageに保存しておく
        localStorageMock.setItem(
            "jp_verify_existing@example.com",
            JSON.stringify({ username: "stored-uuid", t: Date.now() }),
        );
        mockSignUp.mockResolvedValue({ success: false, aliasExists: true });
        mockResend.mockResolvedValue({ success: true });

        const user = userEvent.setup();
        render(<SignupPage />);

        await user.type(screen.getByPlaceholderText(/example@email\.com/), "existing@example.com");
        await user.type(screen.getByPlaceholderText("8文字以上"), "Password1!");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: /確認コードを送信/ }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "メールを確認" })).toBeInTheDocument();
        });
        expect(mockResend).toHaveBeenCalledWith("stored-uuid");
        expect(mockShowToast).toHaveBeenCalledWith("確認コードを再送しました", "success");
    });

    it("AliasExistsException + 保存UUIDなし → エラー表示でverifyに遷移しない", async () => {
        mockSignUp.mockResolvedValue({ success: false, aliasExists: true });
        const user = userEvent.setup();
        render(<SignupPage />);

        await user.type(screen.getByPlaceholderText(/example@email\.com/), "noidea@example.com");
        await user.type(screen.getByPlaceholderText("8文字以上"), "Password1!");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: /確認コードを送信/ }));

        expect(await screen.findByText(/すでに登録されています/)).toBeInTheDocument();
        expect(mockResend).not.toHaveBeenCalled();
        expect(screen.getByRole("heading", { name: "アカウント作成" })).toBeInTheDocument();
    });
});

// ──────────────────────────────────────────────────────────────
// 確認コード入力ステップ
// ──────────────────────────────────────────────────────────────
describe("SignupPage - 確認ステップ", () => {
    async function goToVerifyStep(user: ReturnType<typeof userEvent.setup>) {
        mockSignUp.mockResolvedValue({ success: true, username: "uuid-1234" });
        await user.type(screen.getByPlaceholderText(/example@email\.com/), "u@example.com");
        await user.type(screen.getByPlaceholderText("8文字以上"), "Password1!");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: /確認コードを送信/ }));
        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "メールを確認" })).toBeInTheDocument();
        });
    }

    it("confirmSignUp 成功 → 完了ステップへ + UUIDがlocalStorageから消える", async () => {
        const user = userEvent.setup();
        render(<SignupPage />);
        await goToVerifyStep(user);

        mockConfirmSignUp.mockResolvedValue({ success: true });
        await user.type(screen.getByPlaceholderText(/メールに届いた6桁のコード/), "123456");
        await user.click(screen.getByRole("button", { name: /登録を確定する/ }));

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "登録完了" })).toBeInTheDocument();
        });
        expect(mockConfirmSignUp).toHaveBeenCalledWith("uuid-1234", "123456");
        expect(localStorageMock.getItem("jp_verify_u@example.com")).toBeNull();
    });

    it("確認コードが正しくない → エラーを表示し、ステップは変わらない", async () => {
        const user = userEvent.setup();
        render(<SignupPage />);
        await goToVerifyStep(user);

        mockConfirmSignUp.mockResolvedValue({
            success: false,
            error: "確認コードが正しくありません",
        });
        await user.type(screen.getByPlaceholderText(/メールに届いた6桁のコード/), "999999");
        await user.click(screen.getByRole("button", { name: /登録を確定する/ }));

        expect(await screen.findByText("確認コードが正しくありません")).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "メールを確認" })).toBeInTheDocument();
    });

    it("登録ボタンはコードが6文字未満では無効", async () => {
        const user = userEvent.setup();
        render(<SignupPage />);
        await goToVerifyStep(user);

        const submitBtn = screen.getByRole("button", { name: /登録を確定する/ });
        expect(submitBtn).toBeDisabled();
        await user.type(screen.getByPlaceholderText(/メールに届いた6桁のコード/), "12345");
        expect(submitBtn).toBeDisabled();
        await user.type(screen.getByPlaceholderText(/メールに届いた6桁のコード/), "6");
        expect(submitBtn).not.toBeDisabled();
    });

    it("コード再送ボタン → クールダウン中は無効化", async () => {
        const user = userEvent.setup();
        render(<SignupPage />);
        await goToVerifyStep(user);

        // 登録直後はクールダウン60秒
        const resendBtn = screen.getByRole("button", { name: /再送（\d+秒後）/ });
        expect(resendBtn).toBeDisabled();
    });
});

// ──────────────────────────────────────────────────────────────
// URLパラメータ復元
// ──────────────────────────────────────────────────────────────
describe("SignupPage - URLパラメータ復元", () => {
    it("?email=... があってlocalStorageに保存UUIDあり → verifyステップで起動", async () => {
        localStorageMock.setItem(
            "jp_verify_resume@example.com",
            JSON.stringify({ username: "resumed-uuid", t: Date.now() }),
        );
        window.history.replaceState({}, "", "/signup?email=resume@example.com");

        await act(async () => { render(<SignupPage />); });

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "メールを確認" })).toBeInTheDocument();
        });
        expect(screen.getByText(/resume@example\.com に送信した|resume@example\.com に確認コード/)).toBeInTheDocument();
    });

    it("?email=... があってlocalStorageに保存UUIDなし → emailプレフィル + 登録ステップ", async () => {
        window.history.replaceState({}, "", "/signup?email=fresh@example.com");
        await act(async () => { render(<SignupPage />); });

        await waitFor(() => {
            const emailInput = screen.getByPlaceholderText(/example@email\.com/) as HTMLInputElement;
            expect(emailInput.value).toBe("fresh@example.com");
        });
        expect(screen.getByRole("heading", { name: "アカウント作成" })).toBeInTheDocument();
    });

    it("保存UUIDの有効期限切れ（24時間以上前）→ verifyステップにはならない", async () => {
        const oldT = Date.now() - 25 * 60 * 60 * 1000; // 25時間前
        localStorageMock.setItem(
            "jp_verify_expired@example.com",
            JSON.stringify({ username: "expired-uuid", t: oldT }),
        );
        window.history.replaceState({}, "", "/signup?email=expired@example.com");
        await act(async () => { render(<SignupPage />); });

        await waitFor(() => {
            const emailInput = screen.getByPlaceholderText(/example@email\.com/) as HTMLInputElement;
            expect(emailInput.value).toBe("expired@example.com");
        });
        expect(screen.getByRole("heading", { name: "アカウント作成" })).toBeInTheDocument();
        // 期限切れUUIDは削除されている
        expect(localStorageMock.getItem("jp_verify_expired@example.com")).toBeNull();
    });
});
