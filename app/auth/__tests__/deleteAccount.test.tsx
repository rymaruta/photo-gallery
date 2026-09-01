import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// 退会は不可逆で、しかも**2つの系にまたがる**（サーバーのデータと Cognito の
// アカウント）。順序を誤ると、利用者に何も知らせないまま矛盾した状態になる:
//
//   ログインしたままタブを放置してリフレッシュトークンが古くなる
//   → 退会を押す → DELETE /user/account は 200（写真も S3 もプロフィールも消える）
//   → Cognito の削除が「セッションが無効です」で失敗
//   → 画面には「退会処理に失敗しました」とだけ出る
//   利用者はログインしたままで、ギャラリーだけが空になる。
//   「失敗した」と言われているので、消えたことに気づく手がかりが無い。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockSignIn = vi.hoisted(() => vi.fn());
const mockGetCurrentSession = vi.hoisted(() => vi.fn());
const mockCognitoDelete = vi.hoisted(() => vi.fn());
const mockSignOut = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());

const stableRouter = { push: mockPush, replace: vi.fn() };
vi.mock("next/navigation", () => ({
    useRouter: () => stableRouter,
    usePathname: () => "/user/profile",
}));
vi.mock("../../../lib/utils/api", () => ({ userFetch: mockUserFetch }));
// テスト環境は NEXT_PUBLIC_* が無く cognitoConfig が空になり、checkAuth が
// 「設定なし」経路で止まって成功経路を測れない。設定ありとして通す
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
const { resetFollowingCache } = await import("../../../lib/hooks/useFollow");
const { clearSharedPayload } = await import("../../../lib/utils/shareStore");
const { clearSeenStories } = await import("../../../lib/stories");
const { setFavoritesUser, removeFavoritesUserData } = await import("../../../lib/hooks/useFavorites");

/** 退会を押して、返ってきた結果をそのまま画面に出すだけの部品 */
function Harness() {
    const { deleteAccount } = useAuth();
    const [result, setResult] = React.useState<string>("");
    return (
        <>
            <button onClick={() => void deleteAccount().then((r) => setResult(JSON.stringify(r)))}>
                退会する
            </button>
            <output>{result}</output>
        </>
    );
}

// payload まで持たせる。以前は無く、マウント時の checkAuth が
// payload["cognito:groups"] の TypeError で catch 落ちし、成功経路
// （setFavoritesUser の配線を含む）がテストで一度も走っていなかった
// （配線を消しても全テスト緑＝AS 系レビューが変異で実証した穴）。
const validSession = {
    isValid: () => true,
    getIdToken: () => ({ getJwtToken: () => "jwt", payload: { "sub": "user-a", "cognito:groups": ["user"] } }),
};
const expiredSession = {
    isValid: () => false,
    getIdToken: () => ({ getJwtToken: () => "jwt", payload: { "sub": "user-a", "cognito:groups": ["user"] } }),
};

const clickDelete = async () => {
    render(<AuthProvider><Harness /></AuthProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "退会する" }));
};
const result = async () => {
    await waitFor(() => expect(screen.getByRole("status").textContent).not.toBe(""));
    return JSON.parse(screen.getByRole("status").textContent!) as { success: boolean; error?: string };
};

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    mockGetCurrentSession.mockReset().mockResolvedValue(validSession);
    mockCognitoDelete.mockReset().mockResolvedValue({ success: true });
    mockSignOut.mockReset();
    mockPush.mockReset();
    mockSignIn.mockReset();
    // vi.mock の factory はファイルで1回しか走らないため、呼び出し回数は
    // テスト間で累積する。クリアしないと「成功経路で呼ばれた」の断言が
    // 他のテストの呼び出しを拾って空振りする（55b20b1 レビューの指摘）。
    vi.mocked(resetFollowingCache).mockClear();
    vi.mocked(clearSharedPayload).mockClear();
    vi.mocked(clearSeenStories).mockClear();
    vi.mocked(setFavoritesUser).mockClear();
    vi.mocked(removeFavoritesUserData).mockClear();
});

describe("退会: 消す前に、後段が通ることを確かめる", () => {
    it("セッションが切れていたら、サーバーのデータを消しに行かない", async () => {
        mockGetCurrentSession.mockResolvedValue(expiredSession);
        await clickDelete();

        const r = await result();
        expect(r.success).toBe(false);
        // ここが肝。DELETE を投げていない＝写真もプロフィールも残っている
        const deletes = mockUserFetch.mock.calls.filter(
            (c) => (c[1] as { method?: string } | undefined)?.method === "DELETE");
        expect(deletes).toHaveLength(0);
        expect(mockCognitoDelete).not.toHaveBeenCalled();
        expect(r.error).toContain("ログインし直して");
    });

    it("セッションがそもそも無ければ何も消さない", async () => {
        mockGetCurrentSession.mockResolvedValue(null);
        await clickDelete();

        expect((await result()).success).toBe(false);
        expect(mockUserFetch.mock.calls.filter(
            (c) => (c[1] as { method?: string } | undefined)?.method === "DELETE")).toHaveLength(0);
    });

    // 事前確認を通ってもなお Cognito 側が落ちることはある（通信断など）。
    // そのときは「何も起きなかった」と読める文言にしない。
    it("データ削除後に Cognito が落ちたら、消えたことを伝える", async () => {
        mockCognitoDelete.mockResolvedValue({ success: false, error: "セッションが無効です" });
        await clickDelete();

        const r = await result();
        expect(r.success).toBe(false);
        expect(r.error).toContain("削除されました");
        expect(r.error).toContain("アカウント自体の削除だけが残っています");
        // 「退会処理に失敗しました」だけ、では読み手に何も伝わらない
        expect(r.error).not.toBe("アカウントの削除に失敗しました");
    });

    it("サーバー側が落ちたら Cognito は消さない（消えないアカウントを残さない）", async () => {
        mockUserFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        await clickDelete();

        expect((await result()).success).toBe(false);
        expect(mockCognitoDelete).not.toHaveBeenCalled();
    });

    it("両方通れば成功し、サインアウトしてトップへ戻す", async () => {
        await clickDelete();

        expect((await result()).success).toBe(true);
        expect(mockSignOut).toHaveBeenCalled();
        expect(mockPush).toHaveBeenCalledWith("/");
        // ログアウトと同じ掃除。退会経路だけ抜けていて、同じタブで次に
        // 登録した人に前の人のフォロー一覧が使われる形が残っていた
        expect(resetFollowingCache).toHaveBeenCalled();
        // 共有シートのペイロードとストーリー既読も、前の人の分を残さない
        expect(clearSharedPayload).toHaveBeenCalled();
        expect(clearSeenStories).toHaveBeenCalled();
        // お気に入りは共有キー（未ログイン）に戻し、消したアカウントの
        // 鍵付きデータも端末から消す
        expect(setFavoritesUser).toHaveBeenCalledWith(null);
        expect(removeFavoritesUserData).toHaveBeenCalledWith("user-a");
    });
});

// セッション失効など「明示ログアウトを通らない切れ方」では logout の掃除が
// 走らない。どの経路で切れていても新しいログインは白紙から始まるように、
// ログイン成功時にもキャッシュを捨てる。
describe("ログイン成功時にフォロー一覧のキャッシュを捨てる", () => {
    function LoginHarness() {
        const { login } = useAuth();
        const [done, setDone] = React.useState("");
        return (
            <>
                <button onClick={() => void login("user@example.com", "pw").then((r) => setDone(JSON.stringify(r)))}>
                    ログイン
                </button>
                <output>{done}</output>
            </>
        );
    }

    it("成功したら resetFollowingCache が呼ばれる", async () => {
        mockSignIn.mockResolvedValue({
            success: true,
            groups: ["user"],
            session: { getIdToken: () => ({ payload: { sub: "new-user" } }) },
        });
        render(<AuthProvider><LoginHarness /></AuthProvider>);
        await userEvent.click(await screen.findByRole("button", { name: "ログイン" }));
        await waitFor(() => expect(screen.getByRole("status").textContent).toContain("true"));
        expect(resetFollowingCache).toHaveBeenCalled();
        // お気に入りをこのアカウントのキーに向ける
        expect(setFavoritesUser).toHaveBeenCalledWith("new-user");
    });

    it("失敗したら呼ばれない（触っていないキャッシュを消さない）", async () => {
        mockSignIn.mockResolvedValue({ success: false, error: "bad" });
        render(<AuthProvider><LoginHarness /></AuthProvider>);
        await userEvent.click(await screen.findByRole("button", { name: "ログイン" }));
        await waitFor(() => expect(screen.getByRole("status").textContent).toContain("false"));
        expect(resetFollowingCache).not.toHaveBeenCalled();
    });
});

// ログアウトでも同じ掃除が走る。ログイン成功では**走らない**——
// 「共有シート → ログイン → 取り込み」の本流ペイロードを消さないため。
describe("端末に残る前の人のデータの掃除", () => {
    function LogoutHarness() {
        const { logout } = useAuth();
        return <button onClick={() => logout()}>ログアウト</button>;
    }

    it("ログアウトで共有ペイロードとストーリー既読を捨てる", async () => {
        render(<AuthProvider><LogoutHarness /></AuthProvider>);
        await userEvent.click(await screen.findByRole("button", { name: "ログアウト" }));
        expect(clearSharedPayload).toHaveBeenCalled();
        expect(clearSeenStories).toHaveBeenCalled();
        expect(setFavoritesUser).toHaveBeenCalledWith(null);
    });

    it("ログイン成功では捨てない（共有→ログイン→取り込みを壊さない）", async () => {
        mockSignIn.mockResolvedValue({
            success: true,
            groups: ["user"],
            session: { getIdToken: () => ({ payload: { sub: "u" } }) },
        });
        function LoginHarness2() {
            const { login } = useAuth();
            const [done, setDone] = React.useState("");
            return (
                <>
                    <button onClick={() => void login("a@example.com", "pw").then((r) => setDone(JSON.stringify(r)))}>ログイン</button>
                    <output>{done}</output>
                </>
            );
        }
        render(<AuthProvider><LoginHarness2 /></AuthProvider>);
        await userEvent.click(await screen.findByRole("button", { name: "ログイン" }));
        await waitFor(() => expect(screen.getByRole("status").textContent).toContain("true"));
        expect(clearSharedPayload).not.toHaveBeenCalled();
        expect(clearSeenStories).not.toHaveBeenCalled();
    });
});

// リロード（マウント時の checkAuth）でもお気に入りをそのアカウントの
// キーへ向け直す。AS-2 の中核経路だが、validSession が payload を
// 持たなかった頃は checkAuth が catch 落ちして一度も測れていなかった。
describe("checkAuth がお気に入りのキーを向け直す", () => {
    it("マウント時、セッションの sub でキーを向ける", async () => {
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(setFavoritesUser).toHaveBeenCalledWith("user-a"));
    });

    it("セッションが無ければ共有キーに向ける", async () => {
        mockGetCurrentSession.mockResolvedValue(null);
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(setFavoritesUser).toHaveBeenCalledWith(null));
    });

    it("判定に失敗したときも前のユーザーのキーを向いたままにしない", async () => {
        mockGetCurrentSession.mockRejectedValue(new Error("cognito down"));
        render(<AuthProvider><Harness /></AuthProvider>);
        await waitFor(() => expect(setFavoritesUser).toHaveBeenCalledWith(null));
    });
});
