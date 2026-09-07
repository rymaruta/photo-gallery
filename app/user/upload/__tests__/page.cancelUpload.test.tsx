import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UPLOAD_FAILED_MESSAGE } from "../errorText";
import { CANCEL_DISCARD_WAIT_MS } from "../page";

// **アップロード中に止める手段が無かった。**
// 押している間は公開も下書き保存も `disabled={uploading}` で、しかも
// **S3 への PUT は素の `fetch`**（`userFetch` の20秒の打ち切りは経路外）。
// 応答が返らない回線ではリロード以外に出る手段が無く、リロードすると
// S3 に孤児が残る（DynamoDB に行が無いので、どの削除経路からも辿れない）。
// ストーリーの投稿（`StoriesBar`）が同じ理由で先に直してある形を借りる。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockReadSharedPayload = vi.hoisted(() => vi.fn());
const mockCreateThumbnail = vi.hoisted(() => vi.fn());
const mockDominantColor = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush, replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams("from=share"),
}));
vi.mock("../../../auth/context", () => ({
    useAuth: () => ({ isAuthenticated: true, isAdminUser: false, isGeneralUser: true, loading: false }),
}));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
const mockShowToast = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("../../../components/AddToHomeScreenHint", () => ({ default: () => null }));
vi.mock("../../../../lib/auth/cognito", () => ({ getCurrentSession: vi.fn(async () => null) }));
vi.mock("../../../../lib/utils/shareStore", () => ({
    // 「読めた／読めなかった」を分ける口。既存のモックから組み立てる
    readSharedResult: async () => ({ ok: true, payload: await mockReadSharedPayload() }),
    clearSharedPayload: vi.fn(async () => undefined),
}));
vi.mock("../../../../lib/utils/exif", () => ({
    extractExifFromFile: vi.fn(async () => ({})),
    extractCameraExif: vi.fn(async () => ({})),
    reverseGeocode: vi.fn(async () => null),
}));
vi.mock("../../../../lib/utils/image", () => ({
    createThumbnail: mockCreateThumbnail,            // 既定はサムネ無し（本体のキーだけを見る）
    toUploadSafeFile: vi.fn(async (f: File) => f),
    UnstrippableFileError: class extends Error {},
    extractDominantColor: mockDominantColor,
    createBlurPlaceholder: vi.fn(async () => null),
    AVATAR_MAX_PX: 512,
}));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: mockUserFetch,
    readApiError: async (res: Response, fallback: string) => {
        try {
            const d = await res.json() as { error?: string };
            return d.error ?? fallback;
        } catch { return fallback; }
    },
}));

const UploadPage = (await import("../page")).default;


const KEY = "uploads/me/abc.jpg";

/** S3 への PUT を、中断されるまで返さない形にする */
function hangingPut() {
    let abortPut: (() => void) | null = null;
    const putStarted = { done: false };
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
        // **本物の契約に寄せる。** 既に中断済みの signal を渡されたら即 reject。
        // 見ないままだと、複数枚に増やしたときに回帰があっても落ちずに
        // 「返らないまま詰まる」（原因の読めない失敗になる）
        if (init?.signal?.aborted) return Promise.reject(new DOMException("cancelled", "AbortError"));
        putStarted.done = true;
        return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("cancelled", "AbortError")));
            abortPut = () => reject(new DOMException("cancelled", "AbortError"));
        });
    }));
    return { putStarted, get abortPut() { return abortPut; } };
}

beforeEach(() => {
    mockCreateThumbnail.mockReset().mockResolvedValue(null);
    mockDominantColor.mockReset().mockResolvedValue(null);
    mockShowToast.mockReset();
    mockPush.mockReset();
    mockUserFetch.mockReset().mockImplementation((url: string) => {
        if (url === "/upload/presigned-url") {
            return Promise.resolve({ ok: true, json: async () => ({ presignedUrl: "https://s3/put", publicUrl: "https://cdn/x.jpg", key: KEY }) });
        }
        if (url === "/upload/discard") return Promise.resolve({ ok: true, json: async () => ({}) });
        if (url === "/user/photos") return Promise.resolve({ ok: true, json: async () => [] });
        return Promise.resolve({ ok: true, json: async () => ({ id: "p1" }) });
    });
    mockReadSharedPayload.mockResolvedValue({
        files: [new File(["x"], "shared.jpg", { type: "image/jpeg" })], title: "", text: "", t: Date.now(),
    });
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
        Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
    }
});

/** showToast の呼び出しを `種類:文言` で並べる */
const toasts = () => mockShowToast.mock.calls.map((c) => `${String(c[1] ?? "success")}:${String(c[0])}`);

describe("アップロード中にやめる", () => {
    it("止めるボタンは、押している間だけ出る", async () => {
        hangingPut();
        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        expect(screen.queryByRole("button", { name: "やめる" }), "押す前から出ている").toBeNull();

        await userEvent.click(publish);
        expect(await screen.findByRole("button", { name: "やめる" }), "止める手段が無い").toBeInTheDocument();
    });

    it("押したら S3 への PUT を中断し、上げかけた実体を捨てる", async () => {
        hangingPut();
        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);

        const stop = await screen.findByRole("button", { name: "やめる" });
        await userEvent.click(stop);

        // 上げかけたキーを捨てる（残すと誰も辿れない実体になる）
        await waitFor(() => {
            const discards = mockUserFetch.mock.calls.filter((c) => c[0] === "/upload/discard");
            expect(discards.length, "上げかけた実体を捨てていない").toBeGreaterThan(0);
        });
        // 押せる状態に戻る（＝止める手段が効いている）
        await waitFor(() => expect(screen.queryByRole("button", { name: "やめる" })).toBeNull());
        await waitFor(() => expect(screen.getByRole("button", { name: /枚を公開/ })).not.toBeDisabled());
    });

    // **本体の PUT は通り、保存だけ返らない**とき。5か所のうち行を作る
    // いちばん重い口で、ここに signal が無いと止まらない
    it("保存が返らないときも止まる", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));   // S3 は通る
        mockUserFetch.mockImplementation((url: string, init?: { signal?: AbortSignal }) => {
            if (url === "/upload/presigned-url") {
                return Promise.resolve({ ok: true, json: async () => ({ presignedUrl: "https://s3/put", publicUrl: "https://cdn/x.jpg", key: KEY }) });
            }
            if (url === "/upload/discard") return Promise.resolve({ ok: true, json: async () => ({}) });
            if (url === "/user/photos") return Promise.resolve({ ok: true, json: async () => [] });
            // 保存は中断されるまで返らない（本物の userFetch と同じく signal を見る）
            return new Promise((_res, reject) => {
                if (init?.signal?.aborted) reject(new DOMException("cancelled", "AbortError"));
                init?.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")));
            });
        });
        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await waitFor(() => expect(mockUserFetch.mock.calls.some((c) => c[0] === "/upload/save")).toBe(true));

        await userEvent.click(await screen.findByRole("button", { name: "やめる" }));
        await waitFor(() => expect(screen.getByRole("button", { name: /枚を公開/ })).not.toBeDisabled());
        expect(toasts()).toContain("info:アップロードをやめました");
    });

    // **押した状態から必ず抜ける。** catch の中で投げると、以前は
    // `setUploading(false)` に届かず「押しても何も起きないボタン」だけが残った
    it("中身の分からない失敗（null で reject）でも、押せる状態に戻る", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.reject(null)));
        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await waitFor(() => expect(screen.getByRole("button", { name: /枚を公開/ })).not.toBeDisabled());
        expect(screen.queryByRole("button", { name: "やめる" }), "止めるボタンが出たまま残っている").toBeNull();
    });

    it("やめても「失敗」にせず、もう一度押せる状態に戻す", async () => {
        hangingPut();
        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await userEvent.click(await screen.findByRole("button", { name: "やめる" }));

        await waitFor(() => expect(screen.queryByRole("button", { name: "やめる" })).toBeNull());
        // **文言そのものを見る。** 最初は `/失敗/` で探していたが、中断したときに
        // 出る文言は「画像をアップロードできませんでした…」で**その語を含まない**
        // ——中断を失敗として扱う変異が素通りしていた（変異テストで気づいた）
        expect(screen.queryByText(UPLOAD_FAILED_MESSAGE), "やめただけなのに失敗の文言を出している").toBeNull();
        // 赤い注意書き自体が出ていないこと
        expect(document.querySelector(".text-red-400"), "やめただけなのに赤い注意書きが出ている").toBeNull();
        // **看板そのものを見る。** ここを見ていなかったので、
        // 「やめました」を出して遷移しない分岐を**丸ごと消しても緑**だった
        expect(toasts(), "やめたと伝えていない").toContain("info:アップロードをやめました");
        expect(toasts().filter((t) => t.startsWith("error:")), "やめただけなのに失敗を出している").toEqual([]);
        expect(mockPush, "やめたのに画面を移している").not.toHaveBeenCalled();
    });
    // **サムネの PUT で中断したとき。** サムネの失敗は「無しで続ける」設計
    // なので catch が握るが、やめたときまで握ると そのあと原寸のデコード
    // （代表色・ぼかし・EXIF）とセッションの待ちを通ってから保存まで飛ぶ
    // ——「やめる」を押したのに写真が1枚できあがる
    it("サムネの途中でやめたら、そこで止めて保存まで進めない", async () => {
        mockCreateThumbnail.mockResolvedValue(new File(["t"], "t.webp", { type: "image/webp" }));
        let thumbPutStarted = false;
        vi.stubGlobal("fetch", vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
            if (init?.signal?.aborted) return Promise.reject(new DOMException("cancelled", "AbortError"));
            if (!thumbPutStarted) {          // 1回目＝本体の PUT は通す
                thumbPutStarted = true;
                return Promise.resolve({ ok: true, status: 200 });
            }
            return new Promise((_res, reject) => {   // 2回目＝サムネの PUT は返らない
                init?.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")));
            });
        }));

        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await waitFor(() => expect(thumbPutStarted, "サムネの PUT まで進んでいない").toBe(true));

        await userEvent.click(await screen.findByRole("button", { name: "やめる" }));
        await waitFor(() => expect(screen.getByRole("button", { name: /枚を公開/ })).not.toBeDisabled());

        expect(mockUserFetch.mock.calls.some((c) => c[0] === "/upload/save"),
            "やめたのに保存まで進んでいる").toBe(false);
        expect(toasts()).toContain("info:アップロードをやめました");
    });

    // **やめたときは打ち消しを待つ。** 投げっぱなしだと、利用者は DELETE が
    // 飛ぶ前に離脱できる（押した直後にタブを閉じる・戻る）——この修正が
    // 目的にしている孤児がそのまま残る
    it("やめたと出すのは、上げかけた実体を捨て終えてから", async () => {
        hangingPut();
        let finishDiscard: (() => void) | null = null;
        const base = mockUserFetch.getMockImplementation()!;
        mockUserFetch.mockImplementation((url: string, init?: unknown) => {
            if (url === "/upload/discard") {
                return new Promise((resolve) => {
                    finishDiscard = () => resolve({ ok: true, json: async () => ({}) });
                });
            }
            return base(url, init);
        });

        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await userEvent.click(await screen.findByRole("button", { name: "やめる" }));

        await waitFor(() => expect(finishDiscard, "捨てにいっていない").not.toBeNull());
        expect(toasts(), "捨て終わる前に畳んでいる").not.toContain("info:アップロードをやめました");
        // **止まるまでの間もボタンは残す。** 押した瞬間に消すと、そこに居た
        // フォーカスが `<body>` へ落ちる（キーボード・読み上げの人は位置を失う）
        const stopping = screen.getByRole("button", { name: "中断中…" });
        // **`disabled` にはしない。** 実ブラウザは focus 中の要素が disabled に
        // なると blur するので、「消さずに残す」理由を自分で潰すことになる
        expect(stopping, "disabled にするとフォーカスが落ちる").not.toBeDisabled();
        expect(stopping, "押したら二度押しできる状態のまま").toHaveAttribute("aria-disabled", "true");
        expect(screen.queryByRole("button", { name: "やめる" }), "押したのに名前が変わっていない").toBeNull();

        finishDiscard!();
        await waitFor(() => expect(toasts()).toContain("info:アップロードをやめました"));
    });
    // 【A-2 の再現】中断が保存の応答に競り負けた場合。`abort()` は決着済みの
    // Promise を巻き戻せないので、`cancelled` が立たないまま成功の道を通る
    it("保存が返り切ってからやめても、成功として遷移しない", async () => {
        let finishSave: (() => void) | null = null;
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
        const base = mockUserFetch.getMockImplementation()!;
        mockUserFetch.mockImplementation((url: string, init?: unknown) => {
            // 保存は signal を見ない（＝中断しても決着済みなら ok が返る）
            if (url === "/upload/save") {
                return new Promise((resolve) => {
                    finishSave = () => resolve({ ok: true, json: async () => ({ id: "p1" }) });
                });
            }
            return base(url, init);
        });

        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await waitFor(() => expect(finishSave, "保存まで進んでいない").not.toBeNull());

        await userEvent.click(await screen.findByRole("button", { name: "やめる" }));
        finishSave!();

        // 1枚が保存し終わっているので「公開」は 0枚 で押せないまま。
        // 見るのは畳み方（成功として祝うか、やめたと伝えるか）
        await waitFor(() => expect(toasts().length, "まだ畳んでいない").toBeGreaterThan(1));
        expect(toasts().some((t) => t.startsWith("info:やめました")), "やめたのに成功として畳んでいる").toBe(true);
        expect(toasts().some((t) => t.includes("枚アップロードしました")), "やめたのに成功を祝っている").toBe(false);
        expect(mockPush, "やめたのに画面を移している").not.toHaveBeenCalled();
    });

    // 【B-1 の再現】代表色・ぼかし・EXIF は原寸を3回デコードする。どれも
    // signal を見ないので、その間に押した「やめる」は保存まで効かない
    it("重い処理の途中でやめたら、保存に入らない", async () => {
        let finishDecode: (() => void) | null = null;
        mockDominantColor.mockImplementation(() => new Promise((resolve) => {
            finishDecode = () => resolve(null);
        }));
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));

        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await waitFor(() => expect(finishDecode, "代表色の抽出まで進んでいない").not.toBeNull());

        await userEvent.click(await screen.findByRole("button", { name: "やめる" }));
        finishDecode!();

        await waitFor(() => expect(screen.getByRole("button", { name: /枚を公開/ })).not.toBeDisabled());
        expect(mockUserFetch.mock.calls.some((c) => c[0] === "/upload/save"),
            "やめたのに保存まで進んでいる").toBe(false);
        expect(toasts()).toContain("info:アップロードをやめました");
    });
    // 【A-1】捨てるのを待つのは正しいが、待ち先は `userFetch`
    //（セッション最大10秒＋要求20秒）をキーごとに直列で回す。返らない回線
    // ——「やめる」が要るまさにその場面——では最悪60秒 画面が戻らない。
    // **偽のタイマーは使えない**（取り込みの 1.1 秒 sleep と userEvent が
    // 絡んで進まない）ので、実時間で上限そのものを待つ。この1本だけ遅い
    it("捨てるのが返らない回線でも、上限で画面を返す", async () => {
        hangingPut();
        const base = mockUserFetch.getMockImplementation()!;
        mockUserFetch.mockImplementation((url: string, init?: unknown) => {
            if (url === "/upload/discard") return new Promise(() => { /* 永久に返らない */ });
            return base(url, init);
        });

        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /枚を公開/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await userEvent.click(await screen.findByRole("button", { name: "やめる" }));
        await waitFor(() => expect(
            mockUserFetch.mock.calls.some((c) => c[0] === "/upload/discard"), "捨てにいっていない").toBe(true));

        await waitFor(() => expect(toasts(), "上限を過ぎても畳まない").toContain("info:アップロードをやめました"),
            { timeout: CANCEL_DISCARD_WAIT_MS + 3_000 });
        expect(screen.queryByRole("button", { name: "中断中…" }), "止めたまま戻らない").toBeNull();
    }, CANCEL_DISCARD_WAIT_MS + 5_000);

});
