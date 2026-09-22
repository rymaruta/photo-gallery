import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ストーリー作成の曲試聴が、鳴っている BGM を止めていなかった。
// 2曲が同時に鳴るうえ、下書きモーダルは z-[95] でミニプレイヤー（z-40）を
// 覆うので、止める手段が画面上に無い（リロードするまで鳴り続ける）。
// 同じ場面の app/user/profile/page.tsx の togglePreview と StoryViewer には
// 既に stopGlobalMusic が入っている。ここだけ抜けていた。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockSearchSongs = vi.hoisted(() => vi.fn());
const mockStop = vi.hoisted(() => vi.fn());
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
vi.mock("../../../music/MusicContext", () => ({ useMusic: () => ({ stop: mockStop }) }));

import StoriesBar from "../StoriesBar";

const song = (title: string) => ({
    title, artist: "誰か", artwork: "", previewUrl: `https://p/${title}.m4a`, trackUrl: "",
});

beforeEach(() => {
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [] });
    mockSearchSongs.mockReset().mockResolvedValue([song("ある曲")]);
    mockStop.mockReset();
    if (!URL.createObjectURL) {
        Object.defineProperty(URL, "createObjectURL", { value: () => "blob:x", writable: true });
        Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
    }
    // jsdom は play() を実装していない
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
        configurable: true, writable: true, value: () => Promise.resolve(),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
        configurable: true, writable: true, value: () => undefined,
    });
});

async function openSongPicker() {
    const { container } = render(<StoriesBar />);
    await screen.findByText("あなた");
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "story.jpg", { type: "image/jpeg" }));
    // BGM の道具を開く（1度に1つだけ開く・最終版モック 08）
    await userEvent.click(await screen.findByRole("tab", { name: "BGM" }));
    await userEvent.click(await screen.findByRole("button", { name: /曲|音楽|BGM/ }));
    return container;
}

describe("ストーリー作成の曲試聴", () => {
    it("試聴を始める前に、鳴っている BGM を止める", async () => {
        await openSongPicker();
        await userEvent.type(screen.getByPlaceholderText("曲名・アーティスト名"), "なにか{Enter}");
        await screen.findByText("ある曲");
        expect(mockStop).not.toHaveBeenCalled();   // 検索しただけでは止めない

        // 検索結果の試聴ボタン
        const play = await screen.findByRole("button", { name: /試聴|停止/ });
        await userEvent.click(play);

        expect(mockStop).toHaveBeenCalled();
    });

    // **検索し直すと、鳴っている曲の停止ボタンごと消える。**
    // 結果リストが差し替わるので、さっき押した曲の行が無くなる——
    // 音は鳴ったまま、画面には止める手段が無い（下書きは z-[95] で
    // ミニプレイヤーも覆うので、下書きを閉じるまで止まらない）。
    // プロフィール側の handleSongSearch は最初から検索の頭で止めている。
    it("検索し直したら試聴を止める", async () => {
        const paused = vi.fn();
        Object.defineProperty(HTMLMediaElement.prototype, "pause", {
            configurable: true, writable: true, value: paused,
        });

        await openSongPicker();
        await userEvent.type(screen.getByPlaceholderText("曲名・アーティスト名"), "あ{Enter}");
        await screen.findByText("ある曲");
        await userEvent.click(await screen.findByRole("button", { name: /試聴|停止/ }));
        paused.mockClear();

        // 別の語で引き直す（結果が入れ替わる）
        mockSearchSongs.mockResolvedValue([song("べつの曲")]);
        await userEvent.type(screen.getByPlaceholderText("曲名・アーティスト名"), "い{Enter}");
        await screen.findByText("べつの曲");

        expect(paused, "結果が入れ替わったのに鳴り続けている").toHaveBeenCalled();
        expect(screen.queryByRole("button", { name: "停止" }),
            "止める手段が無いのに再生中の表示が残っている").toBeNull();
    });

    // 検索が失敗したときも同じ（結果は空になり、行ごと消える）
    it("検索が失敗したときも試聴を止める", async () => {
        const paused = vi.fn();
        Object.defineProperty(HTMLMediaElement.prototype, "pause", {
            configurable: true, writable: true, value: paused,
        });

        await openSongPicker();
        await userEvent.type(screen.getByPlaceholderText("曲名・アーティスト名"), "あ{Enter}");
        await screen.findByText("ある曲");
        await userEvent.click(await screen.findByRole("button", { name: /試聴|停止/ }));
        paused.mockClear();

        mockSearchSongs.mockRejectedValue(new Error("network"));
        await userEvent.type(screen.getByPlaceholderText("曲名・アーティスト名"), "い{Enter}");
        await screen.findByText(/検索に失敗/);

        expect(paused, "検索が落ちたのに鳴り続けている").toHaveBeenCalled();
    });
});
