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

/** 動画を選んで下書きを開き、投稿ボタンまで進める */
async function postVideo() {
    const restore = stubVideoMetadata();
    try {
        const { container } = render(<StoriesBar />);
        await screen.findByText("あなた");
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File(["original"], "story.mp4", { type: "video/mp4" }));
        const post = await screen.findByRole("button", { name: /ストーリーに投稿/ });
        await userEvent.click(post);
    } finally {
        restore.mockRestore();
    }
}

describe("動画も位置情報を落としてから上げる", () => {
    it("S3 に送るのは、関門を通したファイル（選んだ原本ではない）", async () => {
        const cleaned = new File(["cleaned"], "story.mp4", { type: "video/mp4" });
        mockSafeVideo.mockResolvedValue(cleaned);

        await postVideo();

        await waitFor(() => expect(mockSafeVideo).toHaveBeenCalledTimes(1));
        // 渡されたのは選んだ原本
        expect(await (mockSafeVideo.mock.calls[0][0] as File).text()).toBe("original");
        // 上がったのは通したあとのファイル
        await waitFor(() => expect(putBodies()).toHaveLength(1));
        expect(putBodies()[0], "原本がそのまま上がっている").toBe(cleaned);
    });

    it("落とせない動画は上げない（presign も PUT もしない）", async () => {
        mockSafeVideo.mockRejectedValue(new UnstrippableFileError("video/webm"));

        await postVideo();

        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining("位置情報を取り除けません"), "error"));
        expect(putBodies(), "落とせないのに上げている").toHaveLength(0);
        expect(mockUserFetch.mock.calls.some((c) => c[0] === "/upload/presigned-url"),
            "落とせないのに presign を取っている").toBe(false);
    });

    it("準備が想定外に落ちたときも上げない", async () => {
        mockSafeVideo.mockRejectedValue(new Error("boom"));

        await postVideo();

        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("動画の準備に失敗しました", "error"));
        expect(putBodies()).toHaveLength(0);
    });
});
