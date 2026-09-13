import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * **見えているラベルが、入力欄に結ばれているか。**
 *
 * `<label>` は `htmlFor` で結ぶか、入力を中に包んで初めて効く。結んでいない
 * `<label>` は**読み上げに何も渡さない**——画面には「タイトル」と出ているのに、
 * 読み上げ環境では「編集テキスト」としか言われない。
 *
 * 実測（この差分の前・jsdom で実際に描いて `label.control` で数えた）:
 *
 *     /user/edit      label 7 → **7 すべて孤立**・入力6つとも名前なし
 *                     （「任意」という同じ placeholder の欄が2つ並ぶ）
 *     /user/profile   label 7 → **6 が孤立**・入力9つのうち名前があるのは1つ
 *     /admin/edit     label 13 → **13 すべて孤立**
 *     DeleteAccountModal  label 1 → 孤立（下記）
 *
 * 一方 `/login`・`/signup`・`/admin/login`・`/user/albums`・`FilterBar` は
 * 前から `htmlFor` を持っている（`68e0a6d` の周で直した分）。
 * **同じ規則の入口が半分残っていた**、という台帳のいつもの型。
 *
 * **綴りでは見ない。** `<label>` は包む形でも結ばれるので、`htmlFor=` を
 * grep すると包んでいる側（`/user/upload` の「写真を選択」）を誤って
 * 「孤立」と数える。jsdom の `label.control` は `htmlFor` も入れ子も
 * 正しく解くことを確かめたうえで使っている（結べない `for` は null）。
 */
const mockShowToast = vi.hoisted(() => vi.fn());
const mockUserFetch = vi.hoisted(() => vi.fn());
const mockAuthFetch = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
    useSearchParams: () => new URLSearchParams("id=p1"),
}));
vi.mock("../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: true, isGeneralUser: true, loading: false }),
}));
vi.mock("../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../lib/utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../lib/utils/api")>()),
    userFetch: mockUserFetch,
    authenticatedFetch: mockAuthFetch,
}));
vi.mock("../../lib/utils/image", () => ({
    toUploadSafeFile: async (f: File) => f,
    UnstrippableFileError: class extends Error {},
    AVATAR_MAX_PX: 512, COVER_MAX_PX: 1280,
}));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
// ブロック一覧と退会モーダルはプロフィール画面の境界の外（別ファイルで見る）
vi.mock("../user/profile/BlockedUsers", () => ({ default: () => null }));

const ProfilePage = (await import("../user/profile/page")).default;
const UserEditPage = (await import("../user/edit/page")).default;
const AdminEditPage = (await import("../admin/edit/page")).default;
const DeleteAccountModal = (await import("../components/DeleteAccountModal")).default;

const PHOTO = {
    id: "p1", src: "https://cdn/p1.jpg", title: "夕焼け", description: "",
    location: "", category: "", date: "", tags: [], published: true, exif: {},
};

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [PHOTO] });
    mockAuthFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [PHOTO] });
    mockShowToast.mockReset();
});

/** 結ばれていないラベルの文言（空なら健全） */
function orphanLabels(container: HTMLElement): string[] {
    return [...container.querySelectorAll("label")]
        .filter((l) => !(l as HTMLLabelElement).control)
        .map((l) => l.textContent?.trim() || "(文字なし)");
}

/** 名前（ラベル・aria-label・aria-labelledby）を持たない入力欄 */
function unnamedFields(container: HTMLElement): string[] {
    const labels = [...container.querySelectorAll("label")] as HTMLLabelElement[];
    return [...container.querySelectorAll<HTMLInputElement>("input,textarea,select")]
        // 見えないファイル入力はボタンから開く形（ボタン側に名前がある）
        .filter((el) => el.type !== "file")
        .filter((el) => !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby")
            && !labels.some((l) => l.control === el)
            // placeholder は名前の最後の受け皿（打ち始めると消えるので弱いが、無名ではない）
            && !el.getAttribute("placeholder"))
        .map((el) => `${el.tagName}[${el.type}]`);
}

describe("見えているラベルは入力欄に結ばれている", () => {
    it("/user/profile", async () => {
        const { container } = render(<ProfilePage />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        expect(orphanLabels(container)).toEqual([]);
        expect(unnamedFields(container)).toEqual([]);
    });

    it("/user/edit", async () => {
        const { container } = render(<UserEditPage />);
        await screen.findByDisplayValue("夕焼け");
        expect(orphanLabels(container)).toEqual([]);
        expect(unnamedFields(container)).toEqual([]);
    });

    it("/admin/edit", async () => {
        const { container } = render(<AdminEditPage />);
        await screen.findByDisplayValue("夕焼け");
        expect(orphanLabels(container)).toEqual([]);
        expect(unnamedFields(container)).toEqual([]);
    });

    // **取り消せない操作の唯一の関門。** 「`退会` と入力してください」が
    // 入力欄の名前になっていないと、読み上げでは何を打てばいいか分からない
    it("退会の確認欄は、指示そのものが名前になる", () => {
        const opener = React.createRef<HTMLButtonElement>();
        const { container } = render(
            <DeleteAccountModal isOpen openerRef={opener} onClose={() => {}} onConfirm={() => {}}
                deleting={false} locale="ja" />);
        expect(orphanLabels(container)).toEqual([]);
        const input = container.querySelector("input[type=text]") as HTMLInputElement;
        const label = [...container.querySelectorAll("label")]
            .find((l) => (l as HTMLLabelElement).control === input);
        expect(label?.textContent).toContain("退会");
        // 別の `aria-label` を被せると、見えている指示は読み上げられない
        expect(input.getAttribute("aria-label")).toBeNull();
    });
});

// **この検出器自身が効くことを確かめる。** 結べない `for` と、結んでいない
// `<label>` を「孤立」と数え、包んでいる形は数えないこと
describe("検出器の自己確認", () => {
    it("孤立だけを拾う", () => {
        const host = document.createElement("div");
        host.innerHTML = `
          <label for="x">結んである</label><input id="x">
          <label>包んである<input id="y"></label>
          <label>結んでいない</label><input id="z" placeholder="p">
          <label for="nope">存在しない id</label>`;
        expect(orphanLabels(host)).toEqual(["結んでいない", "存在しない id"]);
    });

    it("名前の無い入力だけを拾う", () => {
        const host = document.createElement("div");
        host.innerHTML = `
          <label for="a">あり</label><input id="a">
          <input id="b" aria-label="あり">
          <input id="c" placeholder="あり">
          <input id="d" type="file">
          <input id="e">
          <textarea id="f"></textarea>`;
        expect(unnamedFields(host)).toEqual(["INPUT[text]", "TEXTAREA[textarea]"]);
    });
});
