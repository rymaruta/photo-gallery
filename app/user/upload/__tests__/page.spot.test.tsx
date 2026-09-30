import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **撮影スポットの画面から来た投稿（`?spot=<slug>`）。**
// スポットの写真一覧は `spotId` でしか拾わないので、ここが送らなければ
// **導線は繋がっているのに写真がその場所に並ばない**（成功して見えるので気づけない）。
// 送ってよいのは、近くで撮った写真の撮影地にスポット名が残っているときだけ。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
const q = vi.hoisted(() => ({ search: "spot=ginzan-onsen" }));
const exif = vi.hoisted(() => ({ meta: {} as Record<string, unknown> }));
const body = vi.hoisted(() => ({ json: null as unknown, ok: true }));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(q.search),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
const mockShowToast = vi.hoisted(() => vi.fn());
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
    extractExifFromFile: vi.fn(async () => exif.meta),
    extractCameraExif: vi.fn(async () => ({})),
    reverseGeocode: vi.fn(async () => "Barcelona, Spain"),
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

const GINZAN = { spotId: "sp_92dc681b0f47", slug: "ginzan-onsen", name: "銀山温泉", coords: { lat: 38.58, lng: 140.53 } };
const fetchMock = vi.fn();

function savedBody(): Record<string, unknown> | null {
    const call = mockUserFetch.mock.calls.find((c) => c[0] === "/upload/save");
    return call ? JSON.parse((call[1] as { body: string }).body) : null;
}

beforeEach(() => {
    q.search = "spot=ginzan-onsen";
    exif.meta = {};
    body.json = GINZAN;
    body.ok = true;
    mockShowToast.mockReset();
    mockPush.mockReset();
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
    fetchMock.mockReset().mockImplementation(async (url: string) => {
        if (String(url).startsWith("/app/data/spots/")) {
            return { ok: body.ok, status: body.ok ? 200 : 404, json: async () => body.json };
        }
        return { ok: true, status: 200 };
    });
    vi.stubGlobal("fetch", fetchMock);
});

async function pick(container: HTMLElement) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "a.jpg", { type: "image/jpeg" }));
}
async function publish() {
    // 逆引きのあいだ（1枚 1.1秒）はボタンの名前が変わるので、長めに待つ
    const btn = await screen.findByRole("button", { name: /投稿する/ }, { timeout: 4000 });
    await waitFor(() => expect(btn).not.toBeDisabled());
    await userEvent.click(btn);
    await waitFor(() => expect(savedBody(), "保存に届いていない").not.toBeNull());
}

describe("アップロード画面: 撮影スポットから来た投稿", () => {
    it("スポット名を帯に出し、撮影地に入れ、保存に spotId を載せる", async () => {
        const { container } = render(<UploadPage />);
        expect((await screen.findByTestId("upload-spot-banner")).textContent).toContain("銀山温泉");
        await pick(container);
        await waitFor(() => expect(screen.getByTestId("upload-spot-banner").textContent).toContain("1枚をスポットに紐付けます"));
        await publish();
        expect(savedBody()!.spotId, "スポットに並ばない（導線だけ繋がっている状態）").toBe(GINZAN.spotId);
        expect(savedBody()!.location).toBe("銀山温泉");
        expect(fetchMock).toHaveBeenCalledWith("/app/data/spots/ginzan-onsen.json");
    });

    it("成功したら、そのスポットの画面へ `?posted=1` を付けて戻す", async () => {
        const { container } = render(<UploadPage />);
        await screen.findByTestId("upload-spot-banner");
        await pick(container);
        await publish();
        await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/spots/ginzan-onsen?posted=1"), { timeout: 3000 });
    });

    it("スポットから離れた場所で撮った写真には付けない（撮影地も逆引きのまま）", async () => {
        exif.meta = { latitude: 41.39, longitude: 2.17 };
        const { container } = render(<UploadPage />);
        await screen.findByTestId("upload-spot-banner");
        await pick(container);
        await waitFor(() => expect(screen.getByTestId("upload-spot-banner").textContent).toContain("1枚中0枚"));
        await publish();
        expect("spotId" in savedBody()!).toBe(false);
        expect(savedBody()!.location).toBe("Barcelona, Spain");
    });

    it("「外す」を押したら付けない", async () => {
        const { container } = render(<UploadPage />);
        await screen.findByTestId("upload-spot-banner");
        await userEvent.click(screen.getByRole("button", { name: /を外す/ }));
        expect(screen.queryByTestId("upload-spot-banner")).toBeNull();
        await pick(container);
        await publish();
        expect("spotId" in savedBody()!).toBe(false);
    });

    it("本文を読めなかったら付けず、そう言う", async () => {
        body.ok = false;
        const { container } = render(<UploadPage />);
        expect((await screen.findByTestId("upload-spot-banner")).textContent).toContain("読み込めませんでした");
        await pick(container);
        await publish();
        expect("spotId" in savedBody()!).toBe(false);
    });

    it("本文の綴りが頼んだものと違えば付けない（別の場所の ID を付けない）", async () => {
        body.json = { ...GINZAN, slug: "yamadera" };
        const { container } = render(<UploadPage />);
        await screen.findByTestId("upload-spot-banner");
        await pick(container);
        await publish();
        expect("spotId" in savedBody()!).toBe(false);
    });

    it("?spot= が無ければ読みに行かず、載せない", async () => {
        q.search = "";
        const { container } = render(<UploadPage />);
        await pick(container);
        await publish();
        expect("spotId" in savedBody()!).toBe(false);
        expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith("/app/data/spots/"))).toBe(false);
        expect(screen.queryByTestId("upload-spot-banner")).toBeNull();
    });
});
