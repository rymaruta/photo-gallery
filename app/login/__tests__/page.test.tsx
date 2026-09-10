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

// **実物を土台にする。** 列挙だけだと、画面が新しく使う export
// （`PASSWORD_RULE_MESSAGE`）が undefined になって投げ、**その分岐を通る
// テストだけが落ちる**——このリポジトリで一度踏んでいる形
vi.mock("../../../lib/auth/cognito", async (importActual) => ({
    ...(await importActual<typeof import("../../../lib/auth/cognito")>()),
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

    // **待たない。** `userFetch` はセッション最大10秒＋要求20秒なので、
    // 直列2本で最大60秒「ログイン中...」のままになる。しかもこの枝に入るのは
    // **登録を終えたばかりの初回ログインちょうど**——電波の悪い場所で
    // そこを踏んだ人は、トークンはもう手元にあるのに固まった画面を見て閉じる
    it("プロフィール作成の応答が返らなくても、着地は待たされない", async () => {
        localStorageMock.setItem("jp_pending_name_u@example.com", "旅人");
        mockLogin.mockResolvedValue({ success: true });
        mockUserFetch.mockImplementation(() => new Promise(() => { /* 返らない */ }));
        const user = userEvent.setup();
        render(<LoginPage />);

        await user.type(screen.getByPlaceholderText(/example@email\.com/), "u@example.com");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: "ログイン" }));

        await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/"));
        // 控えは残す（次の遷移で `ProfileSetupBanner` が拾い直す）
        expect(localStorageMock.getItem("jp_pending_name_u@example.com")).toBe("旅人");
        // **控えの経路を実際に通っていることを確かめる**（キーの綴りを
        // 間違えると分岐に入らず、何も検証しないテストになる）
        expect(mockUserFetch, "プロフィール作成の経路に入っていない").toHaveBeenCalled();
    });

    // **送る前に見る。** 登録側は長さと一致を見ているのに、ここは空でなければ
    // 送っていた。3文字でも往復して、戻ってくるのは AWS の文言
    it("再設定の新しいパスワードが短ければ、送らずにその場で言う", async () => {
        mockForgotPassword.mockResolvedValue({ success: true });
        const user = userEvent.setup();
        render(<LoginPage />);
        await user.click(screen.getByRole("button", { name: /パスワードをお忘れですか/ }));
        await user.type(screen.getByPlaceholderText(/example@email\.com/), "u@example.com");
        await user.click(screen.getByRole("button", { name: /確認コードを送信/ }));
        await waitFor(() => expect(screen.getByPlaceholderText("メールに届いたコードを入力")).toBeInTheDocument());

        await user.type(screen.getByPlaceholderText("メールに届いたコードを入力"), "123456");
        await user.type(screen.getByPlaceholderText(/8文字以上/), "abc");
        await user.click(screen.getByRole("button", { name: /パスワードを更新/ }));

        expect(mockConfirmForgotPassword, "短いまま送っている").not.toHaveBeenCalled();
        // **プールは記号も要求している**（`provision-env.js` の
        // `RequireSymbols: true`）。記号を書かないと、`Password1` を弾かれた
        // 人が「条件は満たしている」と読んで打ち直し続ける
        expect(screen.getByText(/記号/), "記号の条件を言っていない").toBeInTheDocument();
    });

    // **前後に空白があっても、そのまま送らない。**
    //
    // 実際に落としているのは `type="email"` のブラウザ側の値の正規化で、
    // 画面の `.trim()` は保険（外してもこの3本は通る＝レビューが変異で
    // 「テストが弱い」と読んだが、**弱いのではなく効かせている場所が
    // 違った**。本当に効くのは `signUp` の境界で、そちらは
    // `lib/auth/__tests__/cognito.test.ts` が固定している）。
    // ここで見るのは「空白付きで打っても素通りしない」という結果の方。
    it("ログインは、メールの前後の空白を落として送る", async () => {
        mockLogin.mockResolvedValue({ success: true });
        const user = userEvent.setup();
        render(<LoginPage />);
        await user.type(screen.getByPlaceholderText(/example@email\.com/), "  u@example.com  ");
        await user.type(screen.getByPlaceholderText("••••••••"), "Password1!");
        await user.click(screen.getByRole("button", { name: "ログイン" }));
        await waitFor(() => expect(mockLogin).toHaveBeenCalledWith("u@example.com", "Password1!"));
    });

    it("再設定のコード送信も、前後の空白を落として送る", async () => {
        mockForgotPassword.mockResolvedValue({ success: true });
        const user = userEvent.setup();
        render(<LoginPage />);
        await user.click(screen.getByRole("button", { name: /パスワードをお忘れですか/ }));
        await user.type(screen.getByPlaceholderText(/example@email\.com/), " u@example.com ");
        await user.click(screen.getByRole("button", { name: /確認コードを送信/ }));
        await waitFor(() => expect(mockForgotPassword).toHaveBeenCalledWith("u@example.com"));
    });

    it("再設定の確定も、前後の空白を落として送る", async () => {
        mockForgotPassword.mockResolvedValue({ success: true });
        mockConfirmForgotPassword.mockResolvedValue({ success: true });
        const user = userEvent.setup();
        render(<LoginPage />);
        await user.click(screen.getByRole("button", { name: /パスワードをお忘れですか/ }));
        await user.type(screen.getByPlaceholderText(/example@email\.com/), " u@example.com ");
        await user.click(screen.getByRole("button", { name: /確認コードを送信/ }));
        await waitFor(() => expect(screen.getByPlaceholderText("メールに届いたコードを入力")).toBeInTheDocument());
        // **コード欄にも空白を入れる。** ここは `type="text"` なので
        // ブラウザ側の正規化が効かない（メールから6桁をコピペすると
        // 末尾に空白が付くことがある）。空白なしで打っていた頃は、
        // 確かめていたのは jsdom が勝手に落とすメールの分だけだった
        await user.type(screen.getByPlaceholderText("メールに届いたコードを入力"), " 123456 ");
        await user.type(screen.getByPlaceholderText(/8文字以上/), "Password1!");
        await user.click(screen.getByRole("button", { name: /パスワードを更新/ }));
        await waitFor(() => expect(mockConfirmForgotPassword).toHaveBeenCalledWith("u@example.com", "123456", "Password1!"));
    });

    // **「パスワードを更新」の門番が、1件も検証されていなかった**
    // （このファイルに `toBeDisabled` が0件だった）。
    // コード欄は `type="text"` なのでブラウザ側の正規化が効かない
    // ——メールから6桁をコピペすると空白が付くことがあり、
    // `resetCode.length` で数えると空白ぶんで6文字に届いてしまう
    it("コードが6桁に満たない間は「パスワードを更新」を押せない", async () => {
        mockForgotPassword.mockResolvedValue({ success: true });
        const user = userEvent.setup();
        render(<LoginPage />);
        await user.click(screen.getByRole("button", { name: /パスワードをお忘れですか/ }));
        await user.type(screen.getByPlaceholderText(/example@email\.com/), "u@example.com");
        await user.click(screen.getByRole("button", { name: /確認コードを送信/ }));
        await waitFor(() => expect(screen.getByPlaceholderText("メールに届いたコードを入力")).toBeInTheDocument());

        const update = screen.getByRole("button", { name: /パスワードを更新/ });
        // 何も入れていない
        expect(update, "空のまま押せる").toBeDisabled();

        // **空白を混ぜた5桁。** 文字数だけ数えると7文字で通ってしまう
        await user.type(screen.getByPlaceholderText("メールに届いたコードを入力"), " 12345 ");
        await user.type(screen.getByPlaceholderText(/8文字以上/), "Password1!");
        expect(update, "空白を数えて6桁に届いたことにしている").toBeDisabled();

        // 6桁そろえば押せる
        await user.clear(screen.getByPlaceholderText("メールに届いたコードを入力"));
        await user.type(screen.getByPlaceholderText("メールに届いたコードを入力"), " 123456 ");
        expect(update, "6桁そろっているのに押せない").toBeEnabled();
    });

    it("新しいパスワードが空の間も押せない", async () => {
        mockForgotPassword.mockResolvedValue({ success: true });
        const user = userEvent.setup();
        render(<LoginPage />);
        await user.click(screen.getByRole("button", { name: /パスワードをお忘れですか/ }));
        await user.type(screen.getByPlaceholderText(/example@email\.com/), "u@example.com");
        await user.click(screen.getByRole("button", { name: /確認コードを送信/ }));
        await waitFor(() => expect(screen.getByPlaceholderText("メールに届いたコードを入力")).toBeInTheDocument());

        await user.type(screen.getByPlaceholderText("メールに届いたコードを入力"), "123456");
        expect(screen.getByRole("button", { name: /パスワードを更新/ }), "パスワードが空でも押せる").toBeDisabled();
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
