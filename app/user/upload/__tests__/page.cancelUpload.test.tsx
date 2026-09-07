import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UPLOAD_FAILED_MESSAGE } from "../errorText";

// **アップロード中に止める手段が無かった。**
// 押している間は公開も下書き保存も `disabled={uploading}` で、しかも
// **S3 への PUT は素の `fetch`**（`userFetch` の20秒の打ち切りは経路外）。
// 応答が返らない回線ではリロード以外に出る手段が無く、リロードすると
// S3 に孤児が残る（DynamoDB に行が無いので、どの削除経路からも辿れない）。
// ストーリーの投稿（`StoriesBar`）が同じ理由で先に直してある形を借りる。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockReadSharedPayload = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams("from=share"),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../components/AddToHomeScreenHint", () => ({ default: () => null }));
vi.mock("../../../../lib/auth/cognito", () => ({ getCurrentSession: vi.fn(async () => null) }));
vi.mock("../../../../lib/utils/shareStore", () => ({
    // 「読めた／読めなかった」を分ける口。既存のモックから組み立てる
    readSharedResult: async () => ({ ok: true, payload: await mockReadSharedPayload() }),
    clearSharedPayload: vi.fn(async () => undefined),
}));
vi.mock("../../../../lib/utils/exif", () => ({
    extractExifFromFile: vi.fn(async () => ({})),
    extractCameraExif: vi.fn(async () => ({})),
    reverseGeocode: vi.fn(async () => null),
}));
vi.mock("../../../../lib/utils/image", () => ({
    createThumbnail: vi.fn(async () => null),        // サムネは作らない（本体のキーだけを見る）
    toUploadSafeFile: vi.fn(async (f: File) => f),
    UnstrippableFileError: class extends Error {},
    extractDominantColor: vi.fn(async () => null),
    createBlurPlaceholder: vi.fn(async () => null),
    AVATAR_MAX_PX: 512,
}));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: mockUserFetch,
    readApiError: async (res: Response, fallback: string) => {
        try {
            const d = await res.json() as { error?: string };
            return d.error ?? fallback;
        } catch { return fallback; }
    },
}));

const UploadPage = (await import("../page")).default;


const KEY = "uploads/me/abc.jpg";

/** S3 への PUT を、中断されるまで返さない形にする */
function hangingPut() {
    let abortPut: (() => void) | null = null;
    const putStarted = { done: false };
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
        putStarted.done = true;
        return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("cancelled", "AbortError")));
            abortPut = () => reject(new DOMException("cancelled", "AbortError"));
        });
    }));
    return { putStarted, get abortPut() { return abortPut; } };
}

beforeEach(() => {
    mockUserFetch.mockReset().mockImplementation((url: string) => {
        if (url === "/upload/presigned-url") {
            return Promise.resolve({ ok: true, json: async () => ({ presignedUrl: "https://s3/put", publicUrl: "https://cdn/x.jpg", key: KEY }) });
        }
        if (url === "/upload/discard") return Promise.resolve({ ok: true, json: async () => ({}) });
        if (url === "/user/photos") return Promise.resolve({ ok: true, json: async () => [] });
        return Promise.resolve({ ok: true, json: async () => ({ id: "p1" }) });
    });
    mockReadSharedPayload.mockResolvedValue({
        files: [new File(["x"], "shared.jpg", { type: "image/jpeg" })], title: "", text: "", t: Date.now(),
    });
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
        Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
    }
});

describe("アップロード中にやめる", () => {
    it("止めるボタンは、押している間だけ出る", async () => {
        hangingPut();
        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        expect(screen.queryByRole("button", { name: "やめる" }), "押す前から出ている").toBeNull();

        await userEvent.click(publish);
        expect(await screen.findByRole("button", { name: "やめる" }), "止める手段が無い").toBeInTheDocument();
    });

    it("押したら S3 への PUT を中断し、上げかけた実体を捨てる", async () => {
        hangingPut();
        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);

        const stop = await screen.findByRole("button", { name: "やめる" });
        await userEvent.click(stop);

        // 上げかけたキーを捨てる（残すと誰も辿れない実体になる）
        await waitFor(() => {
            const discards = mockUserFetch.mock.calls.filter((c) => c[0] === "/upload/discard");
            expect(discards.length, "上げかけた実体を捨てていない").toBeGreaterThan(0);
        });
        // 押せる状態に戻る（＝止める手段が効いている）
        await waitFor(() => expect(screen.queryByRole("button", { name: "やめる" })).toBeNull());
        await waitFor(() => expect(screen.getByRole("button", { name: /枚を公開/ })).not.toBeDisabled());
    });

    it("やめても「失敗」にせず、もう一度押せる状態に戻す", async () => {
        hangingPut();
        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await userEvent.click(await screen.findByRole("button", { name: "やめる" }));

        await waitFor(() => expect(screen.queryByRole("button", { name: "やめる" })).toBeNull());
        // **文言そのものを見る。** 最初は `/失敗/` で探していたが、中断したときに
        // 出る文言は「画像をアップロードできませんでした…」で**その語を含まない**
        // ——中断を失敗として扱う変異が素通りしていた（変異テストで気づいた）
        expect(screen.queryByText(UPLOAD_FAILED_MESSAGE), "やめただけなのに失敗の文言を出している").toBeNull();
        // 赤い注意書き自体が出ていないこと
        expect(document.querySelector(".text-red-400"), "やめただけなのに赤い注意書きが出ている").toBeNull();
    });
});
