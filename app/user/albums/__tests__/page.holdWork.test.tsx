import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **打ちかけがあるときは送り返さない**（`useMemberGate` の性質）。
// `/user/profile` で同じものを直した回に、この画面を取りこぼしていた
// ——「横断で探した」と書いておきながら3件目を見落としていた。
//
// **そして直した回に、今度は「画面も出す」を落とした。**
// `gate !== "ok"` でスピナーに落としていたので、送り返さなくても
// **見えないまま止まる**だけだった（`/user/upload:1016` のコメントが
// この形を名指しで戒めている）。
//
// **`useMemberGate` をモックしない。** 既存の `page.test.tsx` は
// あちらをモックしているので、引数を渡したかどうかは原理的に観測できない。
// `useAuth` を差し替えて本物の門を通す。

const mockShowToast = vi.hoisted(() => vi.fn());
const mockUserFetch = vi.hoisted(() => vi.fn());
const mockReplace = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({
    current: { isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: mockReplace }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../../../lib/utils/api")>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const AlbumsPage = (await import("../page")).default;

const toasts = () => mockShowToast.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
    authState.current = { isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false };
    mockShowToast.mockReset();
    mockReplace.mockReset();
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ albums: [] }) });
});

/** 読み込み終わりまで待って、新しいアルバム名を打つ */
async function typeNewAlbumName() {
    const { rerender } = render(<AlbumsPage />);
    const input = await screen.findByPlaceholderText("例: 北欧の冬");
    await userEvent.type(input, "石垣島の3日間");
    return rerender;
}

describe("共同アルバム: ログインが切れたときに打ちかけを守る", () => {
    it("打ちかけがあれば送り返さず、画面も消さない", async () => {
        const rerender = await typeNewAlbumName();

        authState.current = { ...authState.current, isAuthenticated: false };
        rerender(<AlbumsPage />);

        await waitFor(() => expect(toasts().some((t) => t.includes("保存できません"))).toBe(true));
        expect(mockReplace, "打ちかけごと画面を作り直している").not.toHaveBeenCalled();
        // **スピナーに落とさない**——見えないまま止まるのは送り返すのと同じ
        expect(screen.getByDisplayValue("石垣島の3日間"), "打った名前が画面から消えている").toBeInTheDocument();
    });

    // **留めすぎない。** 打ちかけが無ければ今までどおり送り返す
    it("打ちかけが無ければ、今までどおり送り返す", async () => {
        render(<AlbumsPage />);
        await screen.findByPlaceholderText("例: 北欧の冬");

        authState.current = { ...authState.current, isAuthenticated: false };
        render(<AlbumsPage />);

        await waitFor(() => expect(mockReplace).toHaveBeenCalled());
        expect(String(mockReplace.mock.calls[0][0])).toContain("/login");
    });

    // **二度目を無言にしない**（他の3画面と同じ理由で札を下ろす）
    it("ログインし直してまた切れたら、もう一度言う", async () => {
        const rerender = await typeNewAlbumName();

        authState.current = { ...authState.current, isAuthenticated: false };
        rerender(<AlbumsPage />);
        await waitFor(() => expect(toasts().filter((t) => t.includes("保存できません"))).toHaveLength(1));

        authState.current = { ...authState.current, isAuthenticated: true };
        rerender(<AlbumsPage />);
        authState.current = { ...authState.current, isAuthenticated: false };
        rerender(<AlbumsPage />);

        await waitFor(() => expect(
            toasts().filter((t) => t.includes("保存できません")),
            "二度目が無言になっている",
        ).toHaveLength(2));
    });
});
