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

let mockSearchParams = new URLSearchParams();
const mockReplace = vi.fn();
/** ログイン済みかどうかを差し替える（object 越しにしないと巻き上げに間に合わない） */
const mockAuthed = { value: false };
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: mockReplace }),
    useSearchParams: () => mockSearchParams,
}));

vi.mock("../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: mockAuthed.value, loading: false }),
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
    mockSearchParams = new URLSearchParams();
    mockReplace.mockReset();
    mockAuthed.value = false;
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

    async function tryResend(user: ReturnType<typeof userEvent.setup>) {
        await user.type(screen.getByPlaceholderText(/example@email\.com/), "u@example.com");
        await user.type(screen.getByPlaceholderText("8文字以上"), "Password1!");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: /確認コードを送信/ }));
        await waitFor(() => expect(mockResend).toHaveBeenCalledWith("stale-uuid"));
    }

    // **もう使えない控えは捨てる。** その UUID が確認済みのアカウントを
    // 指していると再送は毎回失敗し、捨てないと24時間の TTL が切れるまで
    // 同じ行き止まりを繰り返す
    it.each([
        ["確認済み扱い", "NotAuthorizedException"],
        ["居ないユーザー", "UserNotFoundException"],
        ["確認済み（User is already confirmed）", "InvalidParameterException"],
    ])("もう使えない控え（%s）は捨てる", async (_label, code) => {
        localStorageMock.setItem("jp_verify_u@example.com", JSON.stringify({ username: "stale-uuid", t: Date.now() }));
        mockSignUp.mockResolvedValue({ success: false, aliasExists: true });
        mockResend.mockResolvedValue({ success: false, error: "x", code });
        render(<SignupPage />);
        await tryResend(userEvent.setup());
        expect(localStorageMock.getItem("jp_verify_u@example.com"), "効かない控えが残る").toBeNull();
    });

    // **一時的な失敗で捨ててはいけない。** 捨てると確認画面に二度と
    // 戻れない（登録し直しても「すでに登録されています」で終わり、
    // 未確認なのでパスワード再設定も効かない）。元の形（24時間で TTL が
    // 切れて自然回復）より悪い
    it.each([
        ["回数制限", "LimitExceededException"],
        ["通信断など理由の分からない失敗", undefined],
    ])("一時的な失敗（%s）では控えを残す", async (_label, code) => {
        localStorageMock.setItem("jp_verify_u@example.com", JSON.stringify({ username: "stale-uuid", t: Date.now() }));
        mockSignUp.mockResolvedValue({ success: false, aliasExists: true });
        mockResend.mockResolvedValue({ success: false, error: "x", ...(code ? { code } : {}) });
        render(<SignupPage />);
        await tryResend(userEvent.setup());
        expect(localStorageMock.getItem("jp_verify_u@example.com"), "押し直す手がかりを捨てている").not.toBeNull();
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
        // **確認が済んだことをログイン画面に伝える。** `verified=1` を付ける
        // 箇所がリポジトリに1つも無く、あちらのバナーは死んだ画面だった
        // （テストが自前で `verified=1` を作っていたので気づけない）
        expect(screen.getByRole("link", { name: "ログインする" }))
            .toHaveAttribute("href", "/login?verified=1");
    });

    // **戻り先を登録の向こう側まで運ぶ。** 招待リンク（`/j?t=…`）で来た
    // 未登録の人は、ログイン画面の「新規登録」を押した時点で `next` を
    // 落としていた——登録を終えると必ず自分の空プロフィールに着地し、
    // 招待に戻る手段が履歴しか無かった
    it("next があれば、完了後のログインにも引き継ぐ", async () => {
        mockSearchParams = new URLSearchParams("next=%2Fj%3Ft%3Dabc");
        const user = userEvent.setup();
        render(<SignupPage />);
        await goToVerifyStep(user);

        mockConfirmSignUp.mockResolvedValue({ success: true });
        await user.type(screen.getByPlaceholderText(/メールに届いた6桁のコード/), "123456");
        await user.click(screen.getByRole("button", { name: /登録を確定する/ }));

        await waitFor(() => expect(screen.getByRole("heading", { name: "登録完了" })).toBeInTheDocument());
        expect(screen.getByRole("link", { name: "ログインする" }))
            .toHaveAttribute("href", `/login?verified=1&next=${encodeURIComponent("/j?t=abc")}`);
    });

    // 外へ飛ばす値は捨てる（この画面が踏み台にならないように）
    it("外部のURLを next に入れられても引き継がない", async () => {
        mockSearchParams = new URLSearchParams("next=https%3A%2F%2Fevil.example%2Fx");
        render(<SignupPage />);
        expect(screen.getByRole("link", { name: "ログイン" })).toHaveAttribute("href", "/login");
    });

    // `/login` は `nextPath ?? …` を見るのに、ここだけトップへ流していた
    it("既にログイン済みなら、next があるときはそこへ送る", async () => {
        mockSearchParams = new URLSearchParams("next=%2Fj%3Ft%3Dabc");
        mockAuthed.value = true;
        render(<SignupPage />);
        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/j?t=abc"));
    });

    it("next があれば「すでにアカウントをお持ちの方」のリンクにも付ける", async () => {
        mockSearchParams = new URLSearchParams("next=%2Fj%3Ft%3Dabc");
        render(<SignupPage />);
        expect(screen.getByRole("link", { name: "ログイン" }))
            .toHaveAttribute("href", `/login?next=${encodeURIComponent("/j?t=abc")}`);
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
