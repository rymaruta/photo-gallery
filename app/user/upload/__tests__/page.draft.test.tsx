import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **書きかけを端末に控えて戻す**（docs/ios-bug-audit-2026-09-25.md #8）。
// iOS はバックグラウンドのページを黙って捨てるので、カメラや別のアプリから
// 戻ると読み込み直しになり、選んだ写真も打った題名も消えていた。

const mockUserFetch = vi.hoisted(() => vi.fn());
const q = vi.hoisted(() => ({ search: "" }));
const draft = vi.hoisted(() => ({
    save: vi.fn<(d: unknown) => Promise<undefined>>(async () => undefined),
    read: vi.fn(async (): Promise<unknown> => null),
    clear: vi.fn(async () => undefined),
}));
vi.mock("../../../../lib/utils/uploadDraft", () => ({
    saveUploadDraft: (d: unknown) => draft.save(d),
    readUploadDraft: () => draft.read(),
    clearUploadDraft: () => draft.clear(),
}));

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

/** `/upload/save` に送った本文 */
function savedBody(): Record<string, unknown> | null {
    const call = mockUserFetch.mock.calls.find((c) => c[0] === "/upload/save");
    return call ? JSON.parse((call[1] as { body: string }).body) : null;
}

beforeEach(() => {
    q.search = "";
    draft.save.mockClear(); draft.read.mockReset().mockResolvedValue(null); draft.clear.mockClear();
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

const hide = () => act(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
});
afterEach(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

describe("アップロード画面: 書きかけの控え", () => {
    it("画面が隠れたら、まだ上げていない写真と入力を控える", async () => {
        const { container } = render(<UploadPage />);
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File(["x"], "IMG_0001.jpg", { type: "image/jpeg" }));
        await userEvent.type(screen.getByPlaceholderText("タグ（カンマ区切り）"), "桜");
        hide();
        await waitFor(() => expect(draft.save).toHaveBeenCalled());
        const saved = draft.save.mock.calls.at(-1)![0] as { items: { file: File }[]; tags: string };
        expect(saved.items).toHaveLength(1);
        expect(saved.items[0].file.name).toBe("IMG_0001.jpg");
        expect(saved.tags).toBe("桜");
    });

    it("写真が無いときに隠れたら、控えを消す", async () => {
        render(<UploadPage />);
        hide();
        await waitFor(() => expect(draft.clear).toHaveBeenCalled());
        expect(draft.save).not.toHaveBeenCalled();
    });

    it("開いたときに控えがあれば戻して、そう伝える", async () => {
        draft.read.mockResolvedValue({
            t: Date.now(), category: "", tags: "海", asOnePost: false,
            items: [{ file: new File(["x"], "IMG_0002.jpg", { type: "image/jpeg" }), title: "夕焼け", description: "", location: "" }],
        });
        render(<UploadPage />);
        await waitFor(() => expect(mockShowToast.mock.calls.some((c) => String(c[0]).includes("書きかけを戻しました"))).toBe(true));
        expect((screen.getByPlaceholderText("タグ（カンマ区切り）") as HTMLInputElement).value).toBe("海");
        expect(screen.getByDisplayValue("夕焼け")).toBeTruthy();
    });

    it("全部上げ終わったら控えを消す", async () => {
        const { container } = render(<UploadPage />);
        await uploadOne(container);
        await waitFor(() => expect(draft.clear).toHaveBeenCalled());
    });
});
