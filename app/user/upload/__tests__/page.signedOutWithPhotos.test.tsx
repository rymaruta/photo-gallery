import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// **取り込んだ写真ごと画面が入れ替わっていた。**
// `useMemberGate` は未ログインを見ると `router.replace("/login?next=…")` を
// 呼ぶ。取り込みは1枚 1.1秒かかっているうえ、共有シートから来た人は
// 元のアプリに戻って選び直すことになる。ログインが切れた側はどのみち
// 上げられないが、**捨ててよい理由にはならない**。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const mockReplace = vi.hoisted(() => vi.fn());
const mockReadSharedPayload = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ isAuthenticated: true }));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: mockReplace }),
    useSearchParams: () => new URLSearchParams("from=share"),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({
        isAuthenticated: auth.isAuthenticated, isAdminUser: false,
        isGeneralUser: auth.isAuthenticated, loading: false,
    }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../components/AddToHomeScreenHint", () => ({ default: () => null }));
vi.mock("../../../../lib/auth/cognito", () => ({
    getCurrentSession: vi.fn(async () => null),
    lookupSession: vi.fn(async () => ({ session: null, unreachable: false })),
}));
vi.mock("../../../../lib/utils/shareStore", () => ({
    readSharedResult: async () => ({ ok: true, payload: await mockReadSharedPayload() }),
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
vi.mock("../../../../lib/utils/api", async () => {
    const actual = await vi.importActual<typeof import("../../../../lib/utils/api")>("../../../../lib/utils/api");
    return { ...actual, userFetch: mockUserFetch };
});

const UploadPage = (await import("../page")).default;

beforeEach(() => {
    auth.isAuthenticated = true;
    mockShowToast.mockReset(); mockReplace.mockReset();
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockReadSharedPayload.mockResolvedValue({
        files: [new File(["x"], "shared.jpg", { type: "image/jpeg" })], title: "", text: "", t: Date.now(),
    });
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
        Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
    }
});

const toasts = () => mockShowToast.mock.calls.map((c) => String(c[0]));
/** 種類まで見る（`種類:文言`）。文言だけでは、成功として出しても気づけない */
const typed = () => mockShowToast.mock.calls.map((c) => `${String(c[1] ?? "success")}:${String(c[0])}`);
const signedOutToasts = () => toasts().filter((t) => t.includes("ログインが切れました"));

describe("取り込んだ写真があるときにログインが切れたら", () => {
    it("ログイン画面へ送り返さず、写真も画面も残す", async () => {
        const { rerender } = render(<UploadPage />);
        await screen.findByRole("button", { name: /枚を公開/ });

        auth.isAuthenticated = false;
        rerender(<UploadPage />);

        await waitFor(() => expect(toasts().some((t) => t.includes("ログインが切れました"))).toBe(true));
        expect(mockReplace, "取り込んだ写真ごと画面を入れ替えている").not.toHaveBeenCalled();
        // スピナーに落とさない（見えないまま止まるのは、選び直すのと同じこと）
        expect(screen.getByRole("button", { name: /枚を公開/ })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "写真をアップロード" })).toBeInTheDocument();
    });

    // **1枚も取り込んでいなければ今までどおり。** 直接開いた未ログインの人を
    // 居座らせると、会員専用の画面が空のまま出続ける
    it("写真が1枚も無ければ、今までどおりログイン画面へ送る", async () => {
        mockReadSharedPayload.mockResolvedValue(null);
        auth.isAuthenticated = false;
        render(<UploadPage />);
        await waitFor(() => expect(mockReplace).toHaveBeenCalled());
        expect(String(mockReplace.mock.calls[0][0])).toContain("/login");
        expect(signedOutToasts(), "送り返すのに知らせている").toEqual([]);
        // **送り返す間は会員画面を出さない**（留めているときだけ出す）。
        // 写真0枚では「N枚を公開」が元から無いので、**画面そのものの見出し**で見る
        expect(screen.queryByRole("heading", { name: "写真をアップロード" }),
            "送り返すのに会員画面を出している").toBeNull();
    });

    it("知らせは赤（成功として出さない）", async () => {
        const { rerender } = render(<UploadPage />);
        await screen.findByRole("button", { name: /枚を公開/ });
        auth.isAuthenticated = false;
        rerender(<UploadPage />);
        await waitFor(() => expect(signedOutToasts().length).toBe(1));
        expect(typed().some((t) => t.startsWith("error:") && t.includes("ログインが切れました"))).toBe(true);
    });

    it("同じことを何度も言わない", async () => {
        const { rerender } = render(<UploadPage />);
        await screen.findByRole("button", { name: /枚を公開/ });
        auth.isAuthenticated = false;
        rerender(<UploadPage />);
        await waitFor(() => expect(signedOutToasts().length).toBe(1));
        rerender(<UploadPage />);
        rerender(<UploadPage />);
        expect(signedOutToasts().length, "描画のたびに言っている").toBe(1);
    });

    // **上げ終わったぶんは守らない。** `items` は成功しても `done` として
    // 残るので（1件でも失敗すると遷移しない）、件数で見ると
    // 「もう上がっている写真」について「まだ上げられません」と嘘をつく
    it("上げ終わっていれば、留めずに今までどおり送り返す", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
        mockUserFetch.mockImplementation((url: string) => {
            if (url === "/upload/presigned-url") {
                return Promise.resolve({ ok: true, json: async () => ({ presignedUrl: "https://s3/put", publicUrl: "https://cdn/x.jpg", key: "k" }) });
            }
            if (url === "/user/photos") return Promise.resolve({ ok: true, json: async () => [] });
            return Promise.resolve({ ok: true, json: async () => ({ id: "p1" }) });
        });
        const { rerender } = render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        fireEvent.click(publish);
        await screen.findByText("アップロード完了");

        auth.isAuthenticated = false;
        rerender(<UploadPage />);
        await waitFor(() => expect(mockReplace).toHaveBeenCalled());
        expect(signedOutToasts(), "上がっている写真について「まだ上げられません」と言っている").toEqual([]);
    });
});
