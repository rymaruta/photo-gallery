import { describe, it, expect, vi, beforeEach } from "vitest";

// config モック: 環境変数依存をなくす
vi.mock("../config", () => ({
    cognitoConfig: { userPoolId: "ap-northeast-1_test", clientId: "test-client-id", region: "ap-northeast-1" },
    ADMIN_GROUP_NAME: "admin",
    USER_GROUP_NAME: "user",
    PROTECTED_PATHS: ["/user/upload"],
}));

// Cognito SDK モック
const mockGetCurrentUser = vi.hoisted(() => vi.fn<[], null | object>(() => null));
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
    signIn, getCurrentSession, signUp, confirmSignUp,
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
