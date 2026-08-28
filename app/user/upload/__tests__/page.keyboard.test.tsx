import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// キーボードだけで写真を選べなかった件。
//
// ファイル入力を `className="hidden"`（= display:none）にしていたので、
// その input は**フォーカスできない**。`<label>` 自体もタブ順に入らないので、
// Tab を押し続けても「タップして写真を選ぶ」にも「写真を撮る」にも止まらず、
// **このページでは何もできなかった**（ドロップも貼り付けも ref.click() も無い）。
//
// jsdom は Tailwind のクラスを解決しないので display を測れない。
// 代わりに「display:none にしない」「ラベルと結ばれている」という、
// その挙動を担っている不変条件を見る。

const mockReverseGeocode = vi.hoisted(() => vi.fn());
const mockReadSharedPayload = vi.hoisted(() => vi.fn());
const mockExtractExif = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(""),
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

beforeEach(() => {
    mockReverseGeocode.mockReset().mockResolvedValue("札幌市");
    mockExtractExif.mockReset().mockResolvedValue({
        dateTimeOriginal: "2024-10-12T09:00:00",
        latitude: 43.06,
        longitude: 141.35,
    });
    mockReadSharedPayload.mockReset().mockResolvedValue(null);
    localStorage.clear();
    // ブラウザ環境の穴埋め（プレビュー用の Object URL）
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
        Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
    }
});


describe("アップロード: キーボードで写真を選べる", () => {
    const fileInputs = (c: HTMLElement) => Array.from(c.querySelectorAll('input[type="file"]'));

    it("ファイル入力を display:none にしない（フォーカスできなくなる）", async () => {
        const { container } = render(<UploadPage />);
        await screen.findByRole("checkbox");   // 描画が終わるまで待つ

        const inputs = fileInputs(container);
        expect(inputs.length).toBeGreaterThan(0);
        for (const el of inputs) {
            // `hidden` は display:none。`sr-only` は見えないがフォーカスできる
            expect(el.className.split(/\s+/)).not.toContain("hidden");
            expect(el.className.split(/\s+/)).toContain("sr-only");
        }
    });

    it("どのファイル入力もラベルと結ばれている（押す手段がある）", async () => {
        const { container } = render(<UploadPage />);
        await screen.findByRole("checkbox");

        for (const el of fileInputs(container)) {
            const byFor = el.id ? container.querySelector(`label[for="${el.id}"]`) : null;
            const wrapped = el.closest("label");
            expect(byFor ?? wrapped).not.toBeNull();
        }
    });

    // 見えない入力にフォーカスが移ったとき、どこにいるか分かるようにする
    it("入力を包むラベルが focus-within で見た目を変える", async () => {
        const { container } = render(<UploadPage />);
        await screen.findByRole("checkbox");

        for (const el of fileInputs(container)) {
            const label = (el.id ? container.querySelector(`label[for="${el.id}"]`) : null) ?? el.closest("label");
            const holder = label?.className.includes("focus-within")
                ? label
                : label?.querySelector('[class*="focus-within"]');
            expect(holder, `focus-within が無い: ${el.id || "(id なし)"}`).toBeTruthy();
        }
    });
});
