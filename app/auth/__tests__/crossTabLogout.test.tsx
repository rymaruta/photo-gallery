import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

// 認証の判定はパス変更のときだけだった。別のタブでログアウト・退会しても、
// 同じページに留まっているこのタブは「ログイン中の顔」のまま操作を受け付ける。
// トークンはもう無いので、いいね・フォロー・コメントは全部失敗する。
// amazon-cognito-identity-js は localStorage にトークンを置くので、
// 他タブの signOut は storage イベントとして必ず届く。

const mockSignIn = vi.hoisted(() => vi.fn());
const mockGetCurrentSession = vi.hoisted(() => vi.fn());
const mockCognitoDelete = vi.hoisted(() => vi.fn());
const mockSignOut = vi.hoisted(() => vi.fn());

const stableRouter = { push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({
    useRouter: () => stableRouter,
    usePathname: () => "/",
}));
vi.mock("../../../lib/utils/api", () => ({ userFetch: vi.fn() }));
vi.mock("../../../lib/auth/config", () => ({ cognitoConfig: { userPoolId: "pool-test", clientId: "client-test" } }));
vi.mock("../../../lib/auth/cognito", () => ({
    signIn: mockSignIn,
    signOut: mockSignOut,
    getCurrentSession: mockGetCurrentSession,
    deleteAccount: mockCognitoDelete,
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
    const { isAuthenticated, loading } = useAuth();
    return <div data-testid="state">{loading ? "loading" : isAuthenticated ? "in" : "out"}</div>;
}

const session = (sub: string) => ({
    getIdToken: () => ({ payload: { sub, "cognito:groups": ["user"] } }),
});

/** 別のタブからの localStorage 変更 */
function otherTabWrote(key: string | null) {
    act(() => {
        window.dispatchEvent(new StorageEvent("storage", { key, storageArea: window.localStorage }));
    });
}

beforeEach(() => {
    mockGetCurrentSession.mockReset();
    mockSignOut.mockReset();
});

describe("別タブでのログアウト", () => {
    it("トークンが消えたら、こちらのタブも未ログインに戻る", async () => {
        mockGetCurrentSession.mockResolvedValue(session("u1"));
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in"));

        // 別タブが signOut し、Cognito のトークンが消えた
        mockGetCurrentSession.mockResolvedValue(null);
        otherTabWrote("CognitoIdentityServiceProvider.client-test.u1.idToken");

        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("out"));
    });

    it("localStorage.clear()（key が null）も拾う", async () => {
        mockGetCurrentSession.mockResolvedValue(session("u1"));
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in"));

        mockGetCurrentSession.mockResolvedValue(null);
        otherTabWrote(null);

        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("out"));
    });

    it("関係ないキーの変更では見に行かない（別タブのお気に入り等で毎回走らせない）", async () => {
        mockGetCurrentSession.mockResolvedValue(session("u1"));
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in"));

        const before = mockGetCurrentSession.mock.calls.length;
        otherTabWrote("jp_favorites:u1");
        otherTabWrote("jp_seen_stories");
        expect(mockGetCurrentSession.mock.calls.length).toBe(before);
        expect(screen.getByTestId("state")).toHaveTextContent("in");
    });

    it("別タブがログインしたら、こちらもログイン中になる", async () => {
        mockGetCurrentSession.mockResolvedValue(null);
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("out"));

        mockGetCurrentSession.mockResolvedValue(session("u2"));
        otherTabWrote("CognitoIdentityServiceProvider.client-test.u2.idToken");

        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in"));
    });

    it("外したあとは購読が残らない", async () => {
        mockGetCurrentSession.mockResolvedValue(session("u1"));
        const { unmount } = render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in"));
        unmount();

        const before = mockGetCurrentSession.mock.calls.length;
        otherTabWrote("CognitoIdentityServiceProvider.client-test.u1.idToken");
        expect(mockGetCurrentSession.mock.calls.length).toBe(before);
    });
});
