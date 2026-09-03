import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../../components/AddToHomeScreenHint", () => ({ default: () => null }));
vi.mock("../../../../lib/auth/cognito", () => ({ getCurrentSession: vi.fn(async () => null) }));
vi.mock("../../../../lib/utils/shareStore", () => ({
    readSharedPayload: vi.fn(async () => null),
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

    it("下書きも作らない", async () => {
        await pick(new File(["x"], "cat.gif", { type: "image/gif" }));
        await screen.findByText(/GIF は位置情報を取り除けない/);
        expect(screen.queryByRole("button", { name: /枚を公開/ }),
            "選んだことになっている").toBeNull();
    });

    // 正常系: JPEG は今までどおり通る
    it("JPEG は今までどおり選べる", async () => {
        await pick(new File(["x"], "a.jpg", { type: "image/jpeg" }));
        expect(await screen.findByRole("button", { name: /枚を公開/ })).toBeInTheDocument();
        expect(screen.queryByText(/GIF は位置情報を取り除けない/)).toBeNull();
    });
});
