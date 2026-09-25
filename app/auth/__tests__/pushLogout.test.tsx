import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

/**
 * 🔴 **ログアウトでプッシュの宛先を外す順序。**
 *
 * `unregisterPushToken` は `userFetch` を使う＝Cognito の ID トークンが要る。
 * だから **`signOut()` より前に呼ばないと「認証が必要です」で落ちる**。
 * 落ちると宛先はサーバーに残り、**次にこの端末で別の人がログインするまで
 * 前の人宛ての通知が届き続ける**（サーバー側の持ち主の付け替えが救うのは、
 * その次のログインの瞬間から）。
 *
 * ⚠️ この順序は**変異で確かめて、見張りが無いことが分かったので足した**
 * （解除を `signOut()` の後ろへ動かしても、既存の32件は全部緑だった）。
 *
 * 退会（`deleteAccount`）の経路は**サーバーが宛先の行ごと消す**ので、
 * ここでは外さない。端末に残る印だけ捨てる（`clearAccountLocalState`）。
 */

const mockSignOut = vi.hoisted(() => vi.fn());
const mockGetCurrentSession = vi.hoisted(() => vi.fn());
const mockUnregister = vi.hoisted(() => vi.fn(async () => true));
const mockForgetStored = vi.hoisted(() => vi.fn());
/** 呼ばれた順に名前を積む。**順序そのものを固定するのが目的** */
const order = vi.hoisted(() => [] as string[]);

const stableRouter = { push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => stableRouter, usePathname: () => "/" }));
vi.mock("../../../lib/utils/api", () => ({ userFetch: vi.fn() }));
vi.mock("../../../lib/auth/config", () => ({
    cognitoConfig: { userPoolId: "pool-test", clientId: "client-test" },
}));
vi.mock("../../../lib/auth/cognito", () => ({
    signIn: vi.fn(),
    signOut: () => { order.push("signOut"); mockSignOut(); },
    getCurrentSession: mockGetCurrentSession,
    lookupSession: async () => ({ session: await mockGetCurrentSession(), unreachable: false }),
    deleteAccount: vi.fn(),
}));
vi.mock("../../../lib/auth/session", () => ({
    lookupSession: async () => ({ session: await mockGetCurrentSession(), unreachable: false }),
    getCurrentSession: mockGetCurrentSession,
}));
vi.mock("../../../lib/push/deviceToken", () => ({
    unregisterPushToken: async (...a: unknown[]) => { order.push("unregister"); return mockUnregister(...(a as [])); },
    forgetStoredDeviceToken: () => { order.push("forgetStored"); mockForgetStored(); },
}));
vi.mock("../../../lib/hooks/useFollow", () => ({ resetFollowingCache: vi.fn() }));
vi.mock("../../../lib/utils/shareStore", () => ({ clearSharedPayload: vi.fn(async () => { /* noop */ }) }));
vi.mock("../../../lib/stories", () => ({
    clearSeenStories: vi.fn(),
    setSeenStoriesUser: vi.fn(),
    removeSeenStoriesUserData: vi.fn(),
}));
vi.mock("../../../lib/hooks/useFavorites", () => ({
    setFavoritesUser: vi.fn(),
    removeFavoritesUserData: vi.fn(),
}));

const { AuthProvider, useAuth } = await import("../context");

function Harness() {
    const { isAuthenticated, loading, logout } = useAuth();
    return (
        <div>
            <span data-testid="state">{loading ? "loading" : isAuthenticated ? "in" : "out"}</span>
            <button onClick={() => void logout()}>ログアウト</button>
        </div>
    );
}

const session = (sub: string) => ({ getIdToken: () => ({ payload: { sub, "cognito:groups": ["user"] } }) });

beforeEach(() => {
    order.length = 0;
    mockSignOut.mockReset();
    mockForgetStored.mockReset();
    mockUnregister.mockReset().mockResolvedValue(true);
    mockGetCurrentSession.mockReset().mockResolvedValue(session("u1"));
    stableRouter.push.mockReset();
    localStorage.clear();
});

async function loginThenLogout() {
    render(<AuthProvider><Harness /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("in"));
    await act(async () => { screen.getByText("ログアウト").click(); });
}

describe("ログアウトとプッシュの宛先", () => {
    it("宛先を外してから `signOut` する", async () => {
        await loginThenLogout();
        expect(order.includes("unregister"), "宛先を外していない").toBe(true);
        expect(order.includes("signOut")).toBe(true);
        expect(order.indexOf("unregister"),
            "`signOut` のあとに外そうとしている（認証が切れていて外せない）")
            .toBeLessThan(order.indexOf("signOut"));
    });

    // **外せなくてもログアウトは完了する。** 通知が届かない方が、
    // ログアウトできない方よりましだから
    it("外すのが失敗しても、ログアウトは通る", async () => {
        mockUnregister.mockResolvedValue(false);
        await loginThenLogout();
        expect(mockSignOut).toHaveBeenCalled();
        await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("out"));
        expect(stableRouter.push).toHaveBeenCalledWith("/");
    });

    // 投げる実装に変わっても、ここで止まらないこと（`await` の前で握る）
    it("外すのが投げても、ログアウトは通る", async () => {
        mockUnregister.mockRejectedValue(new Error("boom"));
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("in"));
        await act(async () => { screen.getByText("ログアウト").click(); });
        // 投げると `logout` がそこで終わる。**それを許さない**——
        // `unregisterPushToken` 側が投げない契約だが、ここでも固定する
        expect(mockSignOut, "宛先を外すのが投げてログアウトが止まっている").toHaveBeenCalled();
    });

    // 端末に残る印は、ログアウトでも退会でも捨てる（`clearAccountLocalState`）
    it("覚えた印も捨てる", async () => {
        await loginThenLogout();
        expect(mockForgetStored, "端末に残る印を捨てていない").toHaveBeenCalled();
    });
});
