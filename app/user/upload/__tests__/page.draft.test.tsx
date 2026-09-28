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


const hide = () => act(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
});
/** このタブがこの人の控えを持つ状態にする（写真を1枚選んで隠れる＝控えを書く） */
const ownDraft = async (container: HTMLElement) => {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "IMG_0001.jpg", { type: "image/jpeg" }));
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    await waitFor(() => expect(draft.save).toHaveBeenCalled());
};

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

    it("自分の控えがあって、写真を全部外してから隠れたら、控えを消す", async () => {
        const { container } = render(<UploadPage />);
        await ready();
        await ownDraft(container);
        await userEvent.click(screen.getByRole("button", { name: "表示中の写真を外す" }));
        draft.clear.mockClear(); draft.save.mockClear();
        hide();
        await waitFor(() => expect(draft.clear).toHaveBeenCalled());
        expect(draft.save).not.toHaveBeenCalled();
    });

    it("このタブが控えを書いていない（置き場に別の人の控えがありうる）なら、写真0枚で隠れても消さない", async () => {
        render(<UploadPage />);
        await ready();
        hide();
        await new Promise((r) => setTimeout(r, 20));
        expect(draft.clear).not.toHaveBeenCalled();
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

    /**
     * **公開範囲も控えて戻す。** 控えないと、「親しい友達」を選んで設定へ行き
     * （画面が案内する）、戻って投稿すると黙って全体に公開されていた
     */
    it("公開範囲を控え、戻すときも戻す（黙って全体に公開にしない）", async () => {
        const { container } = render(<UploadPage />);
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File(["x"], "IMG_0003.jpg", { type: "image/jpeg" }));
        await userEvent.click(screen.getByRole("radio", { name: /親しい友達/ }));
        hide();
        await waitFor(() => expect(draft.save).toHaveBeenCalled());
        expect((draft.save.mock.calls.at(-1)![0] as { audience?: string }).audience).toBe("closeFriends");
    });

    it("控えの公開範囲を戻す。古い控え（公開範囲なし）は全体に公開", async () => {
        draft.read.mockResolvedValue({
            t: Date.now(), userId: "me", category: "", tags: "", asOnePost: false, audience: "followers",
            items: [{ file: new File(["x"], "IMG_0004.jpg", { type: "image/jpeg" }), title: "", description: "", location: "" }],
        });
        const { unmount } = render(<UploadPage />);
        await waitFor(() => expect(screen.getByRole("radio", { name: /フォロワーのみ/ })).toBeChecked());
        unmount();
        draft.read.mockResolvedValue({
            t: Date.now(), userId: "me", category: "", tags: "", asOnePost: false,
            items: [{ file: new File(["x"], "IMG_0005.jpg", { type: "image/jpeg" }), title: "", description: "", location: "" }],
        });
        render(<UploadPage />);
        await waitFor(() => expect(mockShowToast.mock.calls.some((c) => String(c[0]).includes("書きかけを戻しました"))).toBe(true));
        expect(screen.getByRole("radio", { name: /全体に公開/ })).toBeChecked();
    });

    /** 控えを読んでいる間に絞った選択を、控えの「全体に公開」で広げない */
    it("控えを戻しても、いま絞っている公開範囲を広げない", async () => {
        let release: (v: unknown) => void = () => {};
        draft.read.mockReturnValue(new Promise((r) => { release = r; }));
        const { container } = render(<UploadPage />);
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File(["x"], "IMG_0006.jpg", { type: "image/jpeg" }));
        await userEvent.click(await screen.findByRole("radio", { name: /親しい友達/ }));
        await act(async () => {
            release({
                t: Date.now(), userId: "me", category: "", tags: "", asOnePost: false, audience: "everyone",
                items: [{ file: new File(["x"], "IMG_0007.jpg", { type: "image/jpeg" }), title: "", description: "", location: "" }],
            });
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(screen.getByRole("radio", { name: /親しい友達/ }), "控えの値で広げた").toBeChecked();
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
        const { unmount, container } = render(<UploadPage />);
        await ready();
        await ownDraft(container);
        await userEvent.click(screen.getByRole("button", { name: "表示中の写真を外す" }));
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
        await ready();
        await ownDraft(container);
        const publish = await screen.findByRole("button", { name: /投稿する/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await waitFor(() => expect(savedBody(), "保存に届いていない").not.toBeNull());
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
        // 隠れて控えを書いた（このタブの控え）
        hide();
        await waitFor(() => expect(draft.save).toHaveBeenCalled());
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
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
    it("A がログアウトして B がログインしたら、A の写真を画面から消し、B の名で控えない", async () => {
        const { container, rerender } = render(<UploadPage />);
        await ready();
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File(["x"], "a.jpg", { type: "image/jpeg" }));
        await waitFor(() => expect(container.querySelectorAll('img[src^="blob:"]').length).toBeGreaterThan(0));
        draft.clear.mockClear();
        // 別のタブで A がログアウト → B がログイン
        auth.userId = null; rerender(<UploadPage />);
        auth.userId = "someone-else"; rerender(<UploadPage />);
        await waitFor(() => expect(container.querySelectorAll('img[src^="blob:"]').length, "前の人の写真が画面に残っている").toBe(0));
        // 入れ替わっただけでは控えを消さない（置き場に新しい人の控えがあることもある。
        // 前の人の控えは読むときに持ち主の違いで捨てられる）
        expect(draft.clear, "入れ替わりで新しい人の控えまで消しうる").not.toHaveBeenCalled();
        draft.save.mockClear();
        hide();
        await new Promise((r) => setTimeout(r, 20));
        const savedAsOther = draft.save.mock.calls.some((c) => (c[0] as { userId: string; items: unknown[] }).items.length > 0);
        expect(savedAsOther, "前の人の写真を次の人の名で控えた").toBe(false);
        // 入れ替わったあとに隠れても消さない（置き場の控えは新しい人のものかもしれない）
        expect(draft.clear, "入れ替わったあとに隠れて、新しい人の控えを消しうる").not.toHaveBeenCalled();
    });

    it("上げている最中に入れ替わったら、上げるのを止める（前の人の写真を新しい人の名で公開しない）", async () => {
        let releasePut: (() => void) | null = null;
        const firstPut = new Promise<void>((r) => { releasePut = r; });
        let puts = 0;
        vi.stubGlobal("fetch", vi.fn(async () => { if (++puts === 1) await firstPut; return { ok: true, status: 200 }; }));
        const { container, rerender } = render(<UploadPage />);
        await ready();
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, [
            new File(["x"], "a.jpg", { type: "image/jpeg" }),
            new File(["y"], "b.jpg", { type: "image/jpeg" }),
        ]);
        const publish = await screen.findByRole("button", { name: /投稿する|アップロード/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await waitFor(() => expect(puts).toBe(1)); // 1枚目の PUT で止まっている
        mockUserFetch.mockClear();
        // 別のタブで A がログアウトし B がログインした
        auth.userId = null; rerender(<UploadPage />);
        auth.userId = "someone-else"; rerender(<UploadPage />);
        await act(async () => { releasePut!(); await new Promise((r) => setTimeout(r, 50)); });
        expect(mockUserFetch.mock.calls.some((c) => c[0] === "/upload/save"), "入れ替わったあとに保存した").toBe(false);
        expect(mockUserFetch.mock.calls.some((c) => c[0] === "/upload/presigned-url"), "入れ替わったあとに次の写真を上げ始めた").toBe(false);
        expect(mockShowToast.mock.calls.some((c) => String(c[0]).includes("やめました")), "新しい人に前の人の「やめました」を出した").toBe(false);
    });
});
