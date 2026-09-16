import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **入力候補（前に使った撮影地・カテゴリ）を見るテストが1本も無かった。**
// `setOwnValues(collectOwnValues(all))` を丸ごと消しても
// `app/user/upload` の8ファイル43件が全緑だった（実測）。
// 隣の編集画面（`app/user/edit`）には同じ形のテストがある。
// 候補が出ないと、同じ場所が別々の名前に散る（「パリ」「パリ, フランス」…）。

const mockUserFetch = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({
    current: { isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false },
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
// **言語を切り替えられる形にする。** 固定だと「言語も見る」と書いた
// `aria-label` の英語側を誰も通らない（日本語固定に戻す変異が素通りした）
const uiLocale = vi.hoisted(() => ({ value: "ja" as "ja" | "en" }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: uiLocale.value }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../components/AddToHomeScreenHint", () => ({ default: () => null }));
// **`lookupSession` も模す。** `userFetch` はこちらでトークンを引く
// （`getCurrentSession` だけ差し替えても入口を支配できない）。
// 同じ答えを包んだ形にして、このファイルが守っている性質は変えない
vi.mock("../../../../lib/auth/cognito", () => {
    const getCurrentSession = vi.fn(async () => null);
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
vi.mock("../../../../lib/utils/shareStore", () => ({
    // 受け皿は開けたが中身が無い（＝共有経由ではない通常の表示）
    readSharedResult: vi.fn(async () => ({ ok: true, payload: null })),
    clearSharedPayload: vi.fn(async () => undefined),
}));
vi.mock("../../../../lib/utils/exif", () => ({
    extractExifFromFile: vi.fn(async () => ({})),
    extractCameraExif: vi.fn(async () => ({})),
    reverseGeocode: vi.fn(async () => null),
}));
vi.mock("../../../../lib/utils/image", () => ({
    createThumbnail: vi.fn(async () => null),
    toUploadSafeFile: vi.fn(async (f: File) => f),
    UnstrippableFileError: class extends Error { },
    extractDominantColor: vi.fn(async () => null),
    createBlurPlaceholder: vi.fn(async () => null),
    AVATAR_MAX_PX: 512,
}));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: mockUserFetch,
    readApiError: async (_r: Response, f: string) => f,
}));

import { CATEGORY_CHOICES } from "../../../../lib/utils/categoryChoices";

const UploadPage = (await import("../page")).default;

const PHOTOS = [
    { id: "p1", src: "s", userId: "me", location: "パリ", category: "風景", tags: ["夜景", "街"] },
];

beforeEach(() => {
    authState.current = { isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false };
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => PHOTOS });
});

/** 共通設定（＝カテゴリのチップ）は写真を選んでから出る */
async function pickOne() {
    const { container } = render(<UploadPage />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "a.jpg", { type: "image/jpeg" }));
    await screen.findByText(/共通設定/);
}

const chip = (c: string) => screen.getByRole("switch", { name: `カテゴリ: ${c}` });
const field = () => screen.getByPlaceholderText("カテゴリ（一覧に無い語はここに）") as HTMLInputElement;

/**
 * **アップロード画面の配線**（owner の「風景、建築、人物、動物など
 * 狭めた選択肢にしたい」）。
 *
 * `/user/edit` に対になるテストがある。台帳の型「同じ配線を2画面に
 * 入れたのに、見たのは片方だけ」を避けるため、**両方に置く**。
 */
describe("アップロード画面: カテゴリを選ぶ", () => {
    it("決まった選択肢が全部チップとして出る", async () => {
        await pickOne();
        for (const c of CATEGORY_CHOICES) expect(chip(c), c).toBeInTheDocument();
    });

    it("押すと入力欄にその語が入る", async () => {
        await pickOne();
        await userEvent.click(chip("食べ物"));
        expect(field().value, "押しても欄に入っていない").toBe("食べ物");
        expect(chip("食べ物")).toHaveAttribute("aria-checked", "true");
    });

    it("別のチップを押すと置き換わる（カテゴリは1つ）", async () => {
        await pickOne();
        await userEvent.click(chip("食べ物"));
        await userEvent.click(chip("人物"));
        expect(field().value).toBe("人物");
        expect(chip("食べ物")).toHaveAttribute("aria-checked", "false");
    });

    it("押し直すと外れる", async () => {
        await pickOne();
        await userEvent.click(chip("人物"));
        await userEvent.click(chip("人物"));
        expect(field().value).toBe("");
    });

    // **自由入力は残す**（owner の判断）
    it("一覧に無い語は打てる（チップは1つも光らない）", async () => {
        await pickOne();
        await userEvent.type(field(), "夜景");
        for (const c of CATEGORY_CHOICES) expect(chip(c), c).toHaveAttribute("aria-checked", "false");
    });

    it("打った語が選択肢と同じなら光る", async () => {
        await pickOne();
        await userEvent.type(field(), "建築");
        expect(chip("建築")).toHaveAttribute("aria-checked", "true");
    });

    /**
     * **タグのチップと名前が衝突しない。** この画面は同じ箱の中に
     * カテゴリとタグのチップが並ぶ。実データには「街」のように
     * 両方に出る語があり、読み上げ・音声操作では**同じ名前の switch が
     * 2つ**並ぶ（`749bfce2` で潰した型）
     */
    it("タグのチップと名前が重ならない", async () => {
        await pickOne();
        await screen.findByRole("switch", { name: "街" });   // タグ側（前提）
        const names = screen.getAllByRole("switch").map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
        const dup = names.filter((n, i) => names.indexOf(n) !== i);
        expect(dup, `同じ名前のスイッチ: ${dup.join(", ")}`).toEqual([]);
    });
});
