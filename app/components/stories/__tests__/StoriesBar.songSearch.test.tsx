import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// 曲検索に順序の保証が無く、**打ち消したはずの結果**が出ていた。
// 遅い1回目の応答が速い2回目より後に届くと、前の語の結果で上書きされる。
// lib/hooks/useUserSearch.ts に正しい形があるので、同じ世代カウンタを使う。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockSearchSongs = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({ current: { isAuthenticated: true, userId: "me" as string | null } }));

vi.mock("../../../auth/context", () => ({ useAuth: () => authState.current }));
vi.mock("../../../i18n/context", () => ({ useLocale: () => ({ locale: "ja" }) }));
vi.mock("../../../../lib/hooks/useToast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../../../lib/utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    authenticatedFetch: vi.fn(),
    publicFetch: vi.fn(),
    readApiError: async (_r: Response, f: string) => f,
}));
vi.mock("@/lib/utils/image", () => ({
    toUploadSafeFile: async (f: File) => f,
    UnstrippableFileError: class extends Error {},
}));
vi.mock("../../../../lib/utils/music", () => ({ searchSongs: mockSearchSongs }));

import StoriesBar from "../StoriesBar";

const song = (title: string) => ({ title, artist: "誰か", artwork: "", previewUrl: `https://p/${title}.m4a`, trackUrl: "" });

function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockSearchSongs.mockReset();
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
        Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
    }
});

/** 下書きを開いて曲の検索欄まで進める */
async function openSongPicker() {
    const { container } = render(<StoriesBar />);
    await screen.findByText("あなた");
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "story.jpg", { type: "image/jpeg" }));
    // 曲を選ぶ画面を開く
    const openBtn = await screen.findByRole("button", { name: /曲|音楽|BGM/ });
    await userEvent.click(openBtn);
    return container;
}

describe("曲検索: 打ち消した結果を出さない", () => {
    it("遅い1回目の応答が後から届いても、2回目の結果を上書きしない", async () => {
        const slow = deferred<ReturnType<typeof song>[]>();
        mockSearchSongs
            .mockReturnValueOnce(slow.promise)                    // 1回目（遅い）
            .mockResolvedValueOnce([song("あたらしい")]);          // 2回目（速い）

        await openSongPicker();
        const box = screen.getByPlaceholderText("曲名・アーティスト名");

        // 1回目。**検索ボタンは保留中スピナーになって押せなくなる**ので、
        // 実際に2回目を撃てるのは Enter（onKeyDown は songSearching を見ていない）。
        await userEvent.type(box, "ふるい{Enter}");
        await userEvent.clear(box);
        await userEvent.type(box, "あたらしい{Enter}");

        await waitFor(() => expect(screen.getByText("あたらしい")).toBeInTheDocument());

        // ここで1回目がようやく返る
        slow.resolve([song("ふるい")]);
        await new Promise((r) => setTimeout(r, 20));

        expect(screen.getByText("あたらしい")).toBeInTheDocument();
        expect(screen.queryByText("ふるい")).toBeNull();
    });
});
