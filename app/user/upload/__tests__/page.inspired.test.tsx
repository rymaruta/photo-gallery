import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **「この写真を見て撮りに行く」から来た投稿（`?inspiredBy=<写真ID>`）。**
// 写真の詳細のボタンは投稿画面へ元の写真の ID を渡す。ここが読まなければ
// **ボタンを押しても何も付かない**（投稿は成功して見えるので気づけない）。
// 付けるのは、公開で全員に見せている他人の写真だけ。載せるのは投稿のうち1枚だけ。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
const q = vi.hoisted(() => ({ search: "inspiredBy=src-1" }));
const mockPublicFetch = vi.hoisted(() => vi.fn());
const exif = vi.hoisted(() => ({ meta: {} as Record<string, unknown>, gate: null as Promise<void> | null }));
const source = vi.hoisted(() => ({ json: null as unknown, ok: true }));
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
    publicFetch: (...a: unknown[]) => mockPublicFetch(...a),
    readApiError: async (_r: Response, f: string) => f,
}));

const UploadPage = (await import("../page")).default;

const SOURCE = {
    id: "src-1", src: "https://cdn.example.com/uploads/alice/a.webp", title: "朝の湖", location: "銀山温泉",
    userId: "alice", displayName: "アリス",
};

function saveBodies(): Record<string, unknown>[] {
    return mockUserFetch.mock.calls.filter((c) => c[0] === "/upload/save")
        .map((c) => JSON.parse((c[1] as { body: string }).body));
}
function savedBody(): Record<string, unknown> | null {
    return saveBodies()[0] ?? null;
}

const saveReply = vi.hoisted(() => ({ photo: { inspiredBy: "src-1" } as Record<string, unknown> | undefined }));

beforeEach(() => {
    q.search = "inspiredBy=src-1";
    exif.meta = {};
    exif.gate = null;
    source.json = SOURCE;
    source.ok = true;
    saveReply.photo = { inspiredBy: "src-1" };
    auth.userId = "bob";
    share.payload = null;
    draft.read.mockReset().mockResolvedValue(null);
    mockShowToast.mockReset();
    mockPush.mockReset();
    mockPublicFetch.mockReset().mockImplementation(async () => ({
        ok: source.ok, status: source.ok ? 200 : 404, json: async () => source.json,
    }));
    let n = 0;
    mockUserFetch.mockReset().mockImplementation((url: string) => {
        if (url === "/user/photos") return Promise.resolve({ ok: true, json: async () => [] });
        if (url === "/upload/presigned-url") {
            n++;
            return Promise.resolve({
                ok: true,
                json: async () => ({ presignedUrl: "https://s3/put", publicUrl: `https://cdn/uploads/me/${n}.jpg`, key: `uploads/me/${n}.jpg` }),
            });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, photo: saveReply.photo }) });
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
});

async function pick(container: HTMLElement, count = 1) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const files = Array.from({ length: count }, (_, i) => new File(["x"], `a${i}.jpg`, { type: "image/jpeg" }));
    await userEvent.upload(input, files);
}
async function publish() {
    const btn = await screen.findByRole("button", { name: /投稿する/ }, { timeout: 4000 });
    await waitFor(() => expect(btn).not.toBeDisabled());
    await userEvent.click(btn);
    await waitFor(() => expect(savedBody(), "保存に届いていない").not.toBeNull());
}

describe("アップロード画面: この写真を見て撮影（?inspiredBy=）", () => {
    it("元の写真を公開の口で読み、題・撮影地・作者の札を出し、保存に inspiredBy を載せる", async () => {
        const { container } = render(<UploadPage />);
        const card = await screen.findByTestId("upload-inspired");
        expect(card.textContent).toContain("この写真を見て撮影");
        expect(card.textContent).toContain("朝の湖");
        expect(card.textContent).toContain("銀山温泉");
        expect(card.textContent).toContain("アリス");
        expect(mockPublicFetch).toHaveBeenCalledWith("/photos/src-1");
        await pick(container);
        await publish();
        expect(savedBody()!.inspiredBy, "ボタンを押しても何も付かない").toBe("src-1");
    });

    it("「外す」を押したら付けない", async () => {
        const { container } = render(<UploadPage />);
        await screen.findByTestId("upload-inspired");
        await userEvent.click(screen.getByRole("button", { name: "元の写真を外す" }));
        expect(screen.queryByTestId("upload-inspired")).toBeNull();
        await pick(container);
        await publish();
        expect("inspiredBy" in savedBody()!).toBe(false);
    });

    it("自分の写真なら札を出さず、付けない", async () => {
        auth.userId = "alice";
        const { container } = render(<UploadPage />);
        await waitFor(() => expect(mockPublicFetch).toHaveBeenCalled());
        await pick(container);
        await publish();
        expect(screen.queryByTestId("upload-inspired")).toBeNull();
        expect("inspiredBy" in savedBody()!).toBe(false);
    });

    it.each([
        ["読めない（404＝非公開・削除）", () => { source.ok = false; }],
        ["公開範囲を絞った写真", () => { source.json = { ...SOURCE, audience: "followers" }; }],
    ])("%s なら札を出さず、付けない", async (_n, arrange) => {
        arrange();
        const { container } = render(<UploadPage />);
        await waitFor(() => expect(mockPublicFetch).toHaveBeenCalled());
        await pick(container);
        await publish();
        expect(screen.queryByTestId("upload-inspired")).toBeNull();
        expect("inspiredBy" in savedBody()!).toBe(false);
    });

    it("形の合わない ID は読みにも行かない", async () => {
        q.search = "inspiredBy=" + encodeURIComponent("notifs#x");
        const { container } = render(<UploadPage />);
        await pick(container);
        await publish();
        expect(mockPublicFetch).not.toHaveBeenCalled();
        expect("inspiredBy" in savedBody()!).toBe(false);
    });

    it("2枚を別々に投稿しても、載せるのは1枚目だけ（元の作者に通知が2回届かない）", async () => {
        const { container } = render(<UploadPage />);
        await screen.findByTestId("upload-inspired");
        await pick(container, 2);
        await publish();
        await waitFor(() => expect(saveBodies()).toHaveLength(2), { timeout: 4000 });
        expect(saveBodies().map((b) => b.inspiredBy)).toEqual(["src-1", undefined]);
    });

    it("送ったのに付かなかったら（応答の写真に無い）、投稿はできたがそう言う", async () => {
        saveReply.photo = { id: "new" };
        const { container } = render(<UploadPage />);
        await screen.findByTestId("upload-inspired");
        await pick(container);
        await publish();
        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining("元の写真は付けられませんでした"), "info"));
    });
});
