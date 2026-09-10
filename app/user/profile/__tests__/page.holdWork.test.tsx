import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **会員ページの門を手書きで写していて、歯止めだけ抜けていた。**
//
// `/user/edit` `/user/upload` `/user/drafts` `/user/albums` は
// `useMemberGate` を使う。あちらは「**打ちかけがあるときは送り返さない**」
// を持っている（`router.replace` は画面を作り直すので、書いた文章ごと
// 消えるため）。この画面だけ同じ判定を手で書いていて、その1行が無かった。
//
// 踏むのは**別タブでログアウト・退会**したとき（`storage` イベントで
// `isAuthenticated` が落ちる）。自己紹介を書いている最中だと、
// 画面が `/login` に置き換わって打った文章が消える。

const mockShowToast = vi.fn();
const mockUserFetch = vi.fn();
const mockReplace = vi.fn();
const authState = vi.hoisted(() => ({ current: { isAuthenticated: true, loading: false } }));

vi.mock("../BlockedUsers", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: mockReplace }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", async () => {
    const actual = await vi.importActual<typeof import("../../../../lib/utils/api")>("../../../../lib/utils/api");
    return { ...actual, userFetch: (...args: unknown[]) => mockUserFetch(...args) };
});
vi.mock("../../../../lib/utils/image", () => ({
    toUploadSafeFile: async (f: File) => f,
    UnstrippableFileError: class extends Error {},
    AVATAR_MAX_PX: 512, COVER_MAX_PX: 1280,
}));
vi.mock("../../../components/DeleteAccountModal", () => ({ default: () => null }));

const ProfilePage = (await import("../page")).default;

const STORED = { userId: "u1", username: "tabibito", displayName: "旅人", bio: "こんにちは" };
const toasts = () => mockShowToast.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
    authState.current = { isAuthenticated: true, loading: false };
    mockShowToast.mockReset();
    mockReplace.mockReset();
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => STORED });
});

/** 読み込み終わりまで待って、自己紹介を1文字直す */
async function openAndType() {
    const { rerender } = render(<ProfilePage />);
    const bio = await screen.findByDisplayValue("こんにちは");
    await userEvent.type(bio, "！");
    return rerender;
}

describe("プロフィール編集: ログインが切れたときに打ちかけを守る", () => {
    it("打ちかけがあれば、ログインが切れても送り返さない", async () => {
        const rerender = await openAndType();

        // 別タブでログアウトした
        authState.current = { isAuthenticated: false, loading: false };
        rerender(<ProfilePage />);

        await waitFor(() => expect(toasts().some((t) => t.includes("保存できません"))).toBe(true));
        expect(mockReplace, "打ちかけごと画面を作り直している").not.toHaveBeenCalled();
        // 打った文字は残っている
        expect(screen.getByDisplayValue("こんにちは！")).toBeInTheDocument();
    });

    // **打ちかけが無ければ今までどおり。** 留めすぎると、ログインが切れた
    // 人が使えない画面に残り続ける
    it("打ちかけが無ければ、今までどおり送り返す", async () => {
        render(<ProfilePage />);
        await screen.findByDisplayValue("こんにちは");

        authState.current = { isAuthenticated: false, loading: false };
        render(<ProfilePage />);

        await waitFor(() => expect(mockReplace).toHaveBeenCalled());
        expect(String(mockReplace.mock.calls[0][0])).toContain("/login");
    });

    // 判定中（`loading`）を「未ログイン」と混ぜない
    it("判定中は送り返さない", async () => {
        authState.current = { isAuthenticated: false, loading: true };
        render(<ProfilePage />);
        await waitFor(() => expect(mockUserFetch).not.toHaveBeenCalled());
        expect(mockReplace, "判定が終わる前に送り返している").not.toHaveBeenCalled();
    });

    // **二度目を無言にしない**（`/user/edit` が同じ理由で札を下ろす）
    it("ログインし直してまた切れたら、もう一度言う", async () => {
        const rerender = await openAndType();

        authState.current = { isAuthenticated: false, loading: false };
        rerender(<ProfilePage />);
        await waitFor(() => expect(toasts().filter((t) => t.includes("保存できません"))).toHaveLength(1));

        authState.current = { isAuthenticated: true, loading: false };
        rerender(<ProfilePage />);
        authState.current = { isAuthenticated: false, loading: false };
        rerender(<ProfilePage />);

        await waitFor(() => expect(
            toasts().filter((t) => t.includes("保存できません")),
            "二度目が無言になっている",
        ).toHaveLength(2));
    });
});
