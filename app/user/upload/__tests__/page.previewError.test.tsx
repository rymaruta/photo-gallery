import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **開けない画像でプレビューが枠ごと消えていた（IMG-7）。**
//
// `addFiles` が選んだ時点で断るのは「画像でない」「GIF」「50MBを超える」だけ。
// 種別は画像なのにこのブラウザでデコードできないファイル（**PC の Chrome で
// 選んだ HEIC** が代表）はここまで来る。`block w-auto max-h-56` は高さを
// 予約しないので、`onError` を持たない頃は**プレビューが高さ 0 に潰れ**
// （Chromium 実測 390x224 → 390x0）、切り抜きの白枠も出ないまま
// 「公開」を押して初めて断られていた。

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
    // 受け皿は開けたが中身が無い（＝共有経由ではない通常の表示）
    readSharedResult: vi.fn(async () => ({ ok: true, payload: null })),
    clearSharedPayload: vi.fn(async () => undefined),
}));
vi.mock("../../../../lib/utils/exif", () => ({
    extractExifFromFile: vi.fn(async () => ({})),
    extractCameraExif: vi.fn(async () => ({})),
    reverseGeocode: vi.fn(async () => null),
}));
vi.mock("../../../../lib/utils/image", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    createThumbnail: vi.fn(async () => null),
    toUploadSafeFile: vi.fn(async (f: File) => f),
    extractDominantColor: vi.fn(async () => null),
    createBlurPlaceholder: vi.fn(async () => null),
}));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: mockUserFetch,
    readApiError: async (_r: Response, f: string) => f,
}));

const UploadPage = (await import("../page")).default;

beforeEach(() => {
    authState.current = { isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false };
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
});

/** HEIC は種別が画像なので `addFiles` を通る（GIF と違って断られない） */
async function pickHeic() {
    const { container } = render(<UploadPage />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "IMG_0001.heic", { type: "image/heic" }));
    await screen.findByText(/共通設定/);
    return container;
}

const previewImg = (container: HTMLElement) =>
    container.querySelector("img.max-h-56") as HTMLImageElement | null;

describe("プレビューが開けないとき", () => {
    it("枠ごと消さずに理由を出す（公開を押すまで待たせない）", async () => {
        const container = await pickHeic();
        const img = previewImg(container);
        expect(img, "プレビューが出ていない").not.toBeNull();

        fireEvent.error(img!);

        // 公開を押したときに出るのと同じ文言
        expect(await screen.findByText(/この画像を開けませんでした/)).toBeInTheDocument();
        expect(previewImg(container), "潰れた img を残している").toBeNull();
    });

    it("置き換えの枠は高さを予約している", async () => {
        const container = await pickHeic();
        fireEvent.error(previewImg(container)!);

        const box = (await screen.findByText(/この画像を開けませんでした/)).closest("div");
        expect(box?.className, "高さを予約していない（また潰れる）").toMatch(/\bh-40\b/);
    });

    // 正常系: 読み込めるプレビューでは何も出さない
    it("読み込めるプレビューでは出さない", async () => {
        const container = await pickHeic();
        fireEvent.load(previewImg(container)!);

        expect(screen.queryByText(/この画像を開けませんでした/)).toBeNull();
        expect(previewImg(container)).not.toBeNull();
    });
});
