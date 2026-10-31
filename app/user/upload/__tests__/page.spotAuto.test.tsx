import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **投稿で撮影スポットを自動で選ぶ**（2026-10-31 判断・journey.photo-ios#425・`lib/utils/spotUploadAuto.ts`）。
// 撮影地・題・説明と位置から、静的な生成と同じ決まりで撮影スポットを1つ選んだ状態にし、
// 保存で `spotId` を書く。本人が切り替えで外したら `spotAuto: "off"` を書く
// （書かないと、あとで静的な生成が同じ決まりで結び直す）。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
const q = vi.hoisted(() => ({ search: "" }));
const exif = vi.hoisted(() => ({ meta: {} as Record<string, unknown>, gate: null as Promise<void> | null }));
const body = vi.hoisted(() => ({ json: null as unknown, ok: true, gate: null as Promise<void> | null }));
const auth = vi.hoisted(() => ({ userId: null as string | null }));
const draft = vi.hoisted(() => ({ read: vi.fn<(uid: string) => Promise<unknown>>(async () => null) }));
vi.mock("../../../../lib/utils/uploadDraft", () => ({
    saveUploadDraft: async () => undefined,
    readUploadDraft: (uid: string) => draft.read(uid),
    clearUploadDraft: async () => undefined,
    allowUploadDraft: () => undefined,
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(q.search),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false, userId: auth.userId }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
const mockShowToast = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../components/AddToHomeScreenHint", () => ({ default: () => null }));
vi.mock("../../../../lib/auth/cognito", () => {
    const getCurrentSession = vi.fn(async () => null);
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
const share = vi.hoisted(() => ({ payload: null as unknown }));
vi.mock("../../../../lib/utils/shareStore", () => ({
    readSharedResult: vi.fn(async () => ({ ok: true, payload: share.payload })),
    clearSharedPayload: vi.fn(async () => { share.payload = null; }),
}));
vi.mock("../../../../lib/utils/exif", () => ({
    extractExifFromFile: vi.fn(async () => { if (exif.gate) await exif.gate; return exif.meta; }),
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
const FOX_ID = "sp_000000000001";
/** 投稿画面が読む索引（`/app/data/spot-match.json`）の小さな版 */
const INDEX = {
    v: 1,
    spots: [{ i: FOX_ID, d: "蔵王キツネ村", n: "蔵王キツネ村", c: [38.02, 140.55], p: "宮城県" }],
    regions: ["宮城県", "白石市", "日本", "東京", "東京都"],
};

function savedBody(): Record<string, unknown> | null {
    const call = mockUserFetch.mock.calls.find((c) => c[0] === "/upload/save");
    return call ? JSON.parse((call[1] as { body: string }).body) : null;
}

beforeEach(() => {
    q.search = "";
    exif.meta = {};
    exif.gate = null;
    body.json = GINZAN;
    body.ok = true;
    body.gate = null;
    auth.userId = null;
    share.payload = null;
    draft.read.mockReset().mockResolvedValue(null);
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
        if (String(url) === "/app/data/spot-match.json") {
            return { ok: true, status: 200, json: async () => INDEX };
        }
        if (String(url).startsWith("/app/data/spots/")) {
            if (body.gate) await body.gate;
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

async function typePlace(text: string) {
    const input = await screen.findByLabelText("1枚目の位置情報（任意）");
    await userEvent.clear(input);
    await userEvent.type(input, text);
}

describe("アップロード画面: 撮影スポットを自動で選ぶ", () => {
    it("撮影地に撮影スポットの名前があれば選んだ状態にし、保存に spotId を載せる", async () => {
        const { container } = render(<UploadPage />);
        await pick(container);
        await typePlace("蔵王キツネ村");
        const card = await screen.findByTestId("upload-auto-spot");
        expect(card.textContent).toContain("撮影スポット「蔵王キツネ村」に結ぶ");
        expect(screen.getByRole("switch", { name: "撮影スポット「蔵王キツネ村」に結ぶ" }).getAttribute("aria-checked")).toBe("true");
        await publish();
        expect(savedBody()!.spotId).toBe(FOX_ID);
        expect("spotAuto" in savedBody()!).toBe(false);
    });

    it("切り替えで外したら spotId を送らず、外した印（spotAuto: off）を送る", async () => {
        const { container } = render(<UploadPage />);
        await pick(container);
        await typePlace("蔵王キツネ村");
        const sw = await screen.findByRole("switch", { name: "撮影スポット「蔵王キツネ村」に結ぶ" });
        await userEvent.click(sw);
        expect(sw.getAttribute("aria-checked")).toBe("false");
        expect(screen.getByTestId("upload-auto-spot").textContent).toContain("撮影スポットには結ばずに投稿します");
        await publish();
        expect("spotId" in savedBody()!).toBe(false);
        expect(savedBody()!.spotAuto).toBe("off");
    });

    it("当たる撮影スポットが無ければ何も出さず、何も送らない", async () => {
        const { container } = render(<UploadPage />);
        await pick(container);
        await typePlace("東京");
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/app/data/spot-match.json"));
        // 索引が届いて描き直されるのを待ってから見る（届く前の「出ていない」で通らないように）
        await new Promise((r) => setTimeout(r, 100));
        expect(screen.queryByTestId("upload-auto-spot")).toBeNull();
        await publish();
        expect("spotId" in savedBody()!).toBe(false);
        expect("spotAuto" in savedBody()!).toBe(false);
    });

    it("写真の位置が 5km より離れていれば選ばない", async () => {
        exif.meta = { latitude: 38.2, longitude: 140.55 };
        const { container } = render(<UploadPage />);
        await pick(container);
        await typePlace("蔵王キツネ村");
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/app/data/spot-match.json"));
        // 索引が届いて描き直されるのを待ってから見る（届く前の「出ていない」で通らないように）
        await new Promise((r) => setTimeout(r, 100));
        expect(screen.queryByTestId("upload-auto-spot")).toBeNull();
    });
});
