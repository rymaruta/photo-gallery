import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

// 「写真のGPSから撮影地を自動入力」を切っているのに、iOS の共有シート経由
// だけ効いていなかった件（2-4）。
//
// 共有の effect は deps を絞ってあるので、**マウント時の addFiles を掴んだまま**
// 呼ぶ。設定の復元は effect なのでその後に走るため、掴まれた addFiles の中では
// 設定が恒久的に「オン」のままになっていた。
// 漏れるのは逆ジオコーディングで得た**地名**だけだが、それは公開される。

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
    // 「読めた／読めなかった」を分ける口。既存のモックから組み立てる
    readSharedResult: async () => ({ ok: true, payload: await mockReadSharedPayload() }),
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

// 共有シートから渡された1枚。GPS 入りなので、設定がオンなら逆引きが走る。
const sharedFile = () => new File(["x"], "shared.jpg", { type: "image/jpeg" });

beforeEach(() => {
    mockReverseGeocode.mockReset().mockResolvedValue("札幌市");
    mockExtractExif.mockReset().mockResolvedValue({
        dateTimeOriginal: "2024-10-12T09:00:00",
        latitude: 43.06,
        longitude: 141.35,
    });
    mockReadSharedPayload.mockReset().mockResolvedValue({
        files: [sharedFile()], title: "", text: "", t: Date.now(),
    });
    localStorage.clear();
    // ブラウザ環境の穴埋め（プレビュー用の Object URL）
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
        Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
    }
});

describe("共有シート経由の取り込みと GPS 自動入力の設定", () => {
    it("設定を切っていれば、共有経由でも地名を引かない", async () => {
        localStorage.setItem("jp_gps_autofill", "0");
        render(<UploadPage />);

        // 取り込みが走ったこと自体は確かめる（走っていないと下の判定が空振りする）
        await waitFor(() => expect(mockExtractExif).toHaveBeenCalled());
        // 設定はオフなので逆引きはしない
        await waitFor(() => expect(mockReverseGeocode).not.toHaveBeenCalled());
    });

    it("設定が入っていれば、共有経由でも地名を引く（今までの動きを壊していない）", async () => {
        localStorage.setItem("jp_gps_autofill", "1");
        render(<UploadPage />);

        await waitFor(() => expect(mockReverseGeocode).toHaveBeenCalledWith(43.06, 141.35, "ja"));
    });

    it("未設定なら既定でオン", async () => {
        render(<UploadPage />);
        await waitFor(() => expect(mockReverseGeocode).toHaveBeenCalled());
    });

    // 読むのがマウント時1回だけだと、「タブBで切ったのにタブAでは効かない」。
    // タブAで写真を足すと逆ジオコーディングが走り、地名が入って公開される。
    // トグルの見た目もオンのままなので、切ったつもりの人には気づけない。
    //
    // ここで見ているのはチェックボックスの状態だが、設定の反映は
    // applyGpsAutofill が state と ref を**同時に**書くので、
    // 取り込み処理が読む ref もこれで動いている。
    it("別タブで切ったら、こちらの設定も切れる", async () => {
        localStorage.setItem("jp_gps_autofill", "1");
        render(<UploadPage />);
        const box = await screen.findByRole("checkbox");
        await waitFor(() => expect((box as HTMLInputElement).checked).toBe(true));

        // 別タブが切った
        localStorage.setItem("jp_gps_autofill", "0");
        await act(async () => {
            window.dispatchEvent(new StorageEvent("storage", { key: "jp_gps_autofill", newValue: "0" }));
        });

        await waitFor(() => expect((box as HTMLInputElement).checked).toBe(false));
    });

    // 関係ないキーの変更で設定を読み直しても害は無いが、
    // 「storage を購読した」だけで満足しないよう、他のキーでも壊れないことを見る
    it("別のキーの変更では読み直さない", async () => {
        localStorage.setItem("jp_gps_autofill", "1");
        render(<UploadPage />);
        const box = await screen.findByRole("checkbox");
        await waitFor(() => expect((box as HTMLInputElement).checked).toBe(true));

        // 値は変えておくが、知らせるキーは別物。読み直したら false になる
        localStorage.setItem("jp_gps_autofill", "0");
        await act(async () => {
            window.dispatchEvent(new StorageEvent("storage", { key: "jp_other", newValue: "1" }));
        });
        expect((box as HTMLInputElement).checked).toBe(true);
    });
});

// 大きすぎるファイルの警告が、あとから出す非画像の警告に**上書きされて**
// いた。落ちた枚数が伝わらず、利用者は「なぜか1枚少ない」まま公開する。
describe("受け付けなかったファイルの伝え方", () => {
    it("理由が2つあれば両方まとめて出す", async () => {
        const big = new File([new Uint8Array(1)], "でかい.jpg", { type: "image/jpeg" });
        Object.defineProperty(big, "size", { value: 51 * 1024 * 1024 });
        mockReadSharedPayload.mockResolvedValue({
            files: [
                big,
                new File(["x"], "しょるい.pdf", { type: "application/pdf" }),
                new File(["x"], "ふつう.jpg", { type: "image/jpeg" }),
            ],
            title: "", text: "", t: Date.now(),
        });

        render(<UploadPage />);

        const msg = await screen.findByText(/スキップしました/);
        // 片方だけではなく両方の理由が残っている
        expect(msg.textContent).toContain("でかい.jpg");
        expect(msg.textContent).toContain("しょるい.pdf");
        expect(msg.textContent).toContain("2件");
        // 通る1枚は取り込まれている
        await waitFor(() => expect(mockExtractExif).toHaveBeenCalled());
    });
});
