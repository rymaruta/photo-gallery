import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ページ側でも1本。フックだけ直しても、ページが `no-group` を
// スピナーのまま握りつぶしたら「白い画面で固まる」に変わるだけ。

const mockPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

const authState = vi.hoisted(() => ({
    current: { isAuthenticated: true, isAdminUser: false, isGeneralUser: false, loading: false, userId: "u1" },
}));
vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: vi.fn(async () => ({ ok: true, json: async () => [] })),
    readApiError: vi.fn(async () => "err"),
}));

const { default: DraftsPage } = await import("../page");

beforeEach(() => { mockPush.mockReset(); });

describe("下書き一覧: 権限が無い人", () => {
    it("ログイン画面へ送り返さず、事情を出す", async () => {
        render(<DraftsPage />);
        expect(await screen.findByText(/投稿の権限が付いていません/)).toBeInTheDocument();
        expect(mockPush).not.toHaveBeenCalled();
        // 行き止まりにしない
        expect(screen.getByRole("link", { name: /ギャラリーへ戻る/ })).toHaveAttribute("href", "/");
    });
});
