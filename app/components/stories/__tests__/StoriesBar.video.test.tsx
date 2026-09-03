import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// **動画だけ、メタデータを一切落とさずに原本のまま上がっていた。**
// `if (draft.mediaType === "image")` に `else` が無く、動画は選んだ
// ファイルがそのまま S3 へ PUT されていた——写真は「EXIF を落とし、座標は
// 約1kmに丸めて公開する」前提なのに、動画だけ**丸めていない緯度経度**が
// 公開URLに乗る（iPhone の .mov、Android の .mp4 のどちらも入る）。
//
// ここで固定するのは「関門を通ったファイルが上がること」。
// 除去そのものは lib/utils/__tests__/video.test.ts が見る。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const mockSafeVideo = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({ current: { isAuthenticated: true, userId: "me" as string | null } }));

vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
    readApiError: async (res: Response, fallback: string) => {
        try { return (await res.json() as { error?: string }).error ?? fallback; } catch { return fallback; }
    },
}));
// **image は本物のまま。** `UnstrippableFileError` の identity が要る
// （偽物にすると `instanceof` が外れ、断り方の分岐を検証できない）
vi.mock("@/lib/utils/video", () => ({ toUploadSafeVideo: (f: File) => mockSafeVideo(f) }));

import StoriesBar from "../StoriesBar";
import { UnstrippableFileError } from "../../../../lib/utils/image";

const KEY = "uploads/me/story.mp4";

function api() {
    return (url: string) => {
        if (url === "/upload/presigned-url") {
            return Promise.resolve({
                ok: true,
                json: async () => ({ presignedUrl: "https://s3.example/put", publicUrl: `https://cdn.example.com/${KEY}`, key: KEY }),
            });
        }
        return Promise.resolve({ ok: true, json: async () => (url === "/stories" ? [] : {}) });
    };
}

/** jsdom は動画のメタデータを読まないので、長さを同期で返す */
function stubVideoMetadata(seconds = 5) {
    const real = document.createElement.bind(document);
    return vi.spyOn(document, "createElement").mockImplementation((tag: string, opts?: ElementCreationOptions) => {
        const el = real(tag, opts);
        if (tag === "video") {
            Object.defineProperty(el, "duration", { value: seconds, configurable: true });
            Object.defineProperty(el, "src", {
                configurable: true,
                set() { (el as HTMLVideoElement).onloadedmetadata?.(new Event("loadedmetadata")); },
                get() { return "blob:x"; },
            });
        }
        return el;
    });
}

const putBodies = () => (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .filter((c) => (c[1] as { method?: string } | undefined)?.method === "PUT")
    .map((c) => (c[1] as { body: File }).body);

beforeEach(() => {
    mockShowToast.mockReset();
    mockSafeVideo.mockReset();
    mockUserFetch.mockReset().mockImplementation(api());
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
        Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
    }
});

/**
 * 動画を選ぶ。`expectDraft` が true なら投稿まで進める。
 *
 * **待ち方を場合ごとに分ける。** 両方を1つの `findByRole().catch()` で
 * 書くと、断られる場合は既定の待ち（1秒）を必ず使い切り、通る場合は
 * 「1秒以内にボタンが出るか」という**時間依存の判定**になる
 * （フルスイートを並列で回すと、負荷次第でたまに落ちる形）。
 * 通る場合は余裕をもって待ち、断られる場合はトーストを待ってから
 * 「ボタンが無いこと」を見る。
 */
async function selectVideo(expectDraft: boolean) {
    const restore = stubVideoMetadata();
    try {
        const { container } = render(<StoriesBar />);
        await screen.findByText("あなた");
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File(["original"], "story.mp4", { type: "video/mp4" }));
        if (!expectDraft) {
            await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
            return;
        }
        const post = await screen.findByRole("button", { name: /ストーリーに投稿/ }, { timeout: 5000 });
        await userEvent.click(post);
    } finally {
        restore.mockRestore();
    }
}

describe("動画も位置情報を落としてから上げる", () => {
    it("S3 に送るのは、関門を通したファイル（選んだ原本ではない）", async () => {
        const cleaned = new File(["cleaned"], "story.mp4", { type: "video/mp4" });
        mockSafeVideo.mockResolvedValue(cleaned);

        await selectVideo(true);

        await waitFor(() => expect(mockSafeVideo).toHaveBeenCalledTimes(1));
        // 渡されたのは選んだ原本
        expect(await (mockSafeVideo.mock.calls[0][0] as File).text()).toBe("original");
        // 上がったのは通したあとのファイル
        await waitFor(() => expect(putBodies()).toHaveLength(1));
        expect(putBodies()[0], "原本がそのまま上がっている").toBe(cleaned);
    });

    // **断るのは選んだ時点。** 投稿時に断ると、プレビュー・キャプション・
    // 曲選びまで進めてから「上げられません」になり、下書きが全部無駄になる
    it("落とせない動画は下書きにも進まない（presign も PUT もしない）", async () => {
        mockSafeVideo.mockRejectedValue(new UnstrippableFileError("video/webm"));

        await selectVideo(false);

        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining("位置情報を取り除けません"), "error"));
        expect(screen.queryByRole("button", { name: /ストーリーに投稿/ }),
            "落とせないのに下書きまで進めている").toBeNull();
        expect(putBodies(), "落とせないのに上げている").toHaveLength(0);
        expect(mockUserFetch.mock.calls.some((c) => c[0] === "/upload/presigned-url"),
            "落とせないのに presign を取っている").toBe(false);
    });

    it("準備が想定外に落ちたときも上げない", async () => {
        mockSafeVideo.mockRejectedValue(new Error("boom"));

        await selectVideo(false);

        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("動画の準備に失敗しました", "error"));
        expect(putBodies()).toHaveLength(0);
    });

    it("関門は1回だけ通す（同じ処理を二度走らせない）", async () => {
        mockSafeVideo.mockResolvedValue(new File(["cleaned"], "story.mp4", { type: "video/mp4" }));
        await selectVideo(true);
        await waitFor(() => expect(putBodies()).toHaveLength(1));
        expect(mockSafeVideo).toHaveBeenCalledTimes(1);
    });
});

// **申告した長さと、実際に送る本文は一致していなければならない。**
//
// presign が `ContentLength` を署名するようになったので、1バイトでも
// 違えば S3 が 403 を返す。
//
// ストーリーは**選んだ時点で加工する**ので、投稿時にはもう加工後の
// ファイルしか無く、今の形では食い違いようがない。守りたいのは
// **これから誰かが presign と PUT の間に加工を挟んだとき**——
// そこで初めて2つのファイルが並び、片方の長さを申告してもう片方を
// 送る形が自然に見えてしまう。
// **下ごしらえの数秒のあいだ、リングは押せる。**
//
// 動画はメタデータ読み＋箱の走査で数秒かかるが、その間 UI は何も変わらず
// `disabled` は `posting` だけ。押すとストーリービューアが開き、そこへ
// 下書きが `z-[95]` でかぶさる——裏のビューアは生きたままなので BGM は
// 鳴り続け、自動送りも進み、閲覧記録まで送られる。キャプション欄で
// ← → を押すと**裏のストーリーが動く**（keydown は document に付いている）。
describe("下ごしらえ中にストーリーを開いてしまったとき", () => {
    it("下書きが開くときは、ビューアを閉じる（2つ重ねない）", async () => {
        mockUserFetch.mockImplementation((url: string) => {
            if (url === "/stories") {
                return Promise.resolve({
                    ok: true,
                    json: async () => [{
                        id: "s1", userId: "someone", displayName: "旅子",
                        src: "https://cdn.example.com/uploads/s1.jpg", mediaType: "image",
                        createdAt: new Date().toISOString(),
                        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
                    }],
                });
            }
            return api()(url);
        });
        // 下ごしらえを保留にして、その間にリングを押す
        let finishPrepare: ((f: File) => void) | null = null;
        mockSafeVideo.mockImplementation(() => new Promise((res) => { finishPrepare = res; }));

        const restore = stubVideoMetadata();
        try {
            const { container } = render(<StoriesBar />);
            await screen.findByText("あなた");
            const input = container.querySelector('input[type="file"]') as HTMLInputElement;
            await userEvent.upload(input, new File(["original"], "story.mp4", { type: "video/mp4" }));
            await waitFor(() => expect(mockSafeVideo).toHaveBeenCalled());

            // まだ下書きは出ていない。ここでリングを押す
            await userEvent.click(await screen.findByRole("button", { name: /旅子/ }));
            await screen.findByRole("dialog", { name: "ストーリー" });

            finishPrepare!(new File(["cleaned"], "story.mp4", { type: "video/mp4" }));

            await screen.findByRole("button", { name: /ストーリーに投稿/ });
            expect(screen.queryAllByRole("dialog"), "ビューアと下書きが重なっている").toHaveLength(1);
            expect(screen.queryByRole("dialog", { name: "ストーリー" }),
                "裏でストーリーが動き続けている").toBeNull();
        } finally {
            restore.mockRestore();
        }
    });
});

describe("presign に申告した長さと、PUT する本文の長さ", () => {
    it("加工後のファイルで揃っている", async () => {
        // 加工で長さが変わる状況にする（素通しだと食い違いを作れない）
        const cleaned = new File(["cleaned-body-is-a-different-length"], "story.mp4", { type: "video/mp4" });
        mockSafeVideo.mockResolvedValue(cleaned);

        await selectVideo(true);

        await waitFor(() => expect(putBodies()).toHaveLength(1));
        const declared = mockUserFetch.mock.calls
            .filter((c) => c[0] === "/upload/presigned-url")
            .map((c) => JSON.parse((c[1] as { body: string }).body).fileSize as number);
        expect(declared, "presign を1回取っていない").toHaveLength(1);
        expect(declared[0], "申告と本文の長さが食い違っている（S3 が 403 を返す）")
            .toBe((putBodies()[0] as File).size);
        expect(declared[0], "関門を通したファイルの長さを申告していない").toBe(cleaned.size);
    });
});

// **GIF は選べるのに、投稿を押して初めて必ず失敗していた。**
//
// `toUploadSafeFile` は GIF を必ず `UnstrippableFileError` にする
// （アニメーションを保つため再エンコードせず、保険のバイト除去は JPEG だけ）。
// 上の動画の関門には「投稿時ではなく選択時にやる」と書いてあるのに、
// 画像だけ投稿時のままで、**キャプションと曲まで選んでから断られていた**。
describe("GIF は選んだ時点で断る", () => {
    it("下書きにも進まない", async () => {
        const { container } = render(<StoriesBar />);
        await screen.findByText("あなた");
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File(["gif"], "cat.gif", { type: "image/gif" }));

        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining("GIF は位置情報を取り除けません"), "error"));
        expect(screen.queryByRole("button", { name: /ストーリーに投稿/ }),
            "投稿を押すまで分からない").toBeNull();
    });

    // 正常系: JPEG は今までどおり下書きまで進む
    it("JPEG は今までどおり下書きへ進む", async () => {
        const { container } = render(<StoriesBar />);
        await screen.findByText("あなた");
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File(["jpg"], "a.jpg", { type: "image/jpeg" }));

        expect(await screen.findByRole("button", { name: /ストーリーに投稿/ }, { timeout: 5000 }))
            .toBeInTheDocument();
    });
});
