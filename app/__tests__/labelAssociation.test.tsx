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
 * **`/user/settings` は 2026-09-21 に足した。** プロフィール編集から
 * 移した入力欄4つ（新しいメールアドレス・確認コード・いまのパスワード・
 * 新しいパスワード）が、**移設した時点でこの見張りの外に出ていた**
 * ——ここは画面ごとに `it` を書く形なので、画面が増えても自動では入らない。
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
// ブロック一覧は設定画面の境界の外（`BlockedUsers.test.tsx` で見る）。
// **2026-09-21 に `user/profile/` から `user/settings/` へ移した。**
// 古いパスのままでも vitest は黙って素通りするので、移設に気づけない
vi.mock("../user/settings/BlockedUsers", () => ({ default: () => null }));

// **モジュールの読み込み時に読まれる**（`CLOUDFRONT_URL` は module スコープ）ので
// import より前に置く。これが無いとカバー写真は「未設定」の枝しか描けない
process.env.NEXT_PUBLIC_CLOUDFRONT_URL = "https://cdn.example";

const ProfilePage = (await import("../user/profile/page")).default;
const SettingsPage = (await import("../user/settings/page")).default;
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

/**
 * `aria-labelledby` / `aria-describedby` が**実在する id** を指しているか。
 *
 * `<label>` をやめて `role="group" aria-labelledby` にした2か所は、
 * `<p>` のままで紐付けだけ消しても「孤立したラベル 0」のままなので、
 * **この差分の肝の半分が無防備**だった（レビューが変異で実証）。
 */
function danglingRefs(container: HTMLElement): string[] {
    const bad: string[] = [];
    for (const attr of ["aria-labelledby", "aria-describedby"]) {
        for (const el of container.querySelectorAll(`[${attr}]`)) {
            for (const id of (el.getAttribute(attr) ?? "").split(/[ \t\n]+/).filter(Boolean)) {
                if (!container.querySelector(`#${CSS.escape(id)}`)) bad.push(`${attr}="${id}"`);
            }
        }
    }
    return bad;
}

/** 見出しで名前を付けた集まり（`role="group"`）の数 */
function labelledGroups(container: HTMLElement): number {
    return container.querySelectorAll('[role="group"][aria-labelledby]').length;
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
        expect(danglingRefs(container)).toEqual([]);
        // テーマカラー（見本ボタンの集まり）
        expect(labelledGroups(container)).toBe(1);
        // **カバー写真の欄は 2026-09-22 に外した**（マイページが出さなくなったので）。
        // 名前を失うボタンはもう無い＝`unnamedFields` と下の `nameless` が見る
        expect(container.querySelector('img[src*="/cover"]'), "カバーの欄が戻っている").toBeNull();
    });

    // 移設で外に出ていた4つの入力欄（メール2段・パスワード2つ）
    it("/user/settings", async () => {
        const { container } = render(<SettingsPage />);
        await screen.findByRole("heading", { name: "設定" });
        expect(orphanLabels(container)).toEqual([]);
        expect(unnamedFields(container)).toEqual([]);
        expect(danglingRefs(container)).toEqual([]);
    });

    it("/user/edit", async () => {
        const { container } = render(<UserEditPage />);
        await screen.findByDisplayValue("夕焼け");
        expect(orphanLabels(container)).toEqual([]);
        expect(unnamedFields(container)).toEqual([]);
        expect(danglingRefs(container)).toEqual([]);
        // 地図に出す位置（ボタンと状態表示の集まり）
        expect(labelledGroups(container)).toBe(1);
    });

    it("/admin/edit", async () => {
        const { container } = render(<AdminEditPage />);
        await screen.findByDisplayValue("夕焼け");
        expect(orphanLabels(container)).toEqual([]);
        expect(unnamedFields(container)).toEqual([]);
    });

    // **曲のリンクを開いた状態でないと描かれない欄がある。**
    // 初期状態だけを見ていたので「開始 (m:ss)」「終了 (m:ss)」の2本は
    // 直したのに守りが1行も掛かっていなかった（レビューが変異で実証）。
    it("/user/profile: 曲のリンクを開いた状態", async () => {
        mockUserFetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                userId: "u1", username: "", displayName: "",
                songUrl: "https://www.youtube.com/watch?v=abcdefghijk",
                songStart: 72, songEnd: 95,
            }),
        });
        const { container } = render(<ProfilePage />);
        await screen.findByDisplayValue("https://www.youtube.com/watch?v=abcdefghijk");
        expect(orphanLabels(container)).toEqual([]);
        expect(unnamedFields(container)).toEqual([]);
        expect(danglingRefs(container)).toEqual([]);

        // 名前を持たないボタンが無いこと（アバターのボタンは `aria-label` を持つ）
        const nameless = [...container.querySelectorAll("button")]
            .filter((b) => !b.getAttribute("aria-label") && !b.getAttribute("aria-labelledby")
                && !b.textContent?.trim())
            .map((b) => b.className.slice(0, 40));
        expect(nameless).toEqual([]);

    });

    // **制約を書いた文が、欄に結ばれていなかった。**
    // 「英小文字・数字・_ の3〜20文字」はこの1文にしか書いていないので、
    // 結ばないと読み上げには届かず、**打っても入らない理由が分からない**
    it("/user/profile: ユーザー名の条件が欄に結ばれている", async () => {
        const { container } = render(<ProfilePage />);
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());
        const input = container.querySelector("#profile-username") as HTMLInputElement;
        const id = input.getAttribute("aria-describedby");
        expect(id, "条件の文が欄に結ばれていない").toBeTruthy();
        expect(container.querySelector(`#${CSS.escape(id!)}`)?.textContent)
            .toContain("3〜20文字");
        expect(danglingRefs(container)).toEqual([]);
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

    // **検出器を殺す変異は、判定自身では捕まえられない。**
    // いま参照切れが0件なので、壊れた検出器と正しい検出器が同じ答えを返す
    // （台帳の `68134035` と同じ立場）。差し込んで効くことを見る
    it("参照切れだけを拾う", () => {
        const host = document.createElement("div");
        host.innerHTML = `
          <p id="ok">見出し</p>
          <div role="group" aria-labelledby="ok"></div>
          <div role="group" aria-labelledby="nope"></div>
          <input aria-describedby="ok missing">`;
        expect(danglingRefs(host).sort()).toEqual(
            ['aria-describedby="missing"', 'aria-labelledby="nope"']);
        expect(labelledGroups(host)).toBe(2);
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
