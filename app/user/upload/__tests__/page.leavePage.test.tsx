import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

// **画面を離れても、地名の引き直しが回り続けていた。**
//
// GPS→地名は Nominatim の 1req/s に合わせて1件ずつ 1.1 秒空けて直列に回す。
// 誰も止めないので、30枚なら**離れたあと約35秒**、見てもいない画面のために
// モバイル回線を掴んだまま問い合わせ続ける。書き込み先（`setItems`）はもう
// 無いので、戻ってきても撮影地は空のまま＝その通信は全部無駄。
// 同じファイルの他の非同期処理（`/user/photos` の取得）には中断の印がある。

const mockReverseGeocode = vi.hoisted(() => vi.fn());
const mockReadSharedPayload = vi.hoisted(() => vi.fn());
const mockExtractExif = vi.hoisted(() => vi.fn());

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
    readSharedPayload: mockReadSharedPayload,
    clearSharedPayload: vi.fn(async () => undefined),
}));
vi.mock("../../../../lib/utils/exif", () => ({
    extractExifFromFile: mockExtractExif,
    extractCameraExif: vi.fn(async () => ({})),
    reverseGeocode: mockReverseGeocode,
}));
vi.mock("../../../../lib/utils/image", () => ({
    createThumbnail: vi.fn(async () => null),
    toUploadSafeFile: vi.fn(async (f: File) => f),
    UnstrippableFileError: class extends Error {},
    extractDominantColor: vi.fn(async () => null),
    createBlurPlaceholder: vi.fn(async () => null),
    AVATAR_MAX_PX: 512,
}));

const UploadPage = (await import("../page")).default;

const gpsFile = (n: number) => new File(["x"], `p${n}.jpg`, { type: "image/jpeg" });

beforeEach(() => {
    vi.useRealTimers();
    mockReverseGeocode.mockReset().mockResolvedValue("札幌市");
    mockExtractExif.mockReset().mockResolvedValue({
        dateTimeOriginal: "2024-10-12T09:00:00", latitude: 43.06, longitude: 141.35,
    });
    // GPS 入りを3枚。1枚目の引き直しが終わった時点で画面を離れる
    mockReadSharedPayload.mockReset().mockResolvedValue({
        files: [gpsFile(1), gpsFile(2), gpsFile(3)], title: "", text: "", t: Date.now(),
    });
    localStorage.clear();
    localStorage.setItem("jp_gps_autofill", "1");
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
        Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
    }
});

// **StrictMode を通す。** 「setup → cleanup → setup」で cleanup が先に
// 走るので、離脱の印を立てるだけで下ろさないと**立ちっぱなし**になる。
// ref はインスタンスに残るため、以後の取り込みは初回から break し、
// 開発中は撮影地の自動入力が丸ごと死ぬ。
describe("効果が付け直されたとき（StrictMode）", () => {
    it("離脱の印が立ちっぱなしにならない（地名は引ける）", async () => {
        render(
            <React.StrictMode>
                <UploadPage />
            </React.StrictMode>,
        );

        await waitFor(() => expect(
            mockReverseGeocode,
            "付け直しの cleanup で止まったまま、二度と引かない",
        ).toHaveBeenCalled(), { timeout: 3000 });
    }, 10000);
});

describe("取り込みの途中で画面を離れたとき", () => {
    it("地名の引き直しを続けない", async () => {
        const { unmount } = render(<UploadPage />);

        // 1枚目の逆引きが走るまで待つ（走っていないと下の判定が空振りする）
        await waitFor(() => expect(mockReverseGeocode).toHaveBeenCalledTimes(1));
        unmount();
        const atLeave = mockReverseGeocode.mock.calls.length;

        // 直列の間隔は 1.1 秒。2周ぶん待って、増えていないことを見る
        await new Promise((r) => setTimeout(r, 2500));

        expect(mockReverseGeocode.mock.calls.length,
            "離れたあとも問い合わせ続けている").toBe(atLeave);
    }, 10000);
});
