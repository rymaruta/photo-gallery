import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// この画面は**下書き一覧からしか来ない前提**で作られていた。
// 写真ページからも来るようになった（UX-1 の導線）ので、公開済みの写真では
//  - 一番「保存」に見える「下書き保存」が published:false を送り、
//    **公開中の写真が黙って非公開になって検索から消える**
//  - 保存しても着地が（公開写真の出ない）下書き一覧
// という壊れ方をしていた。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams("id=p1"),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    readApiError: async (_r: Response, f: string) => f,
}));

const EditPage = (await import("../page")).default;
// ビルド時に静的ページを持たない写真はクエリ版に落ちる（ROUTES.PHOTO の仕様）。
// ここでハードコードすると、その分岐を測らずに固定してしまう。
const { ROUTES } = await import("../../../../lib/routes");

const photo = (published: boolean) => ({
    id: "p1", src: "https://cdn/x/p1.jpg", userId: "me", published, title: "湖",
});

const putBody = () => {
    const put = mockUserFetch.mock.calls.find((c) => c[1]?.method === "PUT");
    return put ? JSON.parse(put[1].body as string) as Record<string, unknown> : null;
};

function world(published: boolean) {
    mockUserFetch.mockReset().mockImplementation((url: string, init?: { method?: string }) => {
        if (!init?.method) return Promise.resolve({ ok: true, json: async () => [photo(published)] });
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
    });
}

beforeEach(() => {
    mockShowToast.mockReset();
    mockPush.mockReset();
});

// 下書きのまま保存したときに「非公開にしました」と出ていた。公開したことが
// 無い写真に「非公開に」は、何かを取り下げたように読める
describe("保存のトースト", () => {
    it("下書きを下書きのまま保存 → 「下書きを保存しました」", async () => {
        world(false);
        render(<EditPage />);
        await screen.findByDisplayValue("湖");
        await userEvent.click(screen.getByRole("button", { name: "下書き保存" }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("下書きを保存しました", "success"));
        expect(mockShowToast).not.toHaveBeenCalledWith("非公開にしました", "success");
    });

    it("公開中の写真を非公開に → 「非公開にしました」", async () => {
        world(true);
        render(<EditPage />);
        await screen.findByDisplayValue("湖");
        await userEvent.click(screen.getByRole("button", { name: "非公開にする" }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("非公開にしました", "success"));
    });
});

describe("公開済みの写真を編集するとき", () => {
    it("「下書き保存」を出さない（黙って非公開にしない）", async () => {
        world(true);
        render(<EditPage />);
        await screen.findByDisplayValue("湖");

        expect(screen.queryByRole("button", { name: "下書き保存" })).toBeNull();
        // 非公開にしたいときは、そう書いてあるボタンから
        expect(screen.getByRole("button", { name: "非公開にする" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "保存する" })).toBeInTheDocument();
    });

    it("保存したら写真ページへ戻す（空の下書き一覧に落とさない）", async () => {
        world(true);
        render(<EditPage />);
        await screen.findByDisplayValue("湖");
        await userEvent.click(screen.getByRole("button", { name: "保存する" }));

        await waitFor(() => expect(putBody()).toBeTruthy());
        expect(putBody()!.published).toBe(true);
        await waitFor(() => expect(mockPush).toHaveBeenCalledWith(ROUTES.PHOTO("p1")));
    });

    it("「非公開にする」は今までどおり published:false を送る", async () => {
        world(true);
        render(<EditPage />);
        await screen.findByDisplayValue("湖");
        await userEvent.click(screen.getByRole("button", { name: "非公開にする" }));

        await waitFor(() => expect(putBody()).toBeTruthy());
        expect(putBody()!.published).toBe(false);
        await waitFor(() => expect(mockPush).toHaveBeenCalledWith(ROUTES.DRAFTS));
    });

    it("下書きのときは今までどおり「下書き保存」と「公開する」", async () => {
        world(false);
        render(<EditPage />);
        await screen.findByDisplayValue("湖");

        expect(screen.getByRole("button", { name: "下書き保存" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "公開する" })).toBeInTheDocument();
    });
});
