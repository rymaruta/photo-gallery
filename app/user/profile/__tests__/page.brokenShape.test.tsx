import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **`GET /user/profile` の応答も形を見ていなかった**（`as UserProfile`）。
// 他人のプロフィール（`/profile/<id>`）と同じ穴。こちらは自分の編集画面
// なので、症状が「表示が壊れる」で終わらない——オブジェクトが入力欄に
// 入ると `[object Object]` になり、**保存でそれが自分の表示名として
// 焼き付く**。

const mockShowToast = vi.fn();
const mockUserFetch = vi.fn();

// ブロック一覧は境界として外す（`GET /user/blocks` を勝手に呼ぶので、
// この画面の「何を送ったか」の数え上げに混ざる）。中身は
// `BlockedUsers.test.tsx` が見る
vi.mock("../BlockedUsers", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("../../../auth/context", () => ({ useAuth: () => ({ isAuthenticated: true, loading: false }) }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../../lib/utils/api", () => ({ userFetch: (...args: unknown[]) => mockUserFetch(...args) }));
vi.mock("../../../../lib/utils/image", () => ({
    toUploadSafeFile: async (f: File) => f,
    UnstrippableFileError: class extends Error { },
    AVATAR_MAX_PX: 512,
    COVER_MAX_PX: 1280,
}));
vi.mock("../../../components/DeleteAccountModal", () => ({ default: () => null }));

const ProfilePage = (await import("../page")).default;

const ok = (data: unknown) => ({ ok: true, json: async () => data });

beforeEach(() => {
    mockShowToast.mockReset();
    mockUserFetch.mockReset();
});

describe("プロフィール編集: 応答の形が想定と違うとき", () => {
    it("オブジェクトが入力欄に入らない（[object Object] を保存しない）", async () => {
        mockUserFetch
            .mockResolvedValueOnce(ok({ userId: "u1", displayName: { ja: "旅人" }, bio: "こんにちは" }))
            .mockResolvedValueOnce(ok({}));
        render(<ProfilePage />);

        const bio = await screen.findByDisplayValue("こんにちは");
        expect(screen.queryByDisplayValue(/object Object/), "オブジェクトが入力欄に入っている").toBeNull();

        // 触っていない項目を送らない（この画面の「変えた項目だけ送る」）
        await userEvent.clear(bio);
        await userEvent.type(bio, "旅の記録");
        await userEvent.click(await screen.findByRole("button", { name: /保存/ }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        const puts = mockUserFetch.mock.calls.filter((c) => c[1]?.method === "PUT");
        const body = JSON.parse(puts[puts.length - 1][1].body as string) as Record<string, unknown>;
        expect(body, "触っていない表示名を送っている").not.toHaveProperty("displayName");
    });

    it("本文が null の 200 は「未設定」ではなく失敗として伝える", async () => {
        mockUserFetch.mockResolvedValue(ok(null));
        render(<ProfilePage />);
        expect(await screen.findByText(/読み込めませんでした|読み込みに失敗/)).toBeInTheDocument();
    });

    // 正常系
    it("形の合った応答はこれまでどおり入る", async () => {
        mockUserFetch.mockResolvedValue(ok({ userId: "u1", displayName: "旅人", bio: "こんにちは" }));
        render(<ProfilePage />);
        expect(await screen.findByDisplayValue("旅人")).toBeInTheDocument();
        expect(await screen.findByDisplayValue("こんにちは")).toBeInTheDocument();
    });
});
