import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **ストレージが使えない端末で、黙って終わっていた2件。**
//
// (1) 共有シートから送ると Service Worker が `?from=share` へ飛ばすが、
//     受け皿（IndexedDB）を開けない端末では `readSharedPayload` が null を
//     返すだけで、画面は「写真が入っていないアップロード画面」になる。
//     利用者には何も出ない——プライベートモードでは毎回これ。
// (2) 「写真のGPSから撮影地を自動入力」を切っても、`localStorage` に
//     書けない端末では**次に開いたときは既定のオンに戻る**。切ったつもりの
//     人の写真から地名が入り、それは公開される。

const mockShowToast = vi.hoisted(() => vi.fn());
const shareResult = vi.hoisted(() => ({ current: { ok: true, payload: null } as unknown }));
const searchParams = vi.hoisted(() => ({ current: "from=share" }));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(searchParams.current),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../components/AddToHomeScreenHint", () => ({ default: () => null }));
vi.mock("../../../../lib/auth/cognito", () => ({ getCurrentSession: vi.fn(async () => null) }));
vi.mock("../../../../lib/utils/shareStore", () => ({
    readSharedPayload: vi.fn(async () => null),
    readSharedResult: vi.fn(async () => shareResult.current),
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
    UnstrippableFileError: class extends Error { },
    extractDominantColor: vi.fn(async () => null),
    createBlurPlaceholder: vi.fn(async () => null),
    AVATAR_MAX_PX: 512,
}));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: vi.fn(async () => ({ ok: true, json: async () => [] })),
    readApiError: async (_r: Response, f: string) => f,
}));

const UploadPage = (await import("../page")).default;

beforeEach(() => {
    mockShowToast.mockReset();
    searchParams.current = "from=share";
    shareResult.current = { ok: true, payload: null };
    localStorage.clear();
});

describe("共有の受け皿を開けない端末", () => {
    it("黙って空の画面にしない（理由と次の一手を出す）", async () => {
        shareResult.current = { ok: false };
        render(<UploadPage />);

        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        const [msg, kind] = mockShowToast.mock.calls[0];
        expect(String(msg), "理由を出していない").toMatch(/読み取れませんでした/);
        expect(String(msg), "次に何をすればいいか書いていない").toMatch(/ボタンから選/);
        expect(kind).toBe("error");
    });

    // **取り込んだ後のリロードを失敗と呼ばない。** `?from=share` は URL に
    // 残るので、受け皿が空なだけの再表示で謝ると誤報になる
    it("受け皿が空なだけなら何も言わない", async () => {
        shareResult.current = { ok: true, payload: null };
        render(<UploadPage />);

        await new Promise((r) => setTimeout(r, 30));
        expect(mockShowToast).not.toHaveBeenCalled();
    });

    // 共有経由でなければ、開けなくても黙っている（通常の表示で謝らない）
    it("共有経由でない表示では、開けなくても何も言わない", async () => {
        searchParams.current = "";
        shareResult.current = { ok: false };
        render(<UploadPage />);

        await new Promise((r) => setTimeout(r, 30));
        expect(mockShowToast).not.toHaveBeenCalled();
    });
});

describe("GPS 自動入力の設定が保存できない端末", () => {
    /** 書き込みだけが投げる localStorage（満杯・プライベートモード相当） */
    function blockWrites() {
        const orig = Storage.prototype.setItem;
        Storage.prototype.setItem = function () { throw new DOMException("full", "QuotaExceededError"); };
        return () => { Storage.prototype.setItem = orig; };
    }

    it("切ったときは、記憶できないことを伝える（次回オンに戻る）", async () => {
        render(<UploadPage />);
        const toggle = await screen.findByRole("checkbox");
        const restore = blockWrites();
        try {
            await userEvent.click(toggle);   // オン → オフ
        } finally {
            restore();
        }

        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        expect(String(mockShowToast.mock.calls[0][0]), "保存できていないことを伝えていない")
            .toMatch(/記憶できない/);
        // **この画面では効かせる**（切ったのに埋まる方が悪い）
        expect((toggle as HTMLInputElement).checked).toBe(false);
    });

    // 逆向き: 入れ直すときは黙る（オンは既定なので、記憶できなくても実害が無い）
    it("入れ直すときは黙る", async () => {
        localStorage.setItem("jp_gps_autofill", "0");
        render(<UploadPage />);
        const toggle = await screen.findByRole("checkbox");
        await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(false));

        const restore = blockWrites();
        try { await userEvent.click(toggle); } finally { restore(); }
        expect(mockShowToast).not.toHaveBeenCalled();
    });

    // 正常系: 書ける端末では何も出さない
    it("書ける端末では何も言わない", async () => {
        render(<UploadPage />);
        const toggle = await screen.findByRole("checkbox");
        await userEvent.click(toggle);

        expect(mockShowToast).not.toHaveBeenCalled();
        expect(localStorage.getItem("jp_gps_autofill")).toBe("0");
    });
});
