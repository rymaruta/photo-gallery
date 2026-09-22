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
    // BGM の道具を開く（1度に1つだけ開く・最終版モック 08）
    await userEvent.click(await screen.findByRole("tab", { name: "BGM" }));
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

// 検索の失敗が「0件」と同じ（結果欄は length>0 でしか描かれない）ので、
// 押しても無反応に見えた。プロフィール編集には既に同じ表示がある（SW-b6）
describe("曲検索: 失敗を伝える", () => {
    it("失敗したら理由を出す（無反応にしない）", async () => {
        mockSearchSongs.mockRejectedValue(new Error("network down"));
        await openSongPicker();
        const box = screen.getByPlaceholderText("曲名・アーティスト名");
        await userEvent.type(box, "なにか{Enter}");
        expect(await screen.findByText(/検索に失敗しました/)).toBeInTheDocument();
    });
});

// **閉じたら結果を捨てる**——`clearSongSearch()` の呼び出しは、フックの
// 単体テストでは守れない（フックは正しく、呼ばない画面が問題になる）。
// 実際、`clear` の呼び出しを2画面から消しても111件が全緑だった。
describe("曲検索: 閉じたら結果を捨てる", () => {
    it("ピッカーを閉じて開き直すと、前回の結果が残っていない", async () => {
        mockSearchSongs.mockResolvedValue([song("まえのけっか")]);
        await openSongPicker();
        const box = screen.getByPlaceholderText("曲名・アーティスト名");
        await userEvent.type(box, "たび{Enter}");
        await waitFor(() => expect(screen.getByText("まえのけっか")).toBeInTheDocument());

        // 閉じる
        await userEvent.click(screen.getByRole("button", { name: "閉じる" }));
        // 開き直す
        await userEvent.click(await screen.findByRole("button", { name: /曲|音楽|BGM/ }));

        expect(screen.queryByText("まえのけっか"), "前回の結果が残っている").toBeNull();
    });
});

// **空の語では試聴を止めない。** 検索ボタンは空だと押せないが、入力欄の
// Enter は素通りする。フックに空判定を移したとき `stopPreview()` が
// 空判定より前に出て、試聴中に語を消して Enter を押すと再生が止まっていた。
describe("曲検索: 空の語", () => {
    it("空欄の Enter では検索に行かない", async () => {
        mockSearchSongs.mockResolvedValue([song("なにか")]);
        await openSongPicker();
        const box = screen.getByPlaceholderText("曲名・アーティスト名");
        await userEvent.type(box, "   {Enter}");
        expect(mockSearchSongs, "空の語で引きに行っている").not.toHaveBeenCalled();
    });

    // **試聴も止めない。** 空判定が `stopPreview()` より後ろにあると、
    // 試聴中に語を消して Enter を押しただけで再生が止まる
    // （フックに空判定を移したときに一度そうなった）
    it("空欄の Enter では試聴を止めない", async () => {
        // jsdom は再生を実装していないので、解決するだけの play を置く
        // （置かないと `previewingId` が立たず、この判定に到達しない）
        const play = vi.spyOn(HTMLMediaElement.prototype, "play")
            .mockImplementation(async () => { });
        const pause = vi.spyOn(HTMLMediaElement.prototype, "pause")
            .mockImplementation(() => { });
        try {
        mockSearchSongs.mockResolvedValue([song("なにか")]);
        await openSongPicker();
        const box = screen.getByPlaceholderText("曲名・アーティスト名");
        await userEvent.type(box, "たび{Enter}");
        await waitFor(() => expect(screen.getByText("なにか")).toBeInTheDocument());

        // 試聴を始める（再生 → 停止ボタンに変わる）
        await userEvent.click(screen.getByRole("button", { name: "なにか を試聴" }));
        await screen.findByRole("button", { name: "なにか を停止" });

        await userEvent.clear(box);
        await userEvent.type(box, "{Enter}");

        expect(screen.queryByRole("button", { name: "なにか を停止" }), "試聴が止まっている")
            .toBeInTheDocument();
        } finally { play.mockRestore(); pause.mockRestore(); }
    });
});
