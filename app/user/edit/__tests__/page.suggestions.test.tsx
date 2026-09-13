import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// 撮影地・タグの入力に候補が出ず、同じ場所が別々の名前に散っていた
// （実データ:「パリ」「パリ, フランス」「オペラ・ガルニエ（パリ）」
// 「フランス ヴェルサイユ」）。自分が前に使った値を候補に出す。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());

// **router を毎回新しいオブジェクトで返す。**
// 取得の effect が router / showToast の同一性に依存していると、
// 再描画のたびに再取得して回り続ける（候補を state に入れた時点で
// 「毎回新しいオブジェクト」になるので必ず露見する）。
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams("id=p1"),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    readApiError: async (_r: Response, f: string) => f,
}));

const EditPage = (await import("../page")).default;

const PHOTOS = [
    { id: "p1", src: "s", userId: "me", title: "湖", location: "パリ", category: "風景", tags: ["夜景"] },
    { id: "p2", src: "s", userId: "me", location: "パリ", tags: ["夜景", "街"] },
    { id: "p3", src: "s", userId: "me", location: "京都", category: "街", published: false },
];

const listCalls = () => mockUserFetch.mock.calls.filter((c) => c[0] === "/user/photos");

beforeEach(() => {
    mockUserFetch.mockReset().mockImplementation((url: string, init?: { method?: string }) => {
        if (!init?.method) return Promise.resolve({ ok: true, json: async () => PHOTOS });
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
    });
    mockPush.mockReset();
});

const optionValues = (id: string) =>
    Array.from(document.querySelectorAll(`#${id} option`)).map((o) => (o as HTMLOptionElement).value);

describe("入力候補", () => {
    it("前に使った撮影地を、よく使う順に候補へ出す", async () => {
        render(<EditPage />);
        await screen.findByDisplayValue("湖");
        await waitFor(() => expect(optionValues("own-locations").length).toBeGreaterThan(0));
        expect(optionValues("own-locations")).toEqual(["パリ", "京都"]);
    });

    it("下書きの値も候補に入る（公開状態は関係ない）", async () => {
        render(<EditPage />);
        await screen.findByDisplayValue("湖");
        await waitFor(() => expect(optionValues("own-categories").length).toBeGreaterThan(0));
        // 京都の写真（下書き）のカテゴリ「街」も出る
        expect(optionValues("own-categories")).toContain("街");
    });

    it("タグは押して足せる（カンマ区切りを壊さない）", async () => {
        render(<EditPage />);
        const tags = await screen.findByDisplayValue("夜景");
        await userEvent.click(await screen.findByRole("switch", { name: "街" }));
        await waitFor(() => expect((tags as HTMLInputElement).value).toBe("夜景, 街"));
    });

    // **既に付いているタグは、選択済みとして出す。**
    // もとは足すだけだったので、この写真に付いている「夜景」のチップは
    // 押しても何も起きず、見た目も未選択と同じだった
    it("この写真に付いているタグは選択済みで、押し直すと外れる", async () => {
        render(<EditPage />);
        const tags = (await screen.findByDisplayValue("夜景")) as HTMLInputElement;
        const chip = await screen.findByRole("switch", { name: "夜景" });
        expect(chip, "付いているのに未選択に見える").toHaveAttribute("aria-checked", "true");
        await userEvent.click(chip);
        await waitFor(() => expect(tags.value, "押し直しても外れない").toBe(""));
        expect(chip).toHaveAttribute("aria-checked", "false");
    });

    // **候補を state に入れると「毎回新しいオブジェクト」になる。**
    // 取得の effect が router / showToast の同一性に依存していると、
    // 再描画 → deps が変わる → 再取得 → … で回り続ける（実際に踏んだ）。
    it("候補を入れても取得は1回きり（再描画で回り続けない）", async () => {
        render(<EditPage />);
        await screen.findByDisplayValue("湖");
        await new Promise((r) => setTimeout(r, 60));
        expect(listCalls()).toHaveLength(1);
    });
});
