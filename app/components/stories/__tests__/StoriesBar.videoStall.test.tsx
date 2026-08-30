import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// **メタデータが返らない動画で、何も起きないまま止まっていた。**
//
// `loadedmetadata` も `error` も鳴らない状況がある（メモリの足りない
// iOS Safari など）。画像側の `loadImageFromFile` は同じ理由で15秒の
// 打ち切りを持っているのに、**動画側だけ無かった**——選んだのに下書きも
// 出ず、トーストも出ず、その動画ぶんの blob URL（最大50MB）が解放されない
// まま残る。押し直しても同じなので、利用者には**無反応**に見える。
//
// 時計を止めて測るので、他のストーリー試験（実時間で動く）とは
// ファイルを分ける——同じファイルに置いたら、こちらの偽の時計と
// `createElement` の差し替えが向こうを巻き込んで6本落ちた。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({ current: { isAuthenticated: true, userId: "me" as string | null } }));

vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
    readApiError: async (_r: Response, f: string) => f,
}));
vi.mock("@/lib/utils/video", () => ({ toUploadSafeVideo: async (f: File) => f }));

import StoriesBar from "../StoriesBar";

const revoked: string[] = [];

beforeEach(() => {
    revoked.length = 0;
    mockShowToast.mockReset();
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
    Object.defineProperty(URL, "createObjectURL", { value: () => "blob:dead", writable: true, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", {
        value: (u: string) => { revoked.push(u); }, writable: true, configurable: true,
    });
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

/** src を入れても loadedmetadata も error も起こさない video を作る */
function stubDeadVideo() {
    const real = document.createElement.bind(document);
    return vi.spyOn(document, "createElement").mockImplementation((tag: string, opts?: ElementCreationOptions) => {
        const el = real(tag, opts);
        if (tag === "video") {
            Object.defineProperty(el, "src", { configurable: true, set() { }, get() { return "blob:dead"; } });
        }
        return el;
    });
}

const putCalls = () => (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .filter((c) => (c[1] as { method?: string } | undefined)?.method === "PUT");

describe("動画のメタデータが返らないとき", () => {
    it("打ち切って理由を出し、blob URL も解放する", async () => {
        const restore = stubDeadVideo();
        const { container } = render(<StoriesBar />);
        await screen.findByText("あなた");

        vi.useFakeTimers();
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        const file = new File(["v"], "story.mp4", { type: "video/mp4" });
        Object.defineProperty(input, "files", { value: [file], configurable: true });
        fireEvent.change(input);

        // **上下から挟む。** 打ち切りが無い変異も、短すぎる変異も捕まえる
        await vi.advanceTimersByTimeAsync(14000);
        expect(mockShowToast, "早すぎる打ち切り").not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(2000);
        vi.useRealTimers();

        await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("動画を読み込めませんでした", "error"));
        expect(revoked, "解放していない（最大50MB がタブに残る）").toContain("blob:dead");
        expect(putCalls(), "読めていないのに上げている").toHaveLength(0);
        expect(screen.queryByRole("button", { name: /ストーリーに投稿/ }),
            "読めていないのに下書きへ進んでいる").toBeNull();
        restore.mockRestore();
    });
});
