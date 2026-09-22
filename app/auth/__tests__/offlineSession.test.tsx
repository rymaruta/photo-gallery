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
// **セッションを引く口は `lib/auth/session.ts` へ移した**（認証 SDK を
// 全ページに載せないための薄い入口。`AuthProvider` はルートレイアウトに
// あるので、静的に `auth/cognito` を掴むと SDK が全ページに載る）。
// ここで見たいのは**その答えを受けた側の振る舞い**なので、境界も動かす。
// 短絡（端末に痕跡が無ければ SDK を読まない）そのものは
// `lib/auth/__tests__/session.test.ts` が見る。
vi.mock("../../../lib/auth/session", () => ({
    lookupSession: mockLookupSession,
    getCurrentSession: async () => (await mockLookupSession()).session,
}));
vi.mock("../../../lib/hooks/useFollow", () => ({ resetFollowingCache: vi.fn() }));
vi.mock("../../../lib/utils/shareStore", () => ({ clearSharedPayload: vi.fn(async () => { /* noop */ }) }));
// **列挙式のモックは、実装が新しく使い始めた export で undefined になる**
// （その分岐を通るテストだけが落ちる。台帳の既知の型）
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

let renders = 0;
function Harness() {
    const { isAuthenticated, isGeneralUser, userId, loading, logout } = useAuth();
    renders++;
    return (
        <>
            <div data-testid="state">
                {loading ? "loading" : isAuthenticated ? (isGeneralUser ? `in:user:${userId}` : "in") : "out"}
            </div>
            <button onClick={() => logout()}>ログアウト</button>
        </>
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
    const beforeRenders = renders;
    act(() => {
        window.dispatchEvent(new StorageEvent("storage", {
            key: "CognitoIdentityServiceProvider.client-test.u1.idToken",
            storageArea: window.localStorage,
        }));
    });
    await waitFor(() => expect(mockLookupSession.mock.calls.length).toBe(before + 1));
    // **呼ばれたことは「済んだこと」ではない。** ここで止めていた頃は、
    // 応答が state に届く前に抜けていたので、実装が実際に追い出していても
    // 「前のまま」を見て緑になった（分岐を消して `setAuthState` を 50ms
    // 遅らせる変異で確認）。**どちらの道でも `setAuthState` は新しい
    // オブジェクトを入れる**ので、再描画が必ず1回増える。それを関門にする
    await waitFor(() => expect(renders).toBeGreaterThan(beforeRenders));
}

beforeEach(() => { mockLookupSession.mockReset(); stableRouter.replace.mockReset(); renders = 0; });

describe("セッションを確かめられなかったとき", () => {
    it("圏外になっても、ログイン中のままにする（追い出さない）", async () => {
        mockLookupSession.mockResolvedValue(ok("u1"));
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:user:u1"));

        mockLookupSession.mockResolvedValue(offline);
        await recheck();

        // **権限も誰かも前のまま。** ここで `isGeneralUser` を落とすと、
        // `useMemberGate` が「権限が無い人」の画面を出す（追い出しより静かで、
        // かつ本人には直しようが無い）
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:user:u1"));
        expect(stableRouter.replace, "圏外なだけでログイン画面へ送っている").not.toHaveBeenCalled();
    });

    it("電波が戻ったら、そのまま続けられる", async () => {
        mockLookupSession.mockResolvedValue(ok("u1"));
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:user:u1"));

        mockLookupSession.mockResolvedValue(offline);
        await recheck();
        mockLookupSession.mockResolvedValue(ok("u1"));
        await recheck();

        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:user:u1"));
    });

    // 逆向きを殺さない: 本当に失効した／別タブでログアウトした場合は今までどおり
    it("本当に失効していたら、未ログインに戻す", async () => {
        mockLookupSession.mockResolvedValue(ok("u1"));
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:user:u1"));

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

// **確かめられなかったまま留まらない。**
// 電波が戻っても・ホテルの Wi-Fi の認証を済ませても、同じページに
// 留まっている限り確かめ直す契機が無かった。本当に失効していた場合は
// 「ログイン中の顔のまま、押すたびに『ログインしてください』と言われるが、
// ログイン画面への導線が無い」になる。
describe("確かめ直す契機", () => {
    /** イベントを投げて、判定が済むまで待つ */
    async function fire(make: () => void) {
        const before = mockLookupSession.mock.calls.length;
        const beforeRenders = renders;
        act(make);
        if (mockLookupSession.mock.calls.length === before) return false;   // 走らなかった
        await waitFor(() => expect(renders).toBeGreaterThan(beforeRenders));
        return true;
    }

    it("圏外のあと電波が戻ったら、確かめ直して未ログインに直す", async () => {
        mockLookupSession.mockResolvedValue(ok("u1"));
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:user:u1"));

        mockLookupSession.mockResolvedValue(offline);
        await recheck();
        expect(screen.getByTestId("state")).toHaveTextContent("in:user:u1");

        // 電波が戻った。実は失効していた
        mockLookupSession.mockResolvedValue(signedOut);
        expect(await fire(() => window.dispatchEvent(new Event("online"))), "確かめ直していない").toBe(true);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("out"));
    });

    it("画面に戻ってきたときも確かめ直す（ホテルのWi-Fiの認証を済ませた場合）", async () => {
        mockLookupSession.mockResolvedValue(ok("u1"));
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:user:u1"));

        mockLookupSession.mockResolvedValue(offline);
        await recheck();
        mockLookupSession.mockResolvedValue(signedOut);
        expect(await fire(() => document.dispatchEvent(new Event("visibilitychange"))), "確かめ直していない").toBe(true);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("out"));
    });

    // **増やしてよいのは「答えを持っていない」ときだけ。**
    // 常に確かめ直すと、本当に失効していた人が編集中に画面ごと
    // 追い出される機会を増やす（gate の replace は未保存の確認を通らない）
    it("確かめられている間は、復帰しても確かめ直さない", async () => {
        mockLookupSession.mockResolvedValue(ok("u1"));
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:user:u1"));

        const before = mockLookupSession.mock.calls.length;
        act(() => { window.dispatchEvent(new Event("online")); });
        act(() => { document.dispatchEvent(new Event("visibilitychange")); });
        expect(mockLookupSession.mock.calls.length, "確かめ済みなのに走っている").toBe(before);
    });

    // **一度確かめられたら、旗を下ろす。** 下ろさないと、答えを持っている
    // 人まで復帰のたびに判定にかけ続ける（上と同じ理由で危ない）
    it("圏外から戻って確かめられたら、そのあとは走らない", async () => {
        mockLookupSession.mockResolvedValue(ok("u1"));
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:user:u1"));

        mockLookupSession.mockResolvedValue(offline);
        await recheck();
        mockLookupSession.mockResolvedValue(ok("u1"));
        expect(await fire(() => window.dispatchEvent(new Event("online"))), "戻ったのに確かめ直していない").toBe(true);

        const before = mockLookupSession.mock.calls.length;
        act(() => { window.dispatchEvent(new Event("online")); });
        act(() => { document.dispatchEvent(new Event("visibilitychange")); });
        expect(mockLookupSession.mock.calls.length, "確かめ直したのに旗が残っている").toBe(before);
    });

    it("外したあとは購読が残らない", async () => {
        mockLookupSession.mockResolvedValue(ok("u1"));
        const { unmount } = render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:user:u1"));
        mockLookupSession.mockResolvedValue(offline);
        await recheck();
        unmount();

        const before = mockLookupSession.mock.calls.length;
        act(() => { window.dispatchEvent(new Event("online")); });
        expect(mockLookupSession.mock.calls.length).toBe(before);
    });
});

describe("旗の立て方・下ろし方", () => {
    async function fire(make: () => void) {
        const before = mockLookupSession.mock.calls.length;
        const beforeRenders = renders;
        act(make);
        if (mockLookupSession.mock.calls.length === before) return false;
        await waitFor(() => expect(renders).toBeGreaterThan(beforeRenders));
        return true;
    }

    // **開いた最初から圏外**のときは前の状態が無いので保てない（未ログインで
    // 始める）。ただし**答えを持っていないことは覚えておく**——覚えないと、
    // 電波が戻っても確かめ直す契機が来ず、端末にトークンが残っているのに
    // パス変更まで未ログインの顔のままになる
    it("最初から圏外でも、電波が戻ったら確かめ直す", async () => {
        mockLookupSession.mockResolvedValue(offline);
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("out"));

        mockLookupSession.mockResolvedValue(ok("u1"));
        expect(await fire(() => window.dispatchEvent(new Event("online"))), "確かめ直していない").toBe(true);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:user:u1"));
    });

    // `checkAuth` を通らない経路（ログイン・ログアウト・退会）でも札を揃える
    it("ログアウトしたら旗を下ろす（復帰のたびに確かめ直さない）", async () => {
        mockLookupSession.mockResolvedValue(ok("u1"));
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:user:u1"));
        mockLookupSession.mockResolvedValue(offline);
        await recheck();

        act(() => { screen.getByRole("button", { name: "ログアウト" }).click(); });
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("out"));

        const before = mockLookupSession.mock.calls.length;
        act(() => { window.dispatchEvent(new Event("online")); });
        expect(mockLookupSession.mock.calls.length, "ログアウト済みなのに確かめ直している").toBe(before);
    });

    // **裏に回した瞬間に走らせない。** 走らせると、裏で失効と分かった時点で
    // `useMemberGate` が `/login` へ replace し、戻ってきたら編集画面が
    // 消えている——この差分が名指しで避けている事故そのもの
    it("タブが隠れている間は確かめ直さない", async () => {
        mockLookupSession.mockResolvedValue(ok("u1"));
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:user:u1"));
        mockLookupSession.mockResolvedValue(offline);
        await recheck();

        const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
        try {
            const before = mockLookupSession.mock.calls.length;
            act(() => { document.dispatchEvent(new Event("visibilitychange")); });
            expect(mockLookupSession.mock.calls.length, "隠れている間に走っている").toBe(before);
        } finally { spy.mockRestore(); }
    });

    // 「タブに戻った瞬間に電波も戻った」＝いちばん起きやすい復帰の形。
    // 旗を下ろすのは判定が終わってからなので、札が無いと2本同時に飛ぶ
    it("online と visibilitychange が同時に来ても、判定は1回だけ", async () => {
        mockLookupSession.mockResolvedValue(ok("u1"));
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("in:user:u1"));
        mockLookupSession.mockResolvedValue(offline);
        await recheck();

        // 応答を止めたまま両方を投げる
        let release: (() => void) | null = null;
        mockLookupSession.mockImplementation(() => new Promise((res) => { release = () => res(ok("u1")); }));
        const before = mockLookupSession.mock.calls.length;
        act(() => {
            window.dispatchEvent(new Event("online"));
            document.dispatchEvent(new Event("visibilitychange"));
        });
        expect(mockLookupSession.mock.calls.length - before, "同時に2本飛んでいる").toBe(1);
        await act(async () => { release?.(); await Promise.resolve(); });
    });
});
