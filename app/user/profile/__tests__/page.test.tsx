import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockShowToast = vi.fn();
const mockUserFetch = vi.fn();

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, loading: false }),
}));

vi.mock("../../../i18n/context", () => ({
    useLocale: () => ({ locale: "ja" }),
}));

vi.mock("../../../../lib/hooks/useToast", () => ({
    useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...args: unknown[]) => mockUserFetch(...args),
}));

vi.mock("../../../components/DeleteAccountModal", () => ({
    default: () => null,
}));

const ProfilePage = (await import("../page")).default;

const ok = (data: unknown) => ({ ok: true, json: async () => data });

beforeEach(() => {
    mockShowToast.mockReset();
    mockUserFetch.mockReset();
});

// PUT /user/profile は全置換なので、読み込めていない（＝フォームが空欄の）
// 状態で保存すると、自己紹介・リンク・テーマ色・BGM・ピン留め・旅アルバムが
// まとめて消える。空欄を見たユーザーが「まだ何も設定していない」と誤解して
// 書き直し、保存してしまう経路が実在する。
describe("プロフィール編集: 読み込み失敗時に保存させない", () => {
    it("読み込みに失敗したら警告を出し、保存しても PUT を投げない", async () => {
        mockUserFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
        render(<ProfilePage />);

        // 読み込めなかったことがフォーム上ではっきり分かる
        await screen.findByText(/プロフィールを読み込めませんでした/);

        const save = await screen.findByRole("button", { name: /保存/ });
        await userEvent.click(save);

        // GET の1回だけ。PUT は投げていない
        expect(mockUserFetch).toHaveBeenCalledTimes(1);
        expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining("読み込めていません"),
            "error",
        );
    });

    it("ネットワークごと失敗した場合も同じ", async () => {
        mockUserFetch.mockRejectedValueOnce(new Error("offline"));
        render(<ProfilePage />);

        await screen.findByText(/プロフィールを読み込めませんでした/);
        await userEvent.click(await screen.findByRole("button", { name: /保存/ }));

        expect(mockUserFetch).toHaveBeenCalledTimes(1);
    });

    it("読み込みに成功していれば従来どおり保存する", async () => {
        mockUserFetch
            .mockResolvedValueOnce(ok({ userId: "u1", displayName: "旅人", bio: "こんにちは" }))
            .mockResolvedValueOnce(ok({}));
        render(<ProfilePage />);

        await waitFor(() => expect(screen.queryByText(/プロフィールを読み込めませんでした/)).toBeNull());
        await userEvent.click(await screen.findByRole("button", { name: /保存/ }));

        await waitFor(() => expect(mockUserFetch).toHaveBeenCalledTimes(2));
        expect(mockUserFetch.mock.calls[1][1]).toMatchObject({ method: "PUT" });
    });
});
