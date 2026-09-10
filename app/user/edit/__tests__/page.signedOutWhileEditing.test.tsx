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
const auth = vi.hoisted(() => ({ isAuthenticated: true, noGroup: false }));

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
        isGeneralUser: auth.isAuthenticated && !auth.noGroup,
        loading: false,
    }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const EditPage = (await import("../page")).default;

const photo = { id: "p1", src: "https://cdn/p1.jpg", title: "夕焼け", location: "江ノ島", published: true };

beforeEach(() => {
    auth.isAuthenticated = true; auth.noGroup = false;
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
/** 種類まで見る（`種類:文言`）。文言だけ見ていると、成功として出しても気づけない */
const typed = () => mockShowToast.mock.calls.map((c) => `${String(c[1] ?? "success")}:${String(c[0])}`);

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

// **案内どおりに動いた人の文章を消していた。**
// 写真の取得 effect は `isAuthenticated` に依存しているので、別のタブで
// ログインし直した瞬間にも走り、欄をサーバーの値で塗り潰す。
// 「ログインし直してから保存してください」と案内しておきながら、
// そのとおりにすると打ちかけが消える——送り返さないようにした意味が無い。
describe("留めたあと、ログインし直したとき", () => {
    it("打ちかけを塗り潰さない", async () => {
        const { rerender } = await editing();
        auth.isAuthenticated = false;
        rerender(<EditPage />);
        await waitFor(() => expect(toasts().length).toBeGreaterThan(0));

        // 別のタブでログインし直した（storage イベントで isAuthenticated が戻る）
        auth.isAuthenticated = true;
        rerender(<EditPage />);
        await waitFor(() => expect(mockUserFetch.mock.calls.filter((c) => c[0] === "/user/photos").length).toBe(2));

        expect(screen.getByDisplayValue("夕焼けの色"), "ログインし直したら打ちかけが消えた").toBeInTheDocument();
    });

    it("そのまま保存できる（打ちかけがサーバーへ届く）", async () => {
        const { rerender } = await editing();
        auth.isAuthenticated = false;
        rerender(<EditPage />);
        await waitFor(() => expect(toasts().length).toBeGreaterThan(0));
        auth.isAuthenticated = true;
        rerender(<EditPage />);
        await waitFor(() => expect(mockUserFetch.mock.calls.filter((c) => c[0] === "/user/photos").length).toBe(2));

        fireEvent.click(screen.getByRole("button", { name: "保存する" }));
        await waitFor(() => expect(mockUserFetch.mock.calls.some((c) => c[0] === "/photos/p1")).toBe(true));
        const put = mockUserFetch.mock.calls.find((c) => c[0] === "/photos/p1")!;
        expect(JSON.parse(String((put[1] as { body: string }).body))).toHaveProperty("title", "夕焼けの色");
    });

    // 逆向き: **何も直していなければ、取り直した値をそのまま入れる**
    // （別のタブで直した内容を見せない方が困る）
    it("打ちかけが無ければ、取り直した値で欄を作り直す", async () => {
        render(<EditPage />);
        await screen.findByDisplayValue("夕焼け");

        mockUserFetch.mockResolvedValue({ ok: true, json: async () => [{ ...photo, title: "別のタブで直した題" }] });
        auth.isAuthenticated = false;
        render(<EditPage />);
        auth.isAuthenticated = true;
        render(<EditPage />);

        await waitFor(() => expect(screen.getAllByDisplayValue("別のタブで直した題").length).toBeGreaterThan(0));
    });
});

describe("留めている間に押せるもの", () => {
    it("削除も「通信に失敗しました」に塗り潰さない", async () => {
        const { AUTH_REQUIRED_MESSAGE } = await import("../../../../lib/utils/api");
        const { rerender } = await editing();
        auth.isAuthenticated = false;
        rerender(<EditPage />);
        await waitFor(() => expect(toasts().length).toBeGreaterThan(0));

        mockUserFetch.mockRejectedValue(new Error(AUTH_REQUIRED_MESSAGE));
        // 画面下の「削除」→ 確認シートの中の「削除」（同じ名前なので
        // ダイアログの中から取る）
        fireEvent.click(screen.getByRole("button", { name: "削除" }));
        const sheet = await screen.findByRole("dialog");
        const confirm = Array.from(sheet.querySelectorAll("button"))
            .find((b) => b.textContent?.trim() === "削除")!;
        fireEvent.click(confirm);
        await waitFor(() => expect(toasts()).toContain(AUTH_REQUIRED_MESSAGE));
        expect(toasts(), "削除だけ塗り潰している").not.toContain("通信に失敗しました");
    });

    it("知らせは赤（成功として出さない）", async () => {
        const { rerender } = await editing();
        auth.isAuthenticated = false;
        rerender(<EditPage />);
        await waitFor(() => expect(toasts().length).toBeGreaterThan(0));
        expect(typed().some((t) => t.startsWith("error:") && t.includes("ログインが切れました"))).toBe(true);
    });

    // **ログインはしているが権限が無い人**に「ログインが切れました」と言わない
    // （ログインしているのに切れたと言う型は、この campaign で3回出ている）
    it("権限が無いだけの人には、ログインの話をしない", async () => {
        const { rerender } = await editing();
        auth.noGroup = true;
        rerender(<EditPage />);
        await waitFor(() => expect(screen.queryByDisplayValue("夕焼けの色")).toBeNull());
        expect(toasts().some((t) => t.includes("ログインが切れました")), "権限の話とログインの話を混ぜている").toBe(false);
    });

    it("ログインし直してまた切れたら、もう一度知らせる", async () => {
        const { rerender } = await editing();
        auth.isAuthenticated = false;
        rerender(<EditPage />);
        await waitFor(() => expect(toasts().length).toBeGreaterThan(0));

        auth.isAuthenticated = true;
        rerender(<EditPage />);
        await waitFor(() => expect(mockUserFetch.mock.calls.filter((c) => c[0] === "/user/photos").length).toBe(2));
        auth.isAuthenticated = false;
        rerender(<EditPage />);

        await waitFor(() => expect(toasts().filter((t) => t.includes("ログインが切れました")).length).toBe(2));
    });
});
