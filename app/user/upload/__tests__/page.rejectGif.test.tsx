import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **GIF は選べるのに、公開を押して初めて必ず失敗していた。**
//
// 受け口は `accept="image/*"` なので選べる。ところが `toUploadSafeFile` は
// GIF を必ず `UnstrippableFileError` にする——アニメーションを保つため
// 再エンコードせず（`compressImage` が同じ File を返す）、保険のバイト除去は
// JPEG だけだから。プレビューを見てタイトルまで書いたあとに断られる。
// サーバーの許可リスト（`uploadPolicy.ts`）には `image/gif` が入っているので
// 受け口と実装が食い違っていた。断るなら選んだ時点で断る。

const mockUserFetch = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({
    current: { isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false },
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
const mockShowToast = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../components/AddToHomeScreenHint", () => ({ default: () => null }));
vi.mock("../../../../lib/auth/cognito", () => ({ getCurrentSession: vi.fn(async () => null) }));
vi.mock("../../../../lib/utils/shareStore", () => ({
    // 受け皿は開けたが中身が無い（＝共有経由ではない通常の表示）
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
    userFetch: mockUserFetch,
    readApiError: async (_r: Response, f: string) => f,
}));

const UploadPage = (await import("../page")).default;

beforeEach(() => {
    authState.current = { isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false };
    mockUserFetch.mockReset();
    mockUserFetch.mockResolvedValue({ ok: true, json: async () => [] });
});

async function pick(file: File) {
    const { container } = render(<UploadPage />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file);
    return container;
}

describe("GIF は選んだ時点で断る", () => {
    it("理由を出す（公開まで進ませない）", async () => {
        await pick(new File(["x"], "cat.gif", { type: "image/gif" }));
        expect(await screen.findByText(/GIF は位置情報を取り除けない/),
            "公開を押すまで分からない").toBeInTheDocument();
        expect(screen.getByText(/cat\.gif/)).toBeInTheDocument();
    });

    // **理由を足したら、スキップ件数にも足す。** 一度落として
    // 「0件をスキップしました（GIF は…: cat.gif）」になっていた
    it("スキップ件数に数える", async () => {
        await pick(new File(["x"], "cat.gif", { type: "image/gif" }));
        expect(await screen.findByText(/1件をスキップしました/),
            "0件と出ている（落ちた枚数が伝わらない）").toBeInTheDocument();
    });

    it("他の理由と混ざっても合計が合う", async () => {
        const { container } = render(<UploadPage />);
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, [
            new File(["x"], "cat.gif", { type: "image/gif" }),
            new File([new Uint8Array(51 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" }),
        ]);
        expect(await screen.findByText(/2件をスキップしました/)).toBeInTheDocument();
    });

    it("下書きも作らない", async () => {
        await pick(new File(["x"], "cat.gif", { type: "image/gif" }));
        await screen.findByText(/GIF は位置情報を取り除けない/);
        expect(screen.queryByRole("button", { name: /枚を公開/ }),
            "選んだことになっている").toBeNull();
    });

    // **同じ画面のアバターだけ、保存を押すまで分からなかった。**
    // アバターの `<input>` は `startsWith("image/")` しか見ずにプレビューを
    // 出し、`toUploadSafeFile` を呼ぶのは「保存」を押したあとだった
    // （写真グリッド側の関門はこの入力を通らない）。
    it("アバターの入力でも、選んだ時点で断る", async () => {
        const { container } = render(<UploadPage />);
        const inputs = Array.from(container.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
        expect(inputs.length, "ファイル入力が見つからない").toBeGreaterThan(1);
        // 2つ目がアバター用（1つ目は写真グリッド）
        await userEvent.upload(inputs[inputs.length - 1], new File(["x"], "cat.gif", { type: "image/gif" }));
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining("GIF は位置情報を取り除けません"), "error"));
        expect(screen.queryByRole("button", { name: /保存/ }),
            "保存を押すまで分からない").toBeNull();
    });

    // 正常系: JPEG は今までどおり通る
    it("JPEG は今までどおり選べる", async () => {
        await pick(new File(["x"], "a.jpg", { type: "image/jpeg" }));
        expect(await screen.findByRole("button", { name: /枚を公開/ })).toBeInTheDocument();
        expect(screen.queryByText(/GIF は位置情報を取り除けない/)).toBeNull();
    });
});
