import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// **触っていない説明を、毎回送り直していた。**
// `changedFields` は「保存されている姿」と突き合わせるが、
// `mergeLocalizedDescription` は英語が空なら**素の文字列**を返すので、
// `{ja:[...], en:[]}` で保存されている写真は毎回「変わった」と判定される。
// 実データ30枚のうち2枚がこの形。
//
// 効くのは差分送信が守っていたもの——同じ写真を2タブで開き、片方で説明を
// 直したあと、もう片方で**タイトルだけ**直して保存すると、先に書いた説明が
// 消える（こちらの古い説明で上書きされる）。

const mockUserFetch = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/utils/api", async () => {
    const actual = await vi.importActual<typeof import("../../../../lib/utils/api")>("../../../../lib/utils/api");
    return { ...actual, userFetch: mockUserFetch };
});
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
    useSearchParams: () => new URLSearchParams("id=p1"),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const EditPage = (await import("../page")).default;

const base = {
    id: "p1", src: "https://cdn/p1.jpg", title: { ja: "夕焼け", en: "Sunset" },
    location: "江ノ島", category: "landscape", date: "2024-11-01",
    tags: ["旅"], published: true,
};

function mount(description: unknown, title?: unknown) {
    mockUserFetch.mockReset().mockImplementation((url: string) => {
        if (url === "/user/photos") return Promise.resolve({ ok: true, json: async () => [{ ...base, description, ...(title === undefined ? {} : { title }) }] });
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
    });
    render(<EditPage />);
}

/** PUT で送った本文 */
async function savedBody() {
    const save = await screen.findByRole("button", { name: "保存する" });
    fireEvent.click(save);
    await waitFor(() => expect(mockUserFetch.mock.calls.some((c) => c[0] === "/photos/p1")).toBe(true));
    const call = mockUserFetch.mock.calls.find((c) => c[0] === "/photos/p1")!;
    return JSON.parse(String((call[1] as { body: string }).body)) as Record<string, unknown>;
}

describe("/user/edit: 触っていない説明を送らない", () => {
    it("英語の説明が空の写真（実データに2枚ある）でも、触らなければ送らない", async () => {
        mount({ ja: ["海の色が変わる時間"], en: [] });
        await screen.findByDisplayValue("海の色が変わる時間");
        expect(await savedBody(), "触っていない説明を送っている").not.toHaveProperty("description");
    });

    it("英語の説明を持つ写真でも、触らなければ送らない", async () => {
        mount({ ja: ["海の色が変わる時間"], en: ["The hour the sea changes color"] });
        await screen.findByDisplayValue("海の色が変わる時間");
        expect(await savedBody(), "触っていない説明を送っている").not.toHaveProperty("description");
    });

    it("説明そのものが無い写真でも、触らなければ送らない", async () => {
        mount(undefined);
        await screen.findByDisplayValue("夕焼け");
        expect(await savedBody(), "空の説明を送っている").not.toHaveProperty("description");
    });

    // 正常系: 直したときは必ず送る（送らなくなったら、この画面から説明を
    // 直せなくなる＝逆向きの壊れ方）
    it("直したら送る（英語が空の写真）", async () => {
        mount({ ja: ["海の色が変わる時間"], en: [] });
        const el = await screen.findByDisplayValue("海の色が変わる時間");
        fireEvent.change(el, { target: { value: "海の色が変わる" } });
        expect(await savedBody(), "直した説明を送っていない").toHaveProperty("description", "海の色が変わる");
    });

    it("空にしたら送る（消す指定として空文字）", async () => {
        mount({ ja: ["海の色が変わる時間"], en: [] });
        const el = await screen.findByDisplayValue("海の色が変わる時間");
        fireEvent.change(el, { target: { value: "" } });
        expect(await savedBody(), "消す指定を送っていない").toHaveProperty("description", "");
    });
    // タイトルも同じ形で起きる。`mergeLocalizedTitle` は `en` が空文字なら
    // 素の文字列を返すので、`{ja:"…", en:""}` の行は毎回「変わった」になる。
    // **今の30枚にこの形は無い**（英語ありが28・素の文字列が2）が、
    // `/admin/edit` は英語欄を空のまま `{ja, en:""}` を組めるので、
    // 入口としては実在する
    it("英語のタイトルが空文字の行でも、触らなければ送らない", async () => {
        mount({ ja: ["海の色が変わる時間"], en: ["x"] }, { ja: "夕焼け", en: "" });
        await screen.findByDisplayValue("夕焼け");
        expect(await savedBody(), "触っていないタイトルを送っている").not.toHaveProperty("title");
    });

    it("その行でもタイトルを直したら送る", async () => {
        mount({ ja: ["海の色が変わる時間"], en: ["x"] }, { ja: "夕焼け", en: "" });
        const el = await screen.findByDisplayValue("夕焼け");
        fireEvent.change(el, { target: { value: "夕焼けの色" } });
        expect(await savedBody(), "直したタイトルを送っていない").toHaveProperty("title", "夕焼けの色");
    });
});
