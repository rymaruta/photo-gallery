import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// 利用者の編集画面（`app/user/edit`）と同じ穴。`w-full max-h-64 object-contain`
// は高さを予約しないので、写真が 403/404 になると **高さが 0 に潰れて**
// 「どの写真を触っているか」が画面から消える（Chromium 実測）。

const mockAuthFetch = vi.hoisted(() => vi.fn());
const stableRouter = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };

const q = vi.hoisted(() => ({ id: "A" }));
vi.mock("next/navigation", () => ({
    useRouter: () => stableRouter,
    useSearchParams: () => ({ get: (k: string) => (k === "id" ? q.id : null) }),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
// **`showToast` は同一性を保つ。** 毎回新しい関数を返すと、取得の effect の
// deps が毎描画で変わって再取得が走る（本番の `useToast` は useCallback で
// 安定しているので、これはハーネス側の作り物）
const mockShowToast = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", () => ({ authenticatedFetch: mockAuthFetch }));

const EditPage = (await import("../page")).default;

const PHOTO = {
    id: "A", src: "https://cdn/gone.jpg",
    title: { ja: "海の朝" }, location: "北海道", category: "風景",
    tags: ["朝"], published: true, exif: {},
};
const PHOTO_B = { ...PHOTO, id: "B", src: "https://cdn/ok.jpg", title: { ja: "山の夕" } };

beforeEach(() => {
    q.id = "A";
    mockAuthFetch.mockReset().mockImplementation((_url: string, init?: { method?: string }) =>
        Promise.resolve(init?.method === "PUT"
            ? { ok: true, json: async () => ({ success: true }) }
            : { ok: true, json: async () => [PHOTO, PHOTO_B] }));
});

const photoImg = () =>
    Array.from(document.body.querySelectorAll("img")).find((el) => el.getAttribute("src")?.includes("gone.jpg"));

/**
 * 写真の読み込み失敗を起こす。
 *
 * **取得の effect は複数回走りうる**（`?id=` の再取得・再描画）ので、
 * 先に掴んだ `img` が差し替わっていると `fireEvent.error` がどこにも届かず、
 * フルスイートの負荷でだけ落ちる（実際に踏んだ）。**そのつど引き直して**
 * 文言が出るまで撃つ。
 */
async function failPhoto() {
    await waitFor(() => {
        const img = photoImg();
        if (img) fireEvent.error(img);
        expect(screen.queryByText("画像を読み込めません"), "失敗表示が出ていない").not.toBeNull();
    });
}

describe("管理の編集画面の写真が取れないとき", () => {
    it("枠ごと消さずに理由を出す", async () => {
        render(<EditPage />);
        await screen.findByDisplayValue("海の朝");

        expect(photoImg(), "編集中の写真が出ていない").toBeDefined();
        await failPhoto();

        expect(photoImg(), "取れなかった img をそのまま残している").toBeUndefined();
        expect(screen.getByDisplayValue("海の朝")).toBeInTheDocument();
    });

    // 高さを予約していること自体を見る（`h-40` を消しても緑だった）
    it("置き換えの枠は高さを予約している", async () => {
        render(<EditPage />);
        await screen.findByDisplayValue("海の朝");
        await failPhoto();

        const box = screen.getByText("画像を読み込めません").closest("div");
        expect(box?.className, "高さを予約していない（また潰れる）").toMatch(/\bh-40\b/);
    });

    // 前の写真の失敗を持ち越さない（クエリだけ変わる遷移では作り直されない）
    it("別の写真に切り替えたら失敗表示は消える", async () => {
        const { rerender } = render(<EditPage />);
        await screen.findByDisplayValue("海の朝");
        await failPhoto();

        q.id = "B";
        rerender(<EditPage />);
        await screen.findByDisplayValue("山の夕");

        await waitFor(() => expect(screen.queryByText("画像を読み込めません"),
            "前の写真の失敗が残っている").toBeNull());
        expect(Array.from(document.body.querySelectorAll("img"))
            .some((el) => el.getAttribute("src")?.includes("ok.jpg")), "次の写真が出ていない").toBe(true);
    });

    it("読み込める写真では出さない", async () => {
        render(<EditPage />);
        await screen.findByDisplayValue("海の朝");
        expect(screen.queryByText("画像を読み込めません")).toBeNull();
        expect(photoImg()).toBeDefined();
    });
});
