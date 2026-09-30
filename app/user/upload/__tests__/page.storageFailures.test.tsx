// @vitest-environment jsdom
// ↑ ストレージの失敗（容量超過など）の再現が happy-dom では異なる。DOM のテストの既定は happy-dom（vitest.config.ts）
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **ストレージが使えない端末で、黙って終わっていた2件。**
//
// (1) 共有シートから送ると Service Worker が `?from=share` へ飛ばすが、
//     受け皿（IndexedDB）を開けない端末では、画面は「写真が入っていない
//     アップロード画面」になるだけだった。
//     利用者には何も出ない——プライベートモードでは毎回これ。
// (2) 「写真のGPSから撮影地を自動入力」を切っても、`localStorage` に
//     書けない端末では**次に開いたときは既定のオンに戻る**。切ったつもりの
//     人の写真から地名が入り、それは公開される。

const mockShowToast = vi.hoisted(() => vi.fn());
const shareResult = vi.hoisted(() => ({ current: { ok: true, payload: null } as unknown }));
const searchParams = vi.hoisted(() => ({ current: "from=share" }));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(searchParams.current),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../components/AddToHomeScreenHint", () => ({ default: () => null }));
// **`lookupSession` も模す。** `userFetch` はこちらでトークンを引く
// （`getCurrentSession` だけ差し替えても入口を支配できない）。
// 同じ答えを包んだ形にして、このファイルが守っている性質は変えない
vi.mock("../../../../lib/auth/cognito", () => {
    const getCurrentSession = vi.fn(async () => null);
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
vi.mock("../../../../lib/utils/shareStore", () => ({
    readSharedResult: vi.fn(async () => shareResult.current),
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
    userFetch: vi.fn(async () => ({ ok: true, json: async () => [] })),
    readApiError: async (_r: Response, f: string) => f,
}));

const UploadPage = (await import("../page")).default;

beforeEach(() => {
    mockShowToast.mockReset();
    searchParams.current = "from=share";
    shareResult.current = { ok: true, payload: null };
    localStorage.clear();
});

describe("共有の受け皿を開けない端末", () => {
    it("黙って空の画面にしない（理由と次の一手を出す）", async () => {
        shareResult.current = { ok: false };
        render(<UploadPage />);

        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        const [msg, kind] = mockShowToast.mock.calls[0];
        expect(String(msg), "理由を出していない").toMatch(/読み取れませんでした/);
        expect(String(msg), "次に何をすればいいか書いていない").toMatch(/ボタンから選/);
        expect(kind).toBe("error");
    });

    // **共有の直後に受け皿が空なら、それは SW の保存が落ちている。**
    // `?from=share` を使い終わりに URL から落とすので、「取り込み済みの
    // 再表示」と区別できるようになった（落とす前は区別できず、黙るしか
    // なかった＝SW の失敗を拾えていなかった。レビュー指摘）
    it("共有の直後に受け皿が空なら、それも伝える（SW の保存が落ちている）", async () => {
        shareResult.current = { ok: true, payload: null };
        render(<UploadPage />);

        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        expect(String(mockShowToast.mock.calls[0][0])).toMatch(/読み取れませんでした/);
    });

    // **使い終わったら `from` を落とす。** 残すと戻る・進む・リロードの
    // たびに同じ話をする（レビューが3回出ることを実測）
    it("処理したら URL から from=share を落とす", async () => {
        window.history.replaceState({ __next: "keep" }, "", "/user/upload?from=share");
        shareResult.current = { ok: false };
        render(<UploadPage />);

        await waitFor(() => expect(window.location.search).not.toContain("from=share"));
        // **Next の内部状態を潰さない**——`replaceState({})` で戻るが
        // `location.reload()` に落ちた事故がある（`aadd283`）
        expect((window.history.state as { __next?: string })?.__next).toBe("keep");
    });

    // 共有経由でなければ、開けなくても黙っている（通常の表示で謝らない）
    it("共有経由でない表示では、開けなくても何も言わない", async () => {
        searchParams.current = "";
        shareResult.current = { ok: false };
        render(<UploadPage />);

        await new Promise((r) => setTimeout(r, 30));
        expect(mockShowToast).not.toHaveBeenCalled();
    });
});

describe("GPS 自動入力の設定が保存できない端末", () => {
    // **共有の話と混ぜない。** 既定の `?from=share` のままだと、共有の
    // トーストが先に出て `calls[0]` がそちらになる（実際に踏んだ）
    beforeEach(() => { searchParams.current = ""; });

    /** 書き込みだけが投げる localStorage（満杯・プライベートモード相当） */
    function blockWrites() {
        const orig = Storage.prototype.setItem;
        Storage.prototype.setItem = function () { throw new DOMException("full", "QuotaExceededError"); };
        return () => { Storage.prototype.setItem = orig; };
    }

    it("切ったときは、記憶できないことを伝える（次回オンに戻る）", async () => {
        render(<UploadPage />);
        const toggle = await screen.findByRole("checkbox");
        const restore = blockWrites();
        try {
            await userEvent.click(toggle);   // オン → オフ
        } finally {
            restore();
        }

        await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
        expect(String(mockShowToast.mock.calls[0][0]), "保存できていないことを伝えていない")
            .toMatch(/設定を保存できない/);
        // **この画面では効かせる**（切ったのに埋まる方が悪い）
        expect((toggle as HTMLInputElement).checked).toBe(false);
    });

    // 逆向き: 入れ直すときは黙る（オンは既定なので、記憶できなくても実害が無い）
    it("入れ直すときは黙る", async () => {
        localStorage.setItem("jp_gps_autofill", "0");
        render(<UploadPage />);
        const toggle = await screen.findByRole("checkbox");
        await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(false));

        const restore = blockWrites();
        try { await userEvent.click(toggle); } finally { restore(); }
        expect(mockShowToast).not.toHaveBeenCalled();
    });

    // 正常系: 書ける端末では何も出さない
    it("書ける端末では何も言わない", async () => {
        render(<UploadPage />);
        const toggle = await screen.findByRole("checkbox");
        await userEvent.click(toggle);

        expect(mockShowToast).not.toHaveBeenCalled();
        expect(localStorage.getItem("jp_gps_autofill")).toBe("0");
    });
});
