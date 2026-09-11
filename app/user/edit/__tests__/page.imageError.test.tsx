import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// **写真が取れないと、編集画面から写真の枠ごと消えていた。**
// `w-full max-h-64 object-contain` は高さを予約しないので、403/404 になると
// **高さが 0 に潰れる**（Chromium 実測: 成功 358x256 → 失敗 358x0）。
// 削除済みの写真の URL が静的HTMLに残っている間（再ビルドまで最大7日）や、
// 原本が消えている古い行で起きる。「どの写真を触っているか」が消える。

const mockUserFetch = vi.hoisted(() => vi.fn());

const q = vi.hoisted(() => ({ id: "p1" }));
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(`id=${q.id}`),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
// **`showToast` は同一性を保つ。** 毎回新しい関数を返すと、取得の effect の
// deps が毎描画で変わって再取得が走る（本番の `useToast` は useCallback で
// 安定しているので、これはハーネス側の作り物）
const mockShowToast = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    readApiError: async (_r: Response, f: string) => f,
}));

const EditPage = (await import("../page")).default;

const PHOTOS = [
    { id: "p1", src: "https://cdn/gone.jpg", userId: "me", title: "湖", location: "パリ" },
    { id: "p2", src: "https://cdn/ok.jpg", userId: "me", title: "海", location: "京都" },
];

beforeEach(() => {
    q.id = "p1";
    mockUserFetch.mockReset().mockImplementation((_url: string, init?: { method?: string }) =>
        Promise.resolve(init?.method
            ? { ok: true, json: async () => ({ success: true }) }
            : { ok: true, json: async () => PHOTOS }));
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

describe("編集画面の写真が取れないとき", () => {
    // 控えも捨てる（写真の控えはキャッシュ優先で寿命が無いので、写真でない
    // ものを一度控えると再読込では直らない）。`lib/utils/photoCache.ts`
    it("読み込めなかった写真の控えを捨てる", async () => {
        const deleted: string[] = [];
        const opened: string[] = [];
        vi.stubGlobal("caches", {
            open: async (name: string) => {
                opened.push(name);
                return { delete: async (u: string) => { deleted.push(u); return true; } };
            },
        });
        try {
            render(<EditPage />);
            await screen.findByDisplayValue("湖");
            await failPhoto();
            await Promise.resolve();
            expect(opened, "違う入れ物を開いている").toEqual(["journey-photo-img-v1"]);
            expect(deleted.some((u) => u.includes("gone.jpg")), "控えを捨てていない").toBe(true);
        } finally { vi.unstubAllGlobals(); }
    });

    it("枠ごと消さずに理由を出す", async () => {
        render(<EditPage />);
        await screen.findByDisplayValue("湖");

        expect(photoImg(), "編集中の写真が出ていない").toBeDefined();
        await failPhoto();

        // 潰れた img を残さない（高さ0の帯が残ると、何も無いのと同じ）
        expect(photoImg(), "取れなかった img をそのまま残している").toBeUndefined();
        // 編集そのものは続けられる
        expect(screen.getByDisplayValue("湖")).toBeInTheDocument();
    });

    // **枠の高さを予約していること自体を見る。** 文言の有無しか見ていないと、
    // `h-40` を消して（＝また潰れる形に戻して）も緑のままだった（レビュー実測）
    it("置き換えの枠は高さを予約している", async () => {
        render(<EditPage />);
        await screen.findByDisplayValue("湖");
        await failPhoto();

        const box = screen.getByText("画像を読み込めません").closest("div");
        expect(box?.className, "高さを予約していない（また潰れる）").toMatch(/\bh-40\b/);
    });

    // **前の写真の失敗を持ち越さない。** この画面はクエリだけが変わる遷移で
    // 作り直されないので、下ろさないと**正常な次の写真が「読み込めません」に
    // 固定**される（`StoryViewer` では同じ型を先に潰してある）
    it("別の写真に切り替えたら失敗表示は消える", async () => {
        const { rerender } = render(<EditPage />);
        await screen.findByDisplayValue("湖");
        await failPhoto();

        q.id = "p2";
        rerender(<EditPage />);
        await screen.findByDisplayValue("海");

        await waitFor(() => expect(screen.queryByText("画像を読み込めません"),
            "前の写真の失敗が残っている").toBeNull());
        expect(Array.from(document.body.querySelectorAll("img"))
            .some((el) => el.getAttribute("src")?.includes("ok.jpg")), "次の写真が出ていない").toBe(true);
    });

    // 正常系: 読み込める写真では何も出さない
    it("読み込める写真では出さない", async () => {
        render(<EditPage />);
        await screen.findByDisplayValue("湖");
        expect(screen.queryByText("画像を読み込めません")).toBeNull();
        expect(photoImg()).toBeDefined();
    });
});
