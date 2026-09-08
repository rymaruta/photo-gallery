import { describe, it, expect, vi, beforeEach } from "vitest";

// config モック: 環境変数依存をなくす
vi.mock("../config", () => ({
    cognitoConfig: { userPoolId: "ap-northeast-1_test", clientId: "test-client-id", region: "ap-northeast-1" },
    ADMIN_GROUP_NAME: "admin",
    USER_GROUP_NAME: "user",
    PROTECTED_PATHS: ["/user/upload"],
}));

// Cognito SDK モック
const mockGetCurrentUser = vi.hoisted(() => vi.fn(() => null as null | object));
const mockSignUp        = vi.hoisted(() => vi.fn());
const mockConfirmReg    = vi.hoisted(() => vi.fn());
const mockResendCode    = vi.hoisted(() => vi.fn());
const mockAuthUser      = vi.hoisted(() => vi.fn());
const mockGetSession    = vi.hoisted(() => vi.fn());

vi.mock("amazon-cognito-identity-js", () => ({
    // new で呼ばれるコンストラクタには通常関数（非アロー）を使う
    CognitoUserPool: vi.fn(function () {
        return { getCurrentUser: mockGetCurrentUser, signUp: mockSignUp };
    }),
    AuthenticationDetails: vi.fn(function () { return {}; }),
    CognitoUser: vi.fn(function () {
        return {
            authenticateUser: mockAuthUser,
            getSession: mockGetSession,
            confirmRegistration: mockConfirmReg,
            resendConfirmationCode: mockResendCode,
            forgotPassword: vi.fn(),
            confirmPassword: vi.fn(),
            signOut: vi.fn(),
        };
    }),
    CognitoUserAttribute: vi.fn(function (obj: unknown) { return obj; }),
}));

// static import（環境変数に依存しない）
import {
    signIn, getCurrentSession, lookupSession, signUp, confirmSignUp,
    getCurrentUserGroups, isAdmin, isGeneralUser,
} from "../cognito";

beforeEach(() => {
    // CognitoUserPool 自体の実装は維持し、個別の fn だけリセットする
    // (vi.clearAllMocks() は CognitoUserPool の実装も消してしまう)
    mockGetCurrentUser.mockReset();
    mockGetCurrentUser.mockReturnValue(null);
    mockSignUp.mockReset();
    mockConfirmReg.mockReset();
    mockResendCode.mockReset();
    mockAuthUser.mockReset();
    mockGetSession.mockReset();
});

// ────────────────────────────────
// signIn
// ────────────────────────────────
describe("signIn", () => {
    it("認証成功 → success:true とグループを返す", async () => {
        mockAuthUser.mockImplementation((_d: unknown, cbs: {
            onSuccess: (s: object) => void;
        }) => {
            cbs.onSuccess({
                getIdToken: () => ({ payload: { "cognito:groups": ["user"] } }),
            });
        });
        const result = await signIn("user@example.com", "password");
        expect(result.success).toBe(true);
        expect(result.groups).toContain("user");
    });

    it("NotAuthorizedException → 日本語メッセージ", async () => {
        mockAuthUser.mockImplementation((_d: unknown, cbs: {
            onFailure: (e: { code: string; message: string }) => void;
        }) => {
            cbs.onFailure({ code: "NotAuthorizedException", message: "Incorrect username or password." });
        });
        const result = await signIn("x@x.com", "wrong");
        expect(result.success).toBe(false);
        expect(result.error).toContain("メールアドレスまたはパスワード");
    });

    it("UserNotConfirmedException → needsVerification:true", async () => {
        mockAuthUser.mockImplementation((_d: unknown, cbs: {
            onFailure: (e: { code: string; message: string }) => void;
        }) => {
            cbs.onFailure({ code: "UserNotConfirmedException", message: "User is not confirmed." });
        });
        const result = await signIn("x@x.com", "pass");
        expect(result.success).toBe(false);
        expect(result.needsVerification).toBe(true);
    });
});

// ────────────────────────────────
// getCurrentSession
// ────────────────────────────────
describe("getCurrentSession", () => {
    it("getCurrentUser が null → null を返す", async () => {
        mockGetCurrentUser.mockReturnValue(null);
        expect(await getCurrentSession()).toBeNull();
    });

    it("getSession がエラー → null を返す", async () => {
        mockGetCurrentUser.mockReturnValue({ getSession: mockGetSession });
        mockGetSession.mockImplementation((cb: (e: Error, s: null) => void) => {
            cb(new Error("Session error"), null);
        });
        expect(await getCurrentSession()).toBeNull();
    });

    it("セッションが無効（isValid=false）→ null を返す", async () => {
        mockGetCurrentUser.mockReturnValue({ getSession: mockGetSession });
        mockGetSession.mockImplementation((cb: (e: null, s: { isValid: () => boolean }) => void) => {
            cb(null, { isValid: () => false });
        });
        expect(await getCurrentSession()).toBeNull();
    });

    it("有効なセッション → セッションオブジェクトを返す", async () => {
        const mockSession = { isValid: () => true };
        mockGetCurrentUser.mockReturnValue({ getSession: mockGetSession });
        mockGetSession.mockImplementation((cb: (e: null, s: typeof mockSession) => void) => {
            cb(null, mockSession);
        });
        expect(await getCurrentSession()).toBe(mockSession);
    });
});

// ────────────────────────────────
// signUp
// ────────────────────────────────
describe("signUp", () => {
    it("AliasExistsException → aliasExists:true", async () => {
        mockSignUp.mockImplementation(
            (_u: string, _p: string, _a: unknown[], _v: unknown[], cb: (e: { name: string; message: string }) => void) => {
                cb({ name: "AliasExistsException", message: "Already exists." });
            }
        );
        const result = await signUp("dup@example.com", "Password1!");
        expect(result.success).toBe(false);
        expect(result.aliasExists).toBe(true);
    });

    it("成功 → success:true と UUID の username", async () => {
        mockSignUp.mockImplementation(
            (_u: string, _p: string, _a: unknown[], _v: unknown[], cb: (e: null) => void) => {
                cb(null);
            }
        );
        const result = await signUp("new@example.com", "Password1!");
        expect(result.success).toBe(true);
        expect(result.username).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it("InvalidPasswordException → 日本語メッセージ", async () => {
        mockSignUp.mockImplementation(
            (_u: string, _p: string, _a: unknown[], _v: unknown[], cb: (e: { name: string; message: string }) => void) => {
                cb({ name: "InvalidPasswordException", message: "Password does not meet requirements." });
            }
        );
        const result = await signUp("x@x.com", "weak");
        expect(result.success).toBe(false);
        expect(result.error).toContain("パスワードは8文字以上");
    });
});

// ────────────────────────────────
// confirmSignUp
// ────────────────────────────────
describe("confirmSignUp", () => {
    // 第2引数は forceAliasCreation。**true にすると、そのメールが既に
    // 他の人に紐づいていても強制的に付け替える。**
    //   攻撃者が被害者のメールで新規登録 → 確認コードは被害者の受信箱へ
    //   → 被害者が「正規のコードだ」と思って渡すと、メールが攻撃者の
    //     アカウントへ移り、被害者は自分のメールでログインできなくなる
    it("エイリアスを強制的に付け替えない（forceAliasCreation は false）", async () => {
        mockConfirmReg.mockImplementation(
            (_code: string, _f: boolean, cb: (e: null) => void) => cb(null));
        await confirmSignUp("uuid-1", "123456");

        expect(mockConfirmReg).toHaveBeenCalledWith("123456", false, expect.any(Function));
    });

    it("既に他のアカウントで使われているメールは、理由が分かる文言で止まる", async () => {
        mockConfirmReg.mockImplementation(
            (_code: string, _f: boolean, cb: (e: { name: string; message: string }) => void) => {
                cb({ name: "AliasExistsException", message: "An account with the email already exists." });
            });
        const res = await confirmSignUp("uuid-1", "123456");

        expect(res.success).toBe(false);
        expect(res.error).toContain("すでに別のアカウントで使われています");
        // **進む先まで書く。** ここに落ちる人の多くは「持っているのを忘れて
        // 登録し直した本人」で、コードは自分の受信箱に届いている。
        // 理由だけだと確認画面から出る道が無い（signUp 側には案内がある）。
        expect(res.error).toContain("ログイン");
        expect(res.error).toContain("再設定");
    });

    it("CodeMismatchException → 日本語メッセージ", async () => {
        mockConfirmReg.mockImplementation(
            (_code: string, _f: boolean, cb: (e: { name: string; message: string }) => void) => {
                cb({ name: "CodeMismatchException", message: "Invalid code." });
            }
        );
        const result = await confirmSignUp("uuid", "bad-code");
        expect(result.success).toBe(false);
        expect(result.error).toContain("確認コードが正しくありません");
    });

    it("成功 → success:true", async () => {
        mockConfirmReg.mockImplementation(
            (_code: string, _f: boolean, cb: (e: null) => void) => cb(null)
        );
        expect((await confirmSignUp("uuid", "123456")).success).toBe(true);
    });
});

// ────────────────────────────────
// getCurrentUserGroups / isAdmin / isGeneralUser
// ────────────────────────────────
describe("getCurrentUserGroups / isAdmin / isGeneralUser", () => {
    it("セッションなし → 空配列", async () => {
        mockGetCurrentUser.mockReturnValue(null);
        expect(await getCurrentUserGroups()).toEqual([]);
    });

    it("admin グループ → isAdmin が true", async () => {
        const s = { isValid: () => true, getIdToken: () => ({ payload: { "cognito:groups": ["admin"] } }) };
        mockGetCurrentUser.mockReturnValue({ getSession: mockGetSession });
        mockGetSession.mockImplementation((cb: (e: null, s2: typeof s) => void) => cb(null, s));
        expect(await isAdmin()).toBe(true);
    });

    it("user グループのみ → isGeneralUser が true", async () => {
        const s = { isValid: () => true, getIdToken: () => ({ payload: { "cognito:groups": ["user"] } }) };
        mockGetCurrentUser.mockReturnValue({ getSession: mockGetSession });
        mockGetSession.mockImplementation((cb: (e: null, s2: typeof s) => void) => cb(null, s));
        expect(await isGeneralUser()).toBe(true);
    });

    it("admin は isGeneralUser が false", async () => {
        const s = { isValid: () => true, getIdToken: () => ({ payload: { "cognito:groups": ["admin"] } }) };
        mockGetCurrentUser.mockReturnValue({ getSession: mockGetSession });
        mockGetSession.mockImplementation((cb: (e: null, s2: typeof s) => void) => cb(null, s));
        expect(await isGeneralUser()).toBe(false);
    });
});

// ────────────────────────────────
// lookupSession（「ログインしていない」と「確かめられなかった」を分ける）
// ────────────────────────────────
describe("lookupSession", () => {
    // ライブラリは `fetch` が TypeError で落ちた回を `Error("Network error")` に
    // 包み直して `code = "NetworkError"` を立てる
    // （node_modules/amazon-cognito-identity-js/lib/Client.js）。
    // これを見分けないと、圏外が「ログアウト」になり、編集中の画面ごと
    // ログイン画面へ追い出される
    const err = (props: Record<string, unknown>) => Object.assign(new Error(String(props.message ?? "x")), props);

    // **印は2つ別々に見る。** 最初は `{code, message}` を両方立てた1本しか
    // 無かったので、**`code` の判定を消しても緑**だった（message 側だけで
    // 通っていた）。片方ずつ立てて2本にする
    it("通信が届かなかった回は unreachable（code だけで見分ける）", async () => {
        mockGetCurrentUser.mockReturnValue({ getSession: mockGetSession });
        mockGetSession.mockImplementation((cb: (e: Error, s: null) => void) =>
            cb(err({ code: "NetworkError", message: "Failed to fetch" }), null));
        expect(await lookupSession()).toEqual({ session: null, unreachable: true });
    });

    it("code が無くても、ライブラリの文言なら unreachable", async () => {
        mockGetCurrentUser.mockReturnValue({ getSession: mockGetSession });
        mockGetSession.mockImplementation((cb: (e: Error, s: null) => void) =>
            cb(new Error("Network error"), null));
        expect((await lookupSession()).unreachable).toBe(true);
    });

    it("失効（NotAuthorizedException）は unreachable にしない", async () => {
        mockGetCurrentUser.mockReturnValue({ getSession: mockGetSession });
        mockGetSession.mockImplementation((cb: (e: Error, s: null) => void) =>
            cb(err({ code: "NotAuthorizedException", name: "NotAuthorizedException", message: "Refresh Token has expired" }), null));
        expect(await lookupSession()).toEqual({ session: null, unreachable: false });
    });

    it("そもそもログインしていない（getCurrentUser が null）も unreachable にしない", async () => {
        mockGetCurrentUser.mockReturnValue(null);
        expect(await lookupSession()).toEqual({ session: null, unreachable: false });
    });

    it("無効なセッションも unreachable にしない", async () => {
        mockGetCurrentUser.mockReturnValue({ getSession: mockGetSession });
        mockGetSession.mockImplementation((cb: (e: null, s: { isValid: () => boolean }) => void) =>
            cb(null, { isValid: () => false }));
        expect(await lookupSession()).toEqual({ session: null, unreachable: false });
    });

    // **返ってきたのが Cognito の応答でなかった回**（キャプティブポータル・
    // 中継機のエラーページ）。ライブラリの中で `TypeError` になる。
    // 文言は実物に通して測ったもの（`lib/auth/__tests__/captivePortal.test.ts`
    // が本物のライブラリで同じことを確かめている）
    it.each([
        ["200 で HTML（キャプティブポータル）", "Cannot convert undefined or null to object"],
        ["503 で HTML（中継機）", "Cannot read properties of undefined (reading 'split')"],
    ])("%s は unreachable", async (_label, message) => {
        mockGetCurrentUser.mockReturnValue({ getSession: mockGetSession });
        mockGetSession.mockImplementation((cb: (e: Error, s: null) => void) => cb(new TypeError(message), null));
        expect((await lookupSession()).unreachable).toBe(true);
    });

    // **理由を名乗っている応答は保たない。** 名乗っているならそれが答え
    it.each([
        ["失効", { code: "NotAuthorizedException", message: "Refresh Token has expired" }],
        ["サーバーの5xx", { code: "InternalErrorException", message: "boom" }],
        ["トークン欠損", { message: "Local storage is missing an ID Token, Please authenticate" }],
        ["更新できない", { message: "Cannot retrieve a new session. Please authenticate." }],
    ])("%s は unreachable にしない", async (_label, props) => {
        mockGetCurrentUser.mockReturnValue({ getSession: mockGetSession });
        mockGetSession.mockImplementation((cb: (e: Error, s: null) => void) => cb(err(props), null));
        expect((await lookupSession()).unreachable).toBe(false);
    });

    // **設定不備を「通信断」に混ぜない。** 混ぜると、前の状態を保つ側が
    // 永久に固まる（確かめ直しても毎回 unreachable になる）
    it("設定が壊れていて例外になった回は unreachable にしない", async () => {
        mockGetCurrentUser.mockImplementation(() => { throw new Error("no pool"); });
        expect(await lookupSession()).toEqual({ session: null, unreachable: false });
    });

    it("取れたときは session を返す（unreachable は false）", async () => {
        const sess = { isValid: () => true, getIdToken: () => ({ payload: {} }) };
        mockGetCurrentUser.mockReturnValue({ getSession: mockGetSession });
        mockGetSession.mockImplementation((cb: (e: null, s: unknown) => void) => cb(null, sess));
        const r = await lookupSession();
        expect(r.session).toBe(sess);
        expect(r.unreachable).toBe(false);
    });

    it("getCurrentSession は同じ答えの session だけを返す（既存の呼び出しは不変）", async () => {
        mockGetCurrentUser.mockReturnValue({ getSession: mockGetSession });
        mockGetSession.mockImplementation((cb: (e: Error, s: null) => void) =>
            cb(err({ code: "NetworkError" }), null));
        expect(await getCurrentSession()).toBeNull();
    });
});
