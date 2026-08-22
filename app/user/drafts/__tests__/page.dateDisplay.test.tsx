import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// 下書き一覧の撮影日時が生の値（"2024-10-12T08:30:15+09:00" 等）のまま
// 出ていた。写真ページ（PhotoPageClient の shotAt）と同じ
// formatStoredDateTime で整形し、整形できない値は出さない。

const mockUserFetch = vi.fn();

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({
    useLocale: () => ({ locale: "ja" }),
}));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...args: unknown[]) => mockUserFetch(...args),
}));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const DraftsPage = (await import("../page")).default;

const draft = (over: Record<string, unknown>) => ({
    id: "d1", src: "https://cdn/d1.jpg", published: false, title: "下書きの写真", ...over,
});

beforeEach(() => mockUserFetch.mockReset());

describe("下書き一覧の撮影日時表示", () => {
    it("時刻付きの値は「YYYY年M月D日 HH:MM」に整形される（生ISOを出さない）", async () => {
        mockUserFetch.mockResolvedValue({
            ok: true,
            json: async () => [draft({ date: "2024-10-12T08:30:15+09:00" })],
        });
        render(<DraftsPage />);
        expect(await screen.findByText(/2024年10月12日 08:30/)).toBeTruthy();
        expect(screen.queryByText(/2024-10-12T08:30/)).toBeNull();
    });

    it("日付だけの値に 00:00 を足さない", async () => {
        mockUserFetch.mockResolvedValue({
            ok: true,
            json: async () => [draft({ date: "2024-10-12" })],
        });
        render(<DraftsPage />);
        expect(await screen.findByText(/2024年10月12日/)).toBeTruthy();
        expect(screen.queryByText(/00:00/)).toBeNull();
    });

    it("整形できない値は日付を出さない（撮影地だけ残る）", async () => {
        mockUserFetch.mockResolvedValue({
            ok: true,
            json: async () => [draft({ date: "2024:10:12 08:30:15", location: "京都" })],
        });
        render(<DraftsPage />);
        expect(await screen.findByText("京都")).toBeTruthy();
        expect(screen.queryByText(/2024:10:12/)).toBeNull();
    });
});
