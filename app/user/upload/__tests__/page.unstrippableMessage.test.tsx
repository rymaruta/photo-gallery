import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **断る理由が増えたのに、文言は「形式」のままだった。**
//
// 呼び出し元は `UnstrippableFileError` を全部「この形式は安全にアップロード
// できません。JPEG か PNG で保存し直してください」に潰していた。ところが
// 「デコードできない」「画素が多すぎる」場合は**形式は正しい JPEG** なので、
// 言われたとおりに保存し直しても同じ結果になる（袋小路）。理由ごとに書く。

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
// **`lookupSession` も模す。** `userFetch` はこちらでトークンを引く
// （`getCurrentSession` だけ差し替えても入口を支配できない）。
// 同じ答えを包んだ形にして、このファイルが守っている性質は変えない
vi.mock("../../../../lib/auth/cognito", () => {
    const getCurrentSession = vi.fn(async () => null);
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
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
    UnstrippableFileError: class extends Error {
        constructor(public fileType: string, public reason = "format") { super("unstrippable"); }
    },
    extractDominantColor: vi.fn(async () => null),
    createBlurPlaceholder: vi.fn(async () => null),
    AVATAR_MAX_PX: 512,
}));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: mockUserFetch,
    readApiError: async (_r: Response, f: string) => f,
}));

const UploadPage = (await import("../page")).default;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const img: any = await import("../../../../lib/utils/image");

beforeEach(() => {
    authState.current = { isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false };
    mockUserFetch.mockReset();
    mockUserFetch.mockResolvedValue({ ok: true, json: async () => [] });
    img.toUploadSafeFile.mockReset();
});

async function publishOne() {
    const { container } = render(<UploadPage />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "a.jpg", { type: "image/jpeg" }));
    const publish = await screen.findByRole("button", { name: /投稿する/ });
    await waitFor(() => expect(publish).not.toBeDisabled());
    await userEvent.click(publish);
}

describe("上げられない理由ごとに文言を書き分ける", () => {
    it.each([
        ["デコードできない", "undecodable", /開けませんでした/],
        ["画素が多すぎる", "too-many-pixels", /画素数が多すぎて/],
        ["形式（従来どおり）", "format", /この形式は安全にアップロードできません/],
    ])("%s", async (_name, reason, expected) => {
        img.toUploadSafeFile.mockImplementation(async () => {
            throw new img.UnstrippableFileError("image/jpeg", reason);
        });
        await publishOne();
        expect(await screen.findByText(expected),
            "理由が伝わらない（同じことをやり直すしかない）").toBeInTheDocument();
    });
});
