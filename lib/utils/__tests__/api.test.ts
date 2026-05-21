import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// getCurrentSession をモック
vi.mock("../../auth/cognito", () => ({
    getCurrentSession: vi.fn(),
}));

import { getCurrentSession } from "../../auth/cognito";
const mockGetSession = getCurrentSession as ReturnType<typeof vi.fn>;

beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    // fetch をモック
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 200 }))));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe("publicFetch", () => {
    it("NEXT_PUBLIC_API_BASE_URL が未設定 → /api/* に fallback する", async () => {
        const { publicFetch } = await import("../api");
        await publicFetch("/photos");
        const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(calledUrl).toBe("/api/photos");
    });

    it("NEXT_PUBLIC_API_BASE_URL が設定されている → そちらを使う", async () => {
        vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example.com");
        const { publicFetch } = await import("../api");
        await publicFetch("/photos");
        const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(calledUrl).toBe("https://api.example.com/photos");
    });

    it("path の先頭スラッシュは重複しない", async () => {
        const { publicFetch } = await import("../api");
        await publicFetch("photos"); // スラッシュなし
        const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(calledUrl).toBe("/api/photos");
    });
});

describe("authenticatedFetch", () => {
    it("セッションなし → エラーを throw する", async () => {
        mockGetSession.mockResolvedValue(null);
        const { authenticatedFetch } = await import("../api");
        await expect(authenticatedFetch("/photos")).rejects.toThrow("認証が必要です");
    });

    it("セッションあり → Authorization ヘッダー付きでリクエストする", async () => {
        mockGetSession.mockResolvedValue({
            getIdToken: () => ({ getJwtToken: () => "test-jwt-token" }),
        });
        const { authenticatedFetch } = await import("../api");
        await authenticatedFetch("/admin/photos");
        const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(callArgs[1].headers.Authorization).toBe("Bearer test-jwt-token");
    });
});

describe("userFetch", () => {
    it("セッションなし → エラーを throw する", async () => {
        mockGetSession.mockResolvedValue(null);
        const { userFetch } = await import("../api");
        await expect(userFetch("/profile")).rejects.toThrow("認証が必要です");
    });

    it("NEXT_PUBLIC_USER_API_BASE_URL が設定されている → そちらを使う", async () => {
        vi.stubEnv("NEXT_PUBLIC_USER_API_BASE_URL", "https://user-api.example.com");
        mockGetSession.mockResolvedValue({
            getIdToken: () => ({ getJwtToken: () => "user-token" }),
        });
        const { userFetch } = await import("../api");
        await userFetch("/profile");
        const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(calledUrl).toBe("https://user-api.example.com/profile");
    });
});
