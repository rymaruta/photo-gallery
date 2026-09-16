import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * **黙って切られる上限を、この画面が告げているか。**
 *
 * サーバー（`api-user/src/sanitize.ts`）は、画面に対応物が無い上限を
 * 3つ持っている——タグの件数(30)・**タグ1つの長さ(50)**・説明の文字数(2000)。
 * 欄に `maxLength` は置けない（タグはカンマ区切りの1入力で上限が
 * 「1つあたり」、説明は送る形で上限が変わる）ので、**告げるのが唯一の出口**。
 *
 * 🔴 **この画面の警告には、テストが1本も無かった。** 編集画面
 * （`app/user/edit/__tests__/overLimit.test.ts`）にはあるのに、
 * 同じ判断を持つ2つ目の画面だけ無防備だった——台帳がいちばん多く記録している
 * 「入口が2つあるのに片方だけ」の型。しかも**タグ1つの長さはどちらにも
 * 無かった**（件数だけ見ていた）。
 */

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../components/AddToHomeScreenHint", () => ({ default: () => null }));
vi.mock("../../../../lib/auth/cognito", () => {
    const getCurrentSession = vi.fn(async () => null);
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
vi.mock("../../../../lib/utils/shareStore", () => ({
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
    UnstrippableFileError: class extends Error { },
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
    mockShowToast.mockReset();
    // 一覧の取得は空、presign と保存は成功させる（見たいのは押した直後の警告）
    mockUserFetch.mockReset().mockImplementation((url: string) => {
        if (url === "/upload/presigned-url") {
            return Promise.resolve({
                ok: true,
                json: async () => ({ presignedUrl: "https://s3.example/put", publicUrl: "https://cdn/x.jpg", key: "uploads/me/x.jpg" }),
            });
        }
        return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
        Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
    }
});

/** 写真を1枚選び、共通設定の欄を出す */
async function pickOne() {
    const { container } = render(<UploadPage />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "a.jpg", { type: "image/jpeg" }));
    await screen.findByText(/共通設定/);
}

const tagsField = () => screen.getByPlaceholderText("タグ（カンマ区切り）") as HTMLInputElement;

async function publish() {
    const btn = await screen.findByRole("button", { name: /枚を公開/ });
    await waitFor(() => expect(btn).not.toBeDisabled());
    await userEvent.click(btn);
}

const warnings = () => mockShowToast.mock.calls.filter((c) => c[1] === "error").map((c) => String(c[0]));

describe("アップロード画面: 黙って切られる上限を告げる", () => {
    // 🔴 これが足りていなかった分
    it("51字のタグで「タグ1つは50字まで」と言う", async () => {
        await pickOne();
        await userEvent.type(tagsField(), "a".repeat(51));
        await publish();
        await waitFor(() => expect(warnings().join(" / "), "黙って切られている").toMatch(/タグ1つは50字までです（51字）/));
    });

    it("50字ちょうどなら言わない", async () => {
        await pickOne();
        await userEvent.type(tagsField(), "a".repeat(50));
        await publish();
        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        expect(warnings().join(" / "), "正当な入力を断っている").not.toMatch(/タグ1つ/);
    });

    // 前から在った側。**同じ画面の対なので一緒に縛る**（片方だけ直す型を避ける）
    it("31個のタグで「タグは30個まで」と言う", async () => {
        await pickOne();
        await userEvent.type(tagsField(), Array.from({ length: 31 }, (_, i) => `t${i}`).join(","));
        await publish();
        await waitFor(() => expect(warnings().join(" / ")).toMatch(/タグは30個までです（31個）/));
    });

    it("30個ちょうどなら言わない", async () => {
        await pickOne();
        await userEvent.type(tagsField(), Array.from({ length: 30 }, (_, i) => `t${i}`).join(","));
        await publish();
        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        expect(warnings().join(" / ")).not.toMatch(/タグは30個/);
    });

    it("上限に触れなければ、上限の話は1つも出さない", async () => {
        await pickOne();
        await userEvent.type(tagsField(), "夜景, 街");
        await publish();
        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        expect(warnings().join(" / ")).not.toMatch(/超えた分は保存されません/);
    });
});
