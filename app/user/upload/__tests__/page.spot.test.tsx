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

function savedBody(): Record<string, unknown> | null {
    const call = mockUserFetch.mock.calls.find((c) => c[0] === "/upload/save");
    return call ? JSON.parse((call[1] as { body: string }).body) : null;
}

beforeEach(() => {
    q.search = "spot=ginzan-onsen";
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

    /** 手で開ける門（先に届く側を決める） */
    function gate(): { promise: Promise<void>; open: () => void } {
        let open = () => {};
        const promise = new Promise<void>((r) => { open = r; });
        return { promise, open };
    }

    // 🔴 レビュー F1: **スポットが EXIF より先に届いても、離れた写真の撮影地をスポット名にしない。**
    // 読む前の写真は位置が「まだ分からない」だけで、「位置が無い＝近い」ではない
    it("写真を先に選び、EXIF を読む前にスポットが届いても、離れた写真はスポット名にしない", async () => {
        const e = gate(); const b = gate();
        exif.gate = e.promise; body.gate = b.promise;
        exif.meta = { latitude: 41.39, longitude: 2.17 };
        const { container } = render(<UploadPage />);
        await pick(container);
        b.open();
        await screen.findByTestId("upload-spot-banner");
        e.open();
        await publish();
        expect(savedBody()!.location, "離れた写真の撮影地がスポット名になった").toBe("Barcelona, Spain");
        expect("spotId" in savedBody()!).toBe(false);
    });

    it("EXIF を読み終えてからスポットが届いたら、近い（位置の無い）写真にスポット名を入れて紐付ける", async () => {
        const b = gate();
        body.gate = b.promise;
        const { container } = render(<UploadPage />);
        await pick(container);
        // **EXIF を読み終えた（投稿できる）状態になってから門を開ける**——
        // ボタンは写真を選ぶ前から（押せないまま）在るので、在るだけでは順序が保証されない
        const btn = await screen.findByRole("button", { name: /投稿する/ });
        await waitFor(() => expect(btn).not.toBeDisabled());
        expect(screen.queryByTestId("upload-spot-banner"), "スポットが先に届いている（順序が崩れた）").toBeNull();
        b.open();
        await waitFor(() => expect(screen.getByTestId("upload-spot-banner").textContent).toContain("1枚をスポットに紐付けます"));
        await publish();
        expect(savedBody()!.location).toBe("銀山温泉");
        expect(savedBody()!.spotId).toBe(GINZAN.spotId);
    });

    // レビュー F2: 下書きから戻した写真は、このスポットから来たとは限らない
    it("下書きから戻した写真には、スポット名を入れない（紐付けない）", async () => {
        auth.userId = "me";
        draft.read.mockResolvedValue({
            category: "", tags: "", asOnePost: false, audience: "everyone",
            items: [{ file: new File(["x"], "old.jpg", { type: "image/jpeg" }), title: "", description: "", location: "" }],
        });
        render(<UploadPage />);
        await screen.findByTestId("upload-spot-banner");
        await waitFor(() => expect(screen.getByTestId("upload-spot-banner").textContent).toContain("1枚中0枚"));
        await publish();
        expect("spotId" in savedBody()!).toBe(false);
        expect(savedBody()!.location ?? "").toBe("");
    });

    // レビュー F4: 絞った写真はウェブサイトに載らない。「この一覧に並びます」の画面へ送らない
    it("フォロワーのみに絞った投稿は、スポットの画面へ戻さない", async () => {
        const { container } = render(<UploadPage />);
        await screen.findByTestId("upload-spot-banner");
        await pick(container);
        await userEvent.click(screen.getByRole("radio", { name: /フォロワーのみ/ }));
        await publish();
        expect(savedBody()!.spotId).toBe(GINZAN.spotId);
        await waitFor(() => expect(mockPush).toHaveBeenCalled(), { timeout: 3000 });
        expect(mockPush).not.toHaveBeenCalledWith("/spots/ginzan-onsen?posted=1");
    });

    // レビュー B: 共有シートの受け皿から取り込んだ写真は、このスポットの画面で選んだとは限らない
    it("共有シートから取り込んだ写真には、スポット名を入れない", async () => {
        share.payload = { files: [new File(["x"], "shared.jpg", { type: "image/jpeg" })], t: Date.now() };
        render(<UploadPage />);
        await screen.findByTestId("upload-spot-banner");
        await waitFor(() => expect(screen.getByTestId("upload-spot-banner").textContent).toContain("1枚中0枚"));
        await publish();
        expect("spotId" in savedBody()!).toBe(false);
    });

    // レビュー A: 別の人に入れ替わったら、前の人の「紐付けて公開した」印を持ち越さない
    it("アカウントが入れ替わったら、前の人の公開の印でスポットの画面へ送らない", async () => {
        auth.userId = "a";
        let failOnce = true;
        const base = mockUserFetch.getMockImplementation()!;
        mockUserFetch.mockImplementation((url: string, init?: unknown) => {
            // A の2枚目の保存だけ失敗させる（1枚目は紐付いて成功・遷移しない）
            if (url === "/upload/save" && mockUserFetch.mock.calls.filter((c) => c[0] === "/upload/save").length === 2 && failOnce) {
                failOnce = false;
                return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
            }
            return base(url, init);
        });
        const { container, rerender } = render(<UploadPage />);
        await screen.findByTestId("upload-spot-banner");
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, [new File(["x"], "a1.jpg", { type: "image/jpeg" }), new File(["y"], "a2.jpg", { type: "image/jpeg" })]);
        await publish();
        await waitFor(() => expect(mockUserFetch.mock.calls.filter((c) => c[0] === "/upload/save").length).toBe(2));
        await new Promise((r) => setTimeout(r, 1700));
        expect(mockPush, "1件失敗したのに遷移した").not.toHaveBeenCalled();

        // B に入れ替わる → 遠い写真を上げる
        auth.userId = "b";
        rerender(<UploadPage />);
        exif.meta = { latitude: 41.39, longitude: 2.17 };
        await waitFor(() => expect(container.querySelectorAll("img").length).toBe(0));
        await userEvent.upload(container.querySelector('input[type="file"]') as HTMLInputElement, new File(["z"], "b.jpg", { type: "image/jpeg" }));
        const btn = await screen.findByRole("button", { name: /投稿する/ }, { timeout: 4000 });
        await waitFor(() => expect(btn).not.toBeDisabled(), { timeout: 4000 });
        await userEvent.click(btn);
        await waitFor(() => expect(mockPush).toHaveBeenCalled(), { timeout: 4000 });
        expect(mockPush).not.toHaveBeenCalledWith("/spots/ginzan-onsen?posted=1");
    });
});
