import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **書きかけを端末に控えて戻す**（docs/ios-bug-audit-2026-09-25.md #8）。
// iOS はバックグラウンドのページを黙って捨てるので、カメラや別のアプリから
// 戻ると読み込み直しになり、選んだ写真も打った題名も消えていた。

const mockUserFetch = vi.hoisted(() => vi.fn());
const q = vi.hoisted(() => ({ search: "" }));
const auth = vi.hoisted(() => ({ loading: false, userId: "me" as string | null }));
const draft = vi.hoisted(() => ({
    save: vi.fn<(d: unknown) => Promise<undefined>>(async () => undefined),
    read: vi.fn<(uid: string) => Promise<unknown>>(async () => null),
    clear: vi.fn(async () => undefined),
}));
vi.mock("../../../../lib/utils/uploadDraft", () => ({
    saveUploadDraft: (d: unknown) => draft.save(d),
    readUploadDraft: (uid: string) => draft.read(uid),
    clearUploadDraft: () => draft.clear(),
    allowUploadDraft: () => undefined,
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(q.search),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: auth.userId !== null, isAdminUser: false, isGeneralUser: true, loading: auth.loading, userId: auth.userId }),
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
    q.search = "";
    auth.loading = false;
    auth.userId = "me";
    draft.save.mockClear(); draft.read.mockReset().mockResolvedValue(null); draft.clear.mockClear();
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
    const publish = await screen.findByRole("button", { name: /投稿する/ });
    await waitFor(() => expect(publish).not.toBeDisabled());
    await userEvent.click(publish);
    await waitFor(() => expect(savedBody(), "保存に届いていない").not.toBeNull());
}

const hide = () => act(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
});
/** 控えを戻す判断が済むまで待つ（済むまでは書かない・消さない） */
const ready = async () => {
    await waitFor(() => expect(draft.read).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
afterEach(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

describe("アップロード画面: 書きかけの控え", () => {
    it("画面が隠れたら、まだ上げていない写真と入力を控える", async () => {
        const { container } = render(<UploadPage />);
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File(["x"], "IMG_0001.jpg", { type: "image/jpeg" }));
        await userEvent.type(screen.getByPlaceholderText("タグ（カンマ区切り）"), "桜");
        hide();
        await waitFor(() => expect(draft.save).toHaveBeenCalled());
        const saved = draft.save.mock.calls.at(-1)![0] as { items: { file: File }[]; tags: string };
        expect(saved.items).toHaveLength(1);
        expect(saved.items[0].file.name).toBe("IMG_0001.jpg");
        expect(saved.tags).toBe("桜");
    });

    it("写真が無いときに隠れたら、控えを消す", async () => {
        render(<UploadPage />);
        await ready();
        hide();
        await waitFor(() => expect(draft.clear).toHaveBeenCalled());
        expect(draft.save).not.toHaveBeenCalled();
    });

    it("開いたときに控えがあれば戻して、そう伝える", async () => {
        draft.read.mockResolvedValue({
            t: Date.now(), userId: "me", category: "", tags: "海", asOnePost: false,
            items: [{ file: new File(["x"], "IMG_0002.jpg", { type: "image/jpeg" }), title: "夕焼け", description: "", location: "" }],
        });
        render(<UploadPage />);
        await waitFor(() => expect(mockShowToast.mock.calls.some((c) => String(c[0]).includes("書きかけを戻しました"))).toBe(true));
        expect((screen.getByPlaceholderText("タグ（カンマ区切り）") as HTMLInputElement).value).toBe("海");
        expect(screen.getByDisplayValue("夕焼け")).toBeTruthy();
    });

    it("控えは自分のもの（userId）として保存し、読むときも自分の分だけを頼む", async () => {
        const { container } = render(<UploadPage />);
        await waitFor(() => expect(draft.read).toHaveBeenCalledWith("me"));
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File(["x"], "IMG_0001.jpg", { type: "image/jpeg" }));
        hide();
        await waitFor(() => expect(draft.save).toHaveBeenCalled());
        expect((draft.save.mock.calls.at(-1)![0] as { userId: string }).userId).toBe("me");
    });

    it("画面の中の移動で離れるときも、今の状態で書き直す（外した写真を次に戻さない）", async () => {
        const { unmount } = render(<UploadPage />);
        await ready();
        draft.clear.mockClear();
        unmount();
        await waitFor(() => expect(draft.clear, "写真が無いまま離れたのに、古い控えが残る").toHaveBeenCalled());
    });

    it("ログインの確認中（戻す前）に隠れても、控えを消さない", async () => {
        auth.loading = true;
        render(<UploadPage />);
        hide();
        await new Promise((r) => setTimeout(r, 30));
        expect(draft.clear, "戻す前の控えを消した").not.toHaveBeenCalled();
        expect(draft.save).not.toHaveBeenCalled();
    });

    it("全部上げ終わったら控えを消す", async () => {
        const { container } = render(<UploadPage />);
        await uploadOne(container);
        await waitFor(() => expect(draft.clear).toHaveBeenCalled());
    });
});

describe("アップロード画面: 書きかけの控え（7d2ea8f のレビュー）", () => {
    it("セッションが切れて写真を守っている間に隠れても、控えを消さずに残す", async () => {
        const { container, rerender } = render(<UploadPage />);
        await ready();
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File(["x"], "IMG_0001.jpg", { type: "image/jpeg" }));
        // セッションが切れた（ログアウトは通っていない）
        auth.userId = null;
        rerender(<UploadPage />);
        draft.clear.mockClear(); draft.save.mockClear();
        hide();
        await waitFor(() => expect(draft.save, "守っている写真の控えを書いていない").toHaveBeenCalled());
        expect(draft.clear).not.toHaveBeenCalled();
        expect((draft.save.mock.calls.at(-1)![0] as { userId: string }).userId).toBe("me");
    });

    it("上げ始めたら控えを消し、一部だけ失敗したら残り（失敗した写真）で書き直す", async () => {
        mockUserFetch.mockImplementation((url: string) => {
            if (url === "/user/photos") return Promise.resolve({ ok: true, json: async () => [] });
            if (url === "/upload/presigned-url") {
                return Promise.resolve({ ok: true, json: async () => ({ presignedUrl: "https://s3/put", publicUrl: "https://cdn/uploads/me/a.jpg", key: "uploads/me/a.jpg" }) });
            }
            return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
        });
        // 2枚目の S3 への PUT だけ失敗させる
        let puts = 0;
        vi.stubGlobal("fetch", vi.fn(async () => (++puts === 2 ? { ok: false, status: 500 } : { ok: true, status: 200 })));
        const { container } = render(<UploadPage />);
        await ready();
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, [
            new File(["x"], "a.jpg", { type: "image/jpeg" }),
            new File(["y"], "b.jpg", { type: "image/jpeg" }),
        ]);
        const publish = await screen.findByRole("button", { name: /投稿する|アップロード/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        draft.clear.mockClear(); draft.save.mockClear();
        await userEvent.click(publish);
        await waitFor(() => expect(draft.clear, "上げ始めても古い控えが残っている").toHaveBeenCalled());
        await waitFor(() => expect(draft.save, "上げ終わっても書き直していない").toHaveBeenCalled());
        const names = (draft.save.mock.calls.at(-1)![0] as { items: { file: File }[] }).items.map((i) => i.file.name);
        expect(names.length, "公開済みの写真まで控えに残っている").toBe(1);
    });
});

describe("アップロード画面: 書きかけの控え（76f7c7b のレビュー）", () => {
    it("S3 まで上がって保存で落ちた写真は、置き場所ごと控える", async () => {
        mockUserFetch.mockImplementation((url: string) => {
            if (url === "/user/photos") return Promise.resolve({ ok: true, json: async () => [] });
            if (url === "/upload/presigned-url") {
                return Promise.resolve({ ok: true, json: async () => ({ presignedUrl: "https://s3/put", publicUrl: "https://cdn/uploads/me/a.jpg", key: "uploads/me/a.jpg" }) });
            }
            if (url === "/upload/save") return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
            return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
        });
        const { container } = render(<UploadPage />);
        await ready();
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File(["x"], "a.jpg", { type: "image/jpeg" }));
        const publish = await screen.findByRole("button", { name: /投稿する|アップロード/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        draft.save.mockClear();
        await userEvent.click(publish);
        await waitFor(() => expect(draft.save, "保存で落ちた写真を控えていない").toHaveBeenCalled());
        const items = (draft.save.mock.calls.at(-1)![0] as { items: { file: File; uploaded?: { key: string } }[] }).items;
        expect(items).toHaveLength(1);
        expect(items[0].uploaded?.key).toBe("uploads/me/a.jpg");
    });

    it("戻した写真に置き場所があれば、押し直したとき取り直さずに使い回す", async () => {
        draft.read.mockResolvedValue({
            t: Date.now(), userId: "me", category: "", tags: "", asOnePost: false,
            items: [{ file: new File(["x"], "a.jpg", { type: "image/jpeg" }), title: "", description: "", location: "",
                uploaded: { key: "uploads/me/a.jpg", publicUrl: "https://cdn/uploads/me/a.jpg" } }],
        });
        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /投稿する|アップロード/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        mockUserFetch.mockClear();
        await userEvent.click(publish);
        await waitFor(() => expect(savedBody(), "保存に届いていない").not.toBeNull());
        expect(mockUserFetch.mock.calls.some((c) => c[0] === "/upload/presigned-url"), "置き場所を取り直した（S3 に孤児が増える）").toBe(false);
    });
});

describe("アップロード画面: 別の人に入れ替わったとき（f310f53 のレビュー）", () => {
    it("A がログアウトして B がログインしたら、A の写真を画面からも控えからも消す（B の名で控えない）", async () => {
        const { container, rerender } = render(<UploadPage />);
        await ready();
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File(["x"], "a.jpg", { type: "image/jpeg" }));
        await waitFor(() => expect(container.querySelectorAll('img[src^="blob:"]').length).toBeGreaterThan(0));
        // 別のタブで A がログアウト → B がログイン
        auth.userId = null; rerender(<UploadPage />);
        auth.userId = "someone-else"; rerender(<UploadPage />);
        await waitFor(() => expect(draft.clear).toHaveBeenCalled());
        draft.save.mockClear();
        hide();
        await new Promise((r) => setTimeout(r, 20));
        const savedAsOther = draft.save.mock.calls.some((c) => (c[0] as { userId: string; items: unknown[] }).items.length > 0);
        expect(savedAsOther, "前の人の写真を次の人の名で控えた").toBe(false);
        expect(screen.queryByDisplayValue("a.jpg")).toBeNull();
        expect(container.querySelectorAll('img[src^="blob:"]').length, "前の人の写真が画面に残っている").toBe(0);
    });
});
