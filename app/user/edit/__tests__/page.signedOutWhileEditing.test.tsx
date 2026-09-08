import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// **打っている途中でログインが切れると、文章ごと画面が入れ替わっていた。**
// `useMemberGate` は未ログインを見ると `router.replace("/login?next=…")` を
// 呼ぶ。これは画面を作り直すので、**未保存の確認（「破棄して戻る」）を
// 通らない**——別のタブでログアウトした瞬間に、打ちかけの説明が消える。
// ログインが切れた側はどのみち保存できないが、**書いたものを消してよい
// 理由にはならない**。送り返さずに、保存できないことを伝える。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const mockReplace = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ isAuthenticated: true }));

vi.mock("../../../../lib/utils/api", async () => {
    const actual = await vi.importActual<typeof import("../../../../lib/utils/api")>("../../../../lib/utils/api");
    return { ...actual, userFetch: mockUserFetch };
});
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: mockReplace, back: vi.fn() }),
    useSearchParams: () => new URLSearchParams("id=p1"),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({
        isAuthenticated: auth.isAuthenticated,
        isAdminUser: false,
        isGeneralUser: auth.isAuthenticated,
        loading: false,
    }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const EditPage = (await import("../page")).default;

const photo = { id: "p1", src: "https://cdn/p1.jpg", title: "夕焼け", location: "江ノ島", published: true };

beforeEach(() => {
    auth.isAuthenticated = true;
    mockShowToast.mockReset(); mockReplace.mockReset();
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [photo] });
});

/** 読み込んで、タイトルを直した状態にする */
async function editing() {
    const view = render(<EditPage />);
    fireEvent.change(await screen.findByDisplayValue("夕焼け"), { target: { value: "夕焼けの色" } });
    return view;
}

const toasts = () => mockShowToast.mock.calls.map((c) => String(c[0]));

describe("編集中にログインが切れたとき", () => {
    it("打ちかけがあるなら、ログイン画面へ送り返さない", async () => {
        const { rerender } = await editing();
        auth.isAuthenticated = false;
        rerender(<EditPage />);

        await waitFor(() => expect(toasts().length).toBeGreaterThan(0));
        expect(mockReplace, "打ちかけごと画面を入れ替えている").not.toHaveBeenCalled();
        expect(screen.getByDisplayValue("夕焼けの色"), "打ったものが消えている").toBeInTheDocument();
    });

    it("保存できないことを伝える（黙って居座らせない）", async () => {
        const { rerender } = await editing();
        auth.isAuthenticated = false;
        rerender(<EditPage />);

        await waitFor(() => expect(toasts().some((t) => t.includes("ログインが切れました"))).toBe(true));
    });

    // **打ち直すたびに言わない。** 元に戻す→また打つ で「打ちかけ」の
    // 有無が変わるので、札が無いとそのたびに同じトーストが出る
    // （描画のたびではなく、この往復で踏む）
    it("同じことを何度も言わない", async () => {
        const { rerender } = await editing();
        auth.isAuthenticated = false;
        rerender(<EditPage />);
        await waitFor(() => expect(toasts().length).toBeGreaterThan(0));

        // 元に戻す（打ちかけが無くなる）→ また打つ（打ちかけが戻る）
        fireEvent.change(screen.getByDisplayValue("夕焼けの色"), { target: { value: "夕焼け" } });
        rerender(<EditPage />);
        fireEvent.change(screen.getByDisplayValue("夕焼け"), { target: { value: "夕焼けの空" } });
        rerender(<EditPage />);

        await waitFor(() => expect(screen.getByDisplayValue("夕焼けの空")).toBeInTheDocument());
        expect(toasts().filter((t) => t.includes("ログインが切れました")).length,
            "打ち直すたびに同じことを言っている").toBe(1);
    });

    // **打ちかけが無ければ今までどおり。** 直接開いた未ログインの人まで
    // 居座らせると、会員専用の画面が空のまま出続ける
    it("何も直していなければ、今までどおりログイン画面へ送る", async () => {
        render(<EditPage />);
        await screen.findByDisplayValue("夕焼け");
        auth.isAuthenticated = false;
        render(<EditPage />);

        await waitFor(() => expect(mockReplace).toHaveBeenCalled());
        expect(String(mockReplace.mock.calls[0][0])).toContain("/login");
        expect(toasts().some((t) => t.includes("ログインが切れました")), "送り返すのに知らせている").toBe(false);
    });
});
