import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **共同アルバム（案C）の受け取り側。**
// 招待ページの「写真を追加する」は `?album=<id>` を付けて送ってくる。
// ここが読んでいないと、**導線は繋がっているのに写真がアルバムに入らない**
// （画面上は成功して見えるので、気づけない壊れ方）。
//
// 権限の判断はしていない——メンバーでなければサーバーが 404 で断る。
// ここは「どこに入れるつもりか」を運ぶだけ。

const mockUserFetch = vi.hoisted(() => vi.fn());
const q = vi.hoisted(() => ({ search: "album=alb-1" }));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(q.search),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
const mockShowToast = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../components/AddToHomeScreenHint", () => ({ default: () => null }));
// `userFetch` はこちらでトークンを引く（`getCurrentSession` だけ差し替えても
// 入口を支配できない）。page.quota.test.tsx と同じ形
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
    UnstrippableFileError: class extends Error {},
    extractDominantColor: vi.fn(async () => null),
    createBlurPlaceholder: vi.fn(async () => null),
    AVATAR_MAX_PX: 512,
}));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    readApiError: async (_r: Response, f: string) => f,
}));

const UploadPage = (await import("../page")).default;

/** `/upload/save` に送った本文 */
function savedBody(): Record<string, unknown> | null {
    const call = mockUserFetch.mock.calls.find((c) => c[0] === "/upload/save");
    return call ? JSON.parse((call[1] as { body: string }).body) : null;
}

beforeEach(() => {
    q.search = "album=alb-1";
    mockShowToast.mockReset();
    mockUserFetch.mockReset().mockImplementation((url: string) => {
        if (url === "/user/photos") return Promise.resolve({ ok: true, json: async () => [] });
        if (url === "/upload/presigned-url") {
            return Promise.resolve({
                ok: true,
                json: async () => ({ presignedUrl: "https://s3/put", publicUrl: "https://cdn/uploads/me/a.jpg", key: "uploads/me/a.jpg" }),
            });
        }
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
});

async function uploadOne(container: HTMLElement) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "a.jpg", { type: "image/jpeg" }));
    const publish = await screen.findByRole("button", { name: /枚を公開/ });
    await waitFor(() => expect(publish).not.toBeDisabled());
    await userEvent.click(publish);
    await waitFor(() => expect(savedBody(), "保存に届いていない").not.toBeNull());
}

describe("アップロード画面: 共同アルバム", () => {
    it("?album= が付いていれば、保存に albumId を載せる", async () => {
        const { container } = render(<UploadPage />);
        await uploadOne(container);
        expect(savedBody()!.albumId, "アルバムに入らない（導線だけ繋がっている状態）").toBe("alb-1");
    });

    // 通常の投稿に余計なものを載せない
    it("?album= が無ければ載せない", async () => {
        q.search = "";
        const { container } = render(<UploadPage />);
        await uploadOne(container);
        expect("albumId" in savedBody()!).toBe(false);
    });

    it("空の ?album= は載せない", async () => {
        q.search = "album=";
        const { container } = render(<UploadPage />);
        await uploadOne(container);
        expect("albumId" in savedBody()!).toBe(false);
    });
});
