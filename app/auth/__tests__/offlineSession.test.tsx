import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

// **圏外で「ログアウトした」ことにしていた。**
// `getCurrentSession` は「リフレッシュトークンが失効した」も
// 「更新の通信が落ちた」も同じ `null` に潰していたので、電波の悪い場所で
// 画面を移ると `isAuthenticated` が false になり、`useMemberGate` が
// `/login` へ replace する——**トークンは端末に残っているのに**、
// 編集中の文章ごと画面が入れ替わる。電波が戻れば何もせず直るので、
// 本人には理由が分からない。
//
// ライブラリ（amazon-cognito-identity-js）は通信断を
// `err.code === "NetworkError"` として渡してくる
// （node_modules/amazon-cognito-identity-js/lib/Client.js:146）ので、
// 失効（`NotAuthorizedException`）と見分けられる。

const mockLookupSession = vi.hoisted(() => vi.fn());

const stableRouter = { push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({
    useRouter: () => stableRouter,
    usePathname: () => "/",
}));
vi.mock("../../../lib/utils/api", () => ({ userFetch: vi.fn() }));
vi.mock("../../../lib/auth/config", () => ({ cognitoConfig: { userPoolId: "pool-test", clientId: "client-test" } }));
vi.mock("../../../lib/auth/cognito", () => ({
    signIn: vi.fn(),
    signOut: vi.fn(),
    getCurrentSession: vi.fn(),
    lookupSession: mockLookupSession,
    deleteAccount: vi.fn(),
}));
vi.mock("../../../lib/hooks/useFollow", () => ({ resetFollowingCache: vi.fn() }));
vi.mock("../../../lib/utils/shareStore", () => ({ clearSharedPayload: vi.fn(async () => { /* noop */ }) }));
vi.mock("../../../lib/stories", () => ({ clearSeenStories: vi.fn() }));
vi.mock("../../../lib/hooks/useFavorites", () => ({
    setFavoritesUser: vi.fn(),
    removeFavoritesUserData: vi.fn(),
}));

const { AuthProvider, useAuth } = await import("../context");

function Harness() {
    const { isAuthenticated, isGeneralUser, loading } = useAuth();
    return (
        <div data-testid="state">
            {loading ? "loading" : isAuthenticated ? (isGeneralUser ? "in:user" : "in") : "out"}
        </div>
    );
}

const session = (sub: string) => ({ getIdToken: () => ({ payload: { sub, "cognito:groups": ["user"] } }) });
const ok = (sub: string) => ({ session: session(sub), unreachable: false });
const signedOut = { session: null, unreachable: false };
const offline = { session: null, unreachable: true };

/**
 * 別のタブからの localStorage 変更（＝この画面が判定をやり直す唯一の契機）。
 *
 * **やり直しが済むまで待つ。** 最初はイベントを投げるだけだったので、
 * 「変わっていないこと」を見るテストが**状態が更新される前に真になって
 * 通っていた**（実装から分岐を消しても4件とも緑だった＝何も守っていない）。
 * 呼び出し回数が増えたことを見て、そのあと保留中の更新を流す。
 */
async function recheck() {
    const before = mockLookupSession.mock.calls.length;
    act(() => {
        window.dispatchEvent(new StorageEvent("storage", {
            key: "CognitoIdentityServiceProvider.client-test.u1.idToken",
            storageArea: window.localStorage,
        }));
    });
    await waitFor(() => expect(mockLookupSession.mock.calls.length).toBe(before + 1));
    // 解決後の setState を反映させる（ここを飛ばすと「前のまま」を見てしまう）
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => { mockLookupSession.mockReset(); stableRouter.replace.mockReset(); });

describe("セッションを確かめられなかったとき", () => {
    it("圏外になっても、ログイン中のままにする（追い出さない）", async () => {
        mockLookupSession.mockResolvedValue(ok("u1"));
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:user"));

        mockLookupSession.mockResolvedValue(offline);
        await recheck();

        // **権限まで含めて前のまま。** ここで `isGeneralUser` を落とすと、
        // `useMemberGate` が「権限が無い人」の画面を出す（追い出しより静かで、
        // かつ本人には直しようが無い）
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:user"));
        expect(stableRouter.replace, "圏外なだけでログイン画面へ送っている").not.toHaveBeenCalled();
    });

    it("電波が戻ったら、そのまま続けられる", async () => {
        mockLookupSession.mockResolvedValue(ok("u1"));
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:user"));

        mockLookupSession.mockResolvedValue(offline);
        await recheck();
        mockLookupSession.mockResolvedValue(ok("u1"));
        await recheck();

        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:user"));
    });

    // 逆向きを殺さない: 本当に失効した／別タブでログアウトした場合は今までどおり
    it("本当に失効していたら、未ログインに戻す", async () => {
        mockLookupSession.mockResolvedValue(ok("u1"));
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:user"));

        mockLookupSession.mockResolvedValue(signedOut);
        await recheck();

        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("out"));
    });

    // **開いた最初から圏外**のときは、前の状態が無いので保てない。
    // ここは今までどおり未ログイン（打ったものが無いので失うものが無い）
    it("最初から確かめられないときは、未ログインとして始める", async () => {
        mockLookupSession.mockResolvedValue(offline);
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("out"));
    });
});
