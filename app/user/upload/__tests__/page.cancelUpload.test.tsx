import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UPLOAD_FAILED_MESSAGE } from "../errorText";

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

// **上限そのものは差し替える。** 本物は5秒で、待つことを見るテストが
// 毎回5秒かかる（実装は同じ経路を通る）
vi.mock("../cancelWait", () => ({ CANCEL_DISCARD_WAIT_MS: 50 }));

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
// **`lookupSession` も模す。** `userFetch` はこちらでトークンを引く
// （`getCurrentSession` だけ差し替えても入口を支配できない）。
// 同じ答えを包んだ形にして、このファイルが守っている性質は変えない
vi.mock("../../../../lib/auth/cognito", () => {
    const getCurrentSession = vi.fn(async () => null);
    return { getCurrentSession, lookupSession: async () => ({ session: await getCurrentSession(), unreachable: false }) };
});
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
const THUMB_KEY = "uploads/me/abc-thumb.webp";

/**
 * S3 への PUT を、中断されるまで返さない形にする。
 *
 * `reason` を渡すと、中断のときにその理由で reject する
 * ——**本物は必ず `AbortError` を投げるとは限らない**（本文の途中で
 * 切れた回は素の `TypeError` で終わる）。中断かどうかを `signal.aborted`
 * でも見ている側の判定は、そちらでしか確かめられない
 */
function hangingPut(reason?: () => unknown) {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
        // **本物の契約に寄せる。** 既に中断済みの signal を渡されたら即 reject。
        // 見ないままだと、複数枚に増やしたときに回帰があっても落ちずに
        // 「返らないまま詰まる」（原因の読めない失敗になる）
        if (init?.signal?.aborted) return Promise.reject(new DOMException("cancelled", "AbortError"));
        return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
                reject(reason ? reason() : new DOMException("cancelled", "AbortError")));
        });
    }));
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
        const publish = await screen.findByRole("button", { name: /投稿する/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        expect(screen.queryByRole("button", { name: "やめる" }), "押す前から出ている").toBeNull();

        await userEvent.click(publish);
        expect(await screen.findByRole("button", { name: "やめる" }), "止める手段が無い").toBeInTheDocument();
    });

    it("押したら S3 への PUT を中断し、上げかけた実体を捨てる", async () => {
        hangingPut();
        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /投稿する/ });
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
        await waitFor(() => expect(screen.getByRole("button", { name: /投稿する/ })).not.toBeDisabled());
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
        const publish = await screen.findByRole("button", { name: /投稿する/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await waitFor(() => expect(mockUserFetch.mock.calls.some((c) => c[0] === "/upload/save")).toBe(true));

        await userEvent.click(await screen.findByRole("button", { name: "やめる" }));
        await waitFor(() => expect(screen.getByRole("button", { name: /投稿する/ })).not.toBeDisabled());
        expect(toasts()).toContain("info:アップロードをやめました");
    });

    // **押した状態から必ず抜ける。** catch の中で投げると、以前は
    // `setUploading(false)` に届かず「押しても何も起きないボタン」だけが残った
    it("中身の分からない失敗（null で reject）でも、押せる状態に戻る", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.reject(null)));
        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /投稿する/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await waitFor(() => expect(screen.getByRole("button", { name: /投稿する/ })).not.toBeDisabled());
        expect(screen.queryByRole("button", { name: "やめる" }), "止めるボタンが出たまま残っている").toBeNull();
    });

    it("やめても「失敗」にせず、もう一度押せる状態に戻す", async () => {
        hangingPut();
        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /投稿する/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await userEvent.click(await screen.findByRole("button", { name: "やめる" }));

        await waitFor(() => expect(screen.queryByRole("button", { name: "やめる" })).toBeNull());
        // **文言そのものを見る。** 最初は `/失敗/` で探していたが、中断したときに
        // 出る文言は「画像をアップロードできませんでした…」で**その語を含まない**
        // ——中断を失敗として扱う変異が素通りしていた（変異テストで気づいた）
        expect(screen.queryByText(UPLOAD_FAILED_MESSAGE), "やめただけなのに失敗の文言を出している").toBeNull();
        // 赤い注意書き自体が出ていないこと
        expect(document.querySelector(".text-danger"), "やめただけなのに赤い注意書きが出ている").toBeNull();
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
        const publish = await screen.findByRole("button", { name: /投稿する/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await waitFor(() => expect(thumbPutStarted, "サムネの PUT まで進んでいない").toBe(true));

        await userEvent.click(await screen.findByRole("button", { name: "やめる" }));
        await waitFor(() => expect(screen.getByRole("button", { name: /投稿する/ })).not.toBeDisabled());

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
        const publish = await screen.findByRole("button", { name: /投稿する/ });
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
        const publish = await screen.findByRole("button", { name: /投稿する/ });
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
        const publish = await screen.findByRole("button", { name: /投稿する/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await waitFor(() => expect(finishDecode, "代表色の抽出まで進んでいない").not.toBeNull());

        await userEvent.click(await screen.findByRole("button", { name: "やめる" }));
        finishDecode!();

        await waitFor(() => expect(screen.getByRole("button", { name: /投稿する/ })).not.toBeDisabled());
        expect(mockUserFetch.mock.calls.some((c) => c[0] === "/upload/save"),
            "やめたのに保存まで進んでいる").toBe(false);
        expect(toasts()).toContain("info:アップロードをやめました");
    });
    // 【A-1】捨てるのを待つのは正しいが、待ち先は `userFetch`
    //（セッション最大10秒＋要求20秒）をキーごとに直列で回す。返らない回線
    // ——「やめる」が要るまさにその場面——では最悪60秒 画面が戻らない。
    // 上限そのものは `vi.mock` で 50ms に差し替えている（本物は5秒。
    // 偽のタイマーは取り込みの 1.1 秒 sleep と userEvent が絡んで進まない）
    it("捨てるのが返らない回線でも、上限で画面を返す", async () => {
        hangingPut();
        const base = mockUserFetch.getMockImplementation()!;
        mockUserFetch.mockImplementation((url: string, init?: unknown) => {
            if (url === "/upload/discard") return new Promise(() => { /* 永久に返らない */ });
            return base(url, init);
        });

        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /投稿する/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await userEvent.click(await screen.findByRole("button", { name: "やめる" }));
        await waitFor(() => expect(
            mockUserFetch.mock.calls.some((c) => c[0] === "/upload/discard"), "捨てにいっていない").toBe(true));

        await waitFor(() => expect(toasts(), "上限を過ぎても畳まない").toContain("info:アップロードをやめました"),
            { timeout: 3_000 });
        expect(screen.queryByRole("button", { name: "中断中…" }), "止めたまま戻らない").toBeNull();
    });

    // **控えたサムネのキーも捨てる。** ここを見ていなかったので、
    // `stale` からサムネを外す変異が素通りしていた（新テストは
    // 「保存に進まない」しか見ておらず、孤児を防ぐ本来の目的を外していた）
    it("サムネの途中でやめたら、本体とサムネの両方を捨てる", async () => {
        mockCreateThumbnail.mockResolvedValue(new File(["t"], "t.webp", { type: "image/webp" }));
        let n = 0;
        vi.stubGlobal("fetch", vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
            if (init?.signal?.aborted) return Promise.reject(new DOMException("cancelled", "AbortError"));
            if (n++ === 0) return Promise.resolve({ ok: true, status: 200 });   // 本体は通る
            return new Promise((_res, reject) => {                               // サムネは返らない
                init?.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")));
            });
        }));
        const base = mockUserFetch.getMockImplementation()!;
        mockUserFetch.mockImplementation((url: string, init?: unknown) => {
            if (url === "/upload/presigned-url") {
                // 2本目（サムネ）は別のキーを返す。同じだと入れ替えても気づけない
                const key = n === 0 ? KEY : THUMB_KEY;
                return Promise.resolve({ ok: true, json: async () => ({ presignedUrl: "https://s3/put", publicUrl: "https://cdn/x.jpg", key }) });
            }
            return base(url, init);
        });

        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /投稿する/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await waitFor(() => expect(n, "サムネの PUT まで進んでいない").toBe(2));

        await userEvent.click(await screen.findByRole("button", { name: "やめる" }));
        await waitFor(() => expect(toasts()).toContain("info:アップロードをやめました"));

        const discarded = mockUserFetch.mock.calls
            .filter((c) => c[0] === "/upload/discard")
            .map((c) => JSON.parse(String((c[1] as { body: string }).body)).key);
        expect(discarded, "サムネの実体を捨てていない").toContain(THUMB_KEY);
    });

    // **中断は `AbortError` とは限らない。** 本文の途中で切れた回は素の
    // `TypeError` で終わる。`|| signal.aborted` を落とす変異が2か所とも
    // 素通りしていた（どちらも「やめたのに失敗にしない」を守る対の判定）
    it("理由が AbortError でなくても、中断なら失敗にしない", async () => {
        hangingPut(() => new TypeError("Failed to fetch"));
        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /投稿する/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await userEvent.click(await screen.findByRole("button", { name: "やめる" }));

        await waitFor(() => expect(toasts()).toContain("info:アップロードをやめました"));
        expect(toasts().filter((t) => t.startsWith("error:")), "やめただけなのに失敗を出している").toEqual([]);
        expect(document.querySelector(".text-danger"), "やめただけなのに赤い注意書きが出ている").toBeNull();
    });

    it("サムネの途中でやめたときも、理由に関係なくそこで止める", async () => {
        mockCreateThumbnail.mockResolvedValue(new File(["t"], "t.webp", { type: "image/webp" }));
        let n = 0;
        vi.stubGlobal("fetch", vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
            if (init?.signal?.aborted) return Promise.reject(new TypeError("Failed to fetch"));
            if (n++ === 0) return Promise.resolve({ ok: true, status: 200 });
            return new Promise((_res, reject) => {
                init?.signal?.addEventListener("abort", () => reject(new TypeError("Failed to fetch")));
            });
        }));

        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /投稿する/ });
        await waitFor(() => expect(publish).not.toBeDisabled());
        await userEvent.click(publish);
        await waitFor(() => expect(n, "サムネの PUT まで進んでいない").toBe(2));

        await userEvent.click(await screen.findByRole("button", { name: "やめる" }));
        await waitFor(() => expect(toasts()).toContain("info:アップロードをやめました"));
        expect(mockUserFetch.mock.calls.some((c) => c[0] === "/upload/save"),
            "やめたのに保存まで進んでいる").toBe(false);
        // **止めた場所も見る。** 保存の手前に門があるので「保存に進まない」
        // だけでは、サムネの catch が中断を握り潰しても緑になる。握ると
        // そのあと原寸を3回デコードしてから止まる（やめたのに待たされる）
        expect(mockDominantColor, "やめたのに原寸のデコードへ進んでいる").not.toHaveBeenCalled();
    });

    // **2枚目を上げ始めない。** 既存7本は全部1枚しか使っておらず、
    // ループ先頭の中断の見張りも `break` も、消して緑のままだった
    it("2枚選んで1枚目でやめたら、2枚目を上げ始めない", async () => {
        mockReadSharedPayload.mockResolvedValue({
            files: [new File(["a"], "a.jpg", { type: "image/jpeg" }), new File(["b"], "b.jpg", { type: "image/jpeg" })],
            title: "", text: "", t: Date.now(),
        });
        let finishSave: (() => void) | null = null;
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
        const base = mockUserFetch.getMockImplementation()!;
        mockUserFetch.mockImplementation((url: string, init?: unknown) => {
            // 1枚目の保存は signal を見ない（＝やめても決着してしまう）。
            // ここでループを降りないと、2枚目を上げ始める
            if (url === "/upload/save") {
                return new Promise((resolve) => { finishSave = () => resolve({ ok: true, json: async () => ({ id: "p1" }) }); });
            }
            return base(url, init);
        });

        render(<UploadPage />);
        // 取り込みは1枚ごとに 1.1 秒 待つので、既定の1秒では間に合わない
        const publish = await screen.findByRole("button", { name: /2件を投稿する/ }, { timeout: 5_000 });
        await waitFor(() => expect(publish).not.toBeDisabled(), { timeout: 5_000 });
        await userEvent.click(publish);
        await waitFor(() => expect(finishSave, "1枚目の保存まで進んでいない").not.toBeNull());

        await userEvent.click(await screen.findByRole("button", { name: "やめる" }));
        finishSave!();

        await waitFor(() => expect(toasts().some((t) => t.startsWith("info:やめました"))).toBe(true));
        expect(mockUserFetch.mock.calls.filter((c) => c[0] === "/upload/presigned-url").length,
            "やめたのに2枚目を上げ始めている").toBe(1);
    }, 15_000);   // 取り込みだけで 2.2 秒（1枚 1.1 秒）かかる
    // **やめても、本当に落ちた写真のことは伝える。** 畳む分岐は `return` で
    // 抜けるので、下の「N 件失敗しました」に届かない——やめた回だけ
    // その通知が静かに消えていた（赤い注意書きは一覧に残るので気づけなくは
    // ないが、伝えたはずのことを伝えていない）
    it("やめる前に落ちた写真があれば、その件数は伝える", async () => {
        mockReadSharedPayload.mockResolvedValue({
            files: [new File(["a"], "a.jpg", { type: "image/jpeg" }), new File(["b"], "b.jpg", { type: "image/jpeg" })],
            title: "", text: "", t: Date.now(),
        });
        hangingPut();
        let n = 0;
        const base = mockUserFetch.getMockImplementation()!;
        mockUserFetch.mockImplementation((url: string, init?: unknown) => {
            // 1枚目は上限で断られる（本物の失敗）。2枚目は PUT が返らない
            if (url === "/upload/presigned-url" && n++ === 0) {
                return Promise.resolve({ ok: false, status: 403, json: async () => ({ error: "アップロード上限に達しています" }) });
            }
            return base(url, init);
        });

        render(<UploadPage />);
        const publish = await screen.findByRole("button", { name: /2件を投稿する/ }, { timeout: 5_000 });
        await waitFor(() => expect(publish).not.toBeDisabled(), { timeout: 5_000 });
        await userEvent.click(publish);
        await userEvent.click(await screen.findByRole("button", { name: "やめる" }));

        await waitFor(() => expect(toasts()).toContain("info:アップロードをやめました"));
        expect(toasts(), "落ちた1枚のことを伝えていない").toContain("error:1 件失敗しました");
        // やめて手を付けていない残りは「失敗」に数えない
        expect(toasts().filter((t) => t.startsWith("error:")).length, "やめた残りまで失敗に数えている").toBe(1);
    }, 15_000);
});
