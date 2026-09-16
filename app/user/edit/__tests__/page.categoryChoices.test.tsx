import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CATEGORY_CHOICES } from "../../../../lib/utils/categoryChoices";

/**
 * **編集画面の配線**（owner の「風景、建築、人物、動物など狭めた選択肢にしたい」）。
 *
 * 単体（`lib/utils/__tests__/categoryChoices.test.ts`）とは別に、
 * **画面から押して、保存に何が乗るか**まで見る。台帳の型
 * 「同じ配線を2画面に入れたのに、見たのは片方だけ」を避けるため、
 * `/user/upload` にも対になるテストを置いてある。
 */

const mockUserFetch = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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

const photos = (category: string) => [
    { id: "p1", src: "s", userId: "me", title: "湖", category },
];

const chip = (c: string) => screen.getByRole("switch", { name: `カテゴリ: ${c}` });
const field = () => screen.getByLabelText("カテゴリ") as HTMLInputElement;

const open = async (category: string) => {
    mockUserFetch.mockReset().mockImplementation((_url: string, init?: { method?: string }) => {
        if (!init?.method) return Promise.resolve({ ok: true, json: async () => photos(category) });
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
    });
    render(<EditPage />);
    await screen.findByDisplayValue("湖");
};

const savedCategory = async () => {
    await userEvent.click(screen.getByRole("button", { name: /保存/ }));
    const put = await waitFor(() => {
        const c = mockUserFetch.mock.calls.filter((x) => x[1]?.method === "PUT").at(-1);
        expect(c, "PUT が飛んでいない").toBeTruthy();
        return c!;
    });
    return JSON.parse(put[1].body as string).category;
};

beforeEach(() => { mockUserFetch.mockReset(); });

describe("編集画面: カテゴリを選ぶ", () => {
    it("決まった選択肢が全部チップとして出る", async () => {
        await open("");
        for (const c of CATEGORY_CHOICES) expect(chip(c)).toBeInTheDocument();
    });

    it("押すと入力欄にその語が入り、保存に乗る", async () => {
        await open("");
        await userEvent.click(chip("動物"));
        expect(field().value).toBe("動物");
        expect(await savedCategory()).toBe("動物");
    });

    it("別のチップを押すと置き換わる（カテゴリは1つ）", async () => {
        await open("");
        await userEvent.click(chip("動物"));
        await userEvent.click(chip("建築"));
        expect(field().value).toBe("建築");
    });

    it("押し直すと外れる", async () => {
        await open("");
        await userEvent.click(chip("動物"));
        await userEvent.click(chip("動物"));
        expect(field().value).toBe("");
    });

    /**
     * 🔴 **開いたときに、いまのカテゴリのチップが光っていること。**
     * 実データの多数派は英語で保存されている（`landscape` 12枚）ので、
     * 綴りで比べると光らない
     */
    it("英語で保存された写真でも、いまのカテゴリが光る", async () => {
        await open("landscape");
        expect(chip("風景"), "英語で保存された写真のチップが光らない").toHaveAttribute("aria-checked", "true");
        expect(chip("建築")).toHaveAttribute("aria-checked", "false");
    });

    // **自由入力は残す**（owner の判断）。一覧に無い語は今までどおり打てる
    it("一覧に無い語は打てる（チップは1つも光らない）", async () => {
        await open("");
        await userEvent.type(field(), "夜景");
        for (const c of CATEGORY_CHOICES) expect(chip(c), c).toHaveAttribute("aria-checked", "false");
        expect(await savedCategory()).toBe("夜景");
    });

    // 打った語に合うチップは光る（打ってから選び直せる）
    it("打った語が選択肢と同じなら光る", async () => {
        await open("");
        await userEvent.type(field(), "建築");
        expect(chip("建築")).toHaveAttribute("aria-checked", "true");
    });

    /**
     * **タグのチップと名前が衝突しない。** どちらも `role="switch"` で、
     * 実データには「街」のようにカテゴリともタグとも重なる語がある
     * ——読み上げ・音声操作で同じ名前の switch が2つ並ぶ（`749bfce2` の型）
     */
    it("タグのチップと名前が重ならない", async () => {
        await open("");
        const names = screen.getAllByRole("switch").map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
        const dup = names.filter((n, i) => names.indexOf(n) !== i);
        expect(dup, `同じ名前のスイッチ: ${dup.join(", ")}`).toEqual([]);
    });
});
