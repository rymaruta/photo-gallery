import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **サムネ・代表色・ぼかしは、縮めた方から作る**（docs/ios-bug-audit-2026-09-25.md #26）。
// 原寸（24〜48MP）を読み直すと1枚ごとに4回デコードすることになり、
// iPhone でタブが落ちやすかった。

const mockUserFetch = vi.hoisted(() => vi.fn());
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
    extractExifFromFile: vi.fn(async () => ({})),
    extractCameraExif: vi.fn(async () => ({})),
    reverseGeocode: vi.fn(async () => null),
}));
const img = vi.hoisted(() => ({
    shrunk: null as File | null,
    createThumbnail: vi.fn<(f: File) => Promise<null>>(async () => null),
    extractDominantColor: vi.fn<(f: File) => Promise<null>>(async () => null),
    createBlurPlaceholder: vi.fn<(f: File) => Promise<null>>(async () => null),
}));
vi.mock("../../../../lib/utils/image", () => ({
    createThumbnail: img.createThumbnail,
    toUploadSafeFile: vi.fn(async () => img.shrunk),
    UnstrippableFileError: class extends Error {},
    extractDominantColor: img.extractDominantColor,
    createBlurPlaceholder: img.createBlurPlaceholder,
    AVATAR_MAX_PX: 512,
}));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    readApiError: async (_r: Response, f: string) => f,
}));

const UploadPage = (await import("../page")).default;

/** `/upload/save` に送った本文 */
function savedBody(): Record<string, unknown> | null {
    const call = mockUserFetch.mock.calls.find((c) => c[0] === "/upload/save");
    return call ? JSON.parse((call[1] as { body: string }).body) : null;
}

beforeEach(() => {
    q.search = "";
    img.shrunk = new File(["small"], "IMG_0001.webp", { type: "image/webp" });
    mockShowToast.mockReset();
    mockUserFetch.mockReset().mockImplementation((url: string) => {
        if (url === "/user/photos") return Promise.resolve({ ok: true, json: async () => [] });
        if (url === "/upload/presigned-url") {
            return Promise.resolve({
                ok: true,
                json: async () => ({ presignedUrl: "https://s3/put", publicUrl: "https://cdn/uploads/me/a.jpg", key: "uploads/me/a.jpg" }),
            });
        }
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
});

async function uploadOne(container: HTMLElement) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "a.jpg", { type: "image/jpeg" }));
    const publish = await screen.findByRole("button", { name: /投稿する/ });
    await waitFor(() => expect(publish).not.toBeDisabled());
    await userEvent.click(publish);
    await waitFor(() => expect(savedBody(), "保存に届いていない").not.toBeNull());
}

describe("アップロード画面: 派生は縮めた方から作る", () => {
    it("サムネ・代表色・ぼかしに渡すのは、縮めた File（原寸ではない）", async () => {
        const { container } = render(<UploadPage />);
        await uploadOne(container);
        for (const fn of [img.createThumbnail, img.extractDominantColor, img.createBlurPlaceholder]) {
            expect(fn).toHaveBeenCalled();
            expect(fn.mock.calls[0][0], "原寸を読み直している").toBe(img.shrunk);
        }
    });
});
