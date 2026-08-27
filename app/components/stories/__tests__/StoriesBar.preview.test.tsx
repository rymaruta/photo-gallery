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
});
