import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **位置情報が無い写真では、そう言う**（docs/ios-bug-audit-2026-09-25.md #10）。
// iPhone の「写真を撮る」で撮った写真は、iOS が位置情報を外して渡す。
// 黙っていると、自動入力が壊れているのか写真に無いのか分からなかった。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockExif = vi.hoisted(() => vi.fn());
const q = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(q.search),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
const mockShowToast = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../components/AddToHomeScreenHint", () => ({ default: () => null }));
// `userFetch` はこちらでトークンを引く（`getCurrentSession` だけ差し替えても
// 入口を支配できない）。page.quota.test.tsx と同じ形
vi.mock("../../../../lib/auth/cognito", () => {
    const getCurrentSession = vi.fn(async () => null);
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
vi.mock("../../../../lib/utils/shareStore", () => ({
    readSharedResult: vi.fn(async () => ({ ok: true, payload: null })),
    clearSharedPayload: vi.fn(async () => undefined),
}));
vi.mock("../../../../lib/utils/exif", () => ({
    extractExifFromFile: (...a: unknown[]) => mockExif(...a),
    extractCameraExif: vi.fn(async () => ({})),
    reverseGeocode: vi.fn(async () => null),
}));
vi.mock("../../../../lib/utils/image", () => ({
    createThumbnail: vi.fn(async () => null),
    toUploadSafeFile: vi.fn(async (f: File) => f),
    UnstrippableFileError: class extends Error {},
    extractDominantColor: vi.fn(async () => null),
    createBlurPlaceholder: vi.fn(async () => null),
    AVATAR_MAX_PX: 512,
}));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    readApiError: async (_r: Response, f: string) => f,
}));

const UploadPage = (await import("../page")).default;

beforeEach(() => {
    mockShowToast.mockReset();
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    try { localStorage.removeItem("jp_gps_autofill"); } catch { /* ignore */ }
});

const pick = async (container: HTMLElement) => {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "IMG_0001.jpg", { type: "image/jpeg" }));
};
const noLocationToast = () => mockShowToast.mock.calls.find((c) => String(c[0]).includes("位置情報が無かった"));

describe("アップロード画面: 位置情報の無い写真", () => {
    it("位置情報が無ければ「無かったので入れていない」と伝える", async () => {
        mockExif.mockResolvedValue({});
        const { container } = render(<UploadPage />);
        await pick(container);
        await waitFor(() => expect(noLocationToast(), "黙っている").toBeTruthy());
        expect(noLocationToast()![1]).toBe("info");
    });

    it("位置情報があれば言わない", async () => {
        mockExif.mockResolvedValue({ latitude: 35.6, longitude: 139.7 });
        const { container } = render(<UploadPage />);
        await pick(container);
        await waitFor(() => expect(mockExif).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 50));
        expect(noLocationToast()).toBeUndefined();
    });

    it("自動入力を切っていれば言わない", async () => {
        localStorage.setItem("jp_gps_autofill", "0");
        mockExif.mockResolvedValue({});
        const { container } = render(<UploadPage />);
        await pick(container);
        await waitFor(() => expect(mockExif).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 50));
        expect(noLocationToast()).toBeUndefined();
    });
});
