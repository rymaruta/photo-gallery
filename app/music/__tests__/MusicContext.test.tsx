import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { MusicProvider, useMusic, type SongEntry } from "../MusicContext";

// jsdom は HTMLMediaElement.play/pause を実装しないためスタブする
beforeAll(() => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => { /* noop */ });
});

const songs: SongEntry[] = [
    { title: "曲A", previewUrl: "https://p.test/a.m4a" },
    { title: "曲B", previewUrl: "https://p.test/b.m4a" },
    { title: "曲C", previewUrl: "https://p.test/c.m4a" },
];

function wrapper({ children }: { children: React.ReactNode }) {
    return <MusicProvider>{children}</MusicProvider>;
}

describe("MusicContext（グローバル音楽プレイヤー）", () => {
    it("初期状態は何も再生していない", () => {
        const { result } = renderHook(() => useMusic(), { wrapper });
        expect(result.current.current).toBeNull();
        expect(result.current.playing).toBe(false);
    });

    it("play でキューを読み込んで再生状態になる", () => {
        const { result } = renderHook(() => useMusic(), { wrapper });
        act(() => result.current.play("bgm:u1", songs, 0, "マイBGM"));
        expect(result.current.current?.title).toBe("曲A");
        expect(result.current.playing).toBe(true);
        expect(result.current.label).toBe("マイBGM");
        expect(result.current.queueKey).toBe("bgm:u1");
    });

    it("同じ曲をもう一度 play すると一時停止/再開のトグルになる", () => {
        const { result } = renderHook(() => useMusic(), { wrapper });
        act(() => result.current.play("bgm:u1", songs, 0));
        act(() => result.current.play("bgm:u1", songs, 0));
        expect(result.current.playing).toBe(false);
        act(() => result.current.play("bgm:u1", songs, 0));
        expect(result.current.playing).toBe(true);
    });

    it("別のキューを play すると差し替えて最初から再生する", () => {
        const { result } = renderHook(() => useMusic(), { wrapper });
        act(() => result.current.play("bgm:u1", songs, 2));
        act(() => result.current.play("trip:t1", [songs[1]], 0, "この旅のBGM"));
        expect(result.current.queueKey).toBe("trip:t1");
        expect(result.current.current?.title).toBe("曲B");
        expect(result.current.label).toBe("この旅のBGM");
    });

    it("next / prev はキュー内をループする", () => {
        const { result } = renderHook(() => useMusic(), { wrapper });
        act(() => result.current.play("bgm:u1", songs, 2));
        act(() => result.current.next());
        expect(result.current.index).toBe(0); // 末尾→先頭にループ
        act(() => result.current.prev());
        expect(result.current.index).toBe(2);
    });

    it("stop で完全に停止してミニプレイヤーが消える状態になる", () => {
        const { result } = renderHook(() => useMusic(), { wrapper });
        act(() => result.current.play("bgm:u1", songs, 0));
        act(() => result.current.stop());
        expect(result.current.current).toBeNull();
        expect(result.current.queueKey).toBeNull();
        expect(result.current.playing).toBe(false);
    });

    it("Provider の外では no-op（クラッシュしない）", () => {
        const { result } = renderHook(() => useMusic());
        expect(() => {
            act(() => result.current.play("x", songs));
            act(() => result.current.stop());
        }).not.toThrow();
        expect(result.current.current).toBeNull();
    });
});

describe("シャッフルと1曲リピート", () => {
    it("toggleShuffle / toggleRepeatOne で状態が切り替わる", () => {
        const { result } = renderHook(() => useMusic(), { wrapper });
        act(() => result.current.play("bgm:u1", songs, 0));
        act(() => result.current.toggleShuffle());
        expect(result.current.shuffle).toBe(true);
        act(() => result.current.toggleRepeatOne());
        expect(result.current.repeatOne).toBe(true);
        act(() => result.current.toggleShuffle());
        expect(result.current.shuffle).toBe(false);
    });

    it("シャッフル時の next は今と違う曲を選ぶ", () => {
        const rand = vi.spyOn(Math, "random").mockReturnValue(0); // → 候補の先頭
        const { result } = renderHook(() => useMusic(), { wrapper });
        act(() => result.current.play("bgm:u1", songs, 0));
        act(() => result.current.toggleShuffle());
        act(() => result.current.next());
        // index 0 の曲は除外されるので、必ず別の曲になる
        expect(result.current.index).not.toBe(0);
        rand.mockRestore();
    });

    it("キューを差し替えてもシャッフル/リピート設定は保持される", () => {
        const { result } = renderHook(() => useMusic(), { wrapper });
        act(() => result.current.play("bgm:u1", songs, 0));
        act(() => result.current.toggleShuffle());
        act(() => result.current.play("trip:t1", [songs[1]], 0));
        expect(result.current.shuffle).toBe(true);
    });
});

// 別の写真が同じ曲を持っていることがある。その写真で再生を押すと
// queueKey は変わるのに previewUrl は同じなので、src しか見ていなかった頃は
// 「変わっていない」と判断して再生を始めず、状態だけ playing:true になった
// ——**「再生中」の見た目のまま音が出ない**。
describe("同じ曲を持つ別の写真から再生する", () => {
    it("止まっている状態から、別の列の同じ曲を鳴らせる", async () => {
        const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play");
        // 「今は止まっている」ことを再現する
        vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockReturnValue(true);
        const { result } = renderHook(() => useMusic(), { wrapper });

        // 写真Aの列で再生 → 止める
        act(() => result.current.play("photo-A", [songs[0]], 0));
        act(() => result.current.toggle());
        expect(result.current.playing).toBe(false);

        playSpy.mockClear();
        // 写真Bの列で同じ曲を再生（previewUrl は同じ、queueKey だけ違う）
        act(() => result.current.play("photo-B", [songs[0]], 0));

        expect(result.current.playing).toBe(true);
        expect(result.current.current?.previewUrl).toBe(songs[0].previewUrl);
        // 見た目だけでなく、実際に鳴らしにいっている
        await waitFor(() => expect(playSpy).toHaveBeenCalled());
        vi.restoreAllMocks();
        vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
        vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => { /* noop */ });
    });

    it("既に同じ音が鳴っているなら触らない（頭出しに戻さない）", async () => {
        const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play");
        vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockReturnValue(false);
        const { result } = renderHook(() => useMusic(), { wrapper });

        act(() => result.current.play("photo-A", [songs[0]], 0));
        await waitFor(() => expect(result.current.playing).toBe(true));
        playSpy.mockClear();

        act(() => result.current.play("photo-B", [songs[0]], 0));
        await new Promise((r) => setTimeout(r, 10));
        expect(playSpy).not.toHaveBeenCalled();
        vi.restoreAllMocks();
        vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
        vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => { /* noop */ });
    });
});

// ロック画面・コントロールセンター・AirPods を外す・着信で iOS が止めても、
// 状態は画面から操作したときしか変わらなかった。ミニプレイヤーは「再生中」の
// まま、▶ を押すと toggle が pause() を呼ぶだけで、2回押さないと鳴らなかった
// （docs/ios-bug-audit-2026-09-25.md #19）。
describe("画面の外で止まった・鳴り出したのを状態に映す", () => {
    it("iOS 側で止まったら「止まっている」になり、次の1回で鳴る", () => {
        const pausedGet = vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockReturnValue(false);
        const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play");
        const { result } = renderHook(() => useMusic(), { wrapper });
        act(() => result.current.play("bgm:u1", songs, 0));
        expect(result.current.playing).toBe(true);

        // ロック画面で一時停止した（要素は止まり、pause が届く）
        pausedGet.mockReturnValue(true);
        const audio = document.querySelector("audio")!;
        act(() => { audio.dispatchEvent(new Event("pause")); });
        expect(result.current.playing, "止まったのに「再生中」のまま").toBe(false);

        playSpy.mockClear();
        act(() => result.current.toggle());
        expect(playSpy, "1回押しても鳴らない").toHaveBeenCalledTimes(1);
        expect(result.current.playing).toBe(true);
        pausedGet.mockRestore();
    });

    it("曲の差し替えの直後に届く pause は、もう鳴らしていれば無視する", () => {
        const pausedGet = vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockReturnValue(false);
        const { result } = renderHook(() => useMusic(), { wrapper });
        act(() => result.current.play("bgm:u1", songs, 0));
        const audio = document.querySelector("audio")!;
        act(() => { audio.dispatchEvent(new Event("pause")); });
        expect(result.current.playing).toBe(true);
        pausedGet.mockRestore();
    });

    it("iOS 側で鳴り出したら「再生中」になる", () => {
        const { result } = renderHook(() => useMusic(), { wrapper });
        act(() => result.current.play("bgm:u1", songs, 0));
        act(() => result.current.toggle());
        expect(result.current.playing).toBe(false);
        const audio = document.querySelector("audio")!;
        act(() => { audio.dispatchEvent(new Event("play")); });
        expect(result.current.playing).toBe(true);
    });
});

// ロック画面に曲名が出ず、「次へ／前へ」も無かった（#20）。
describe("ロック画面の曲情報と操作（Media Session）", () => {
    it("曲名・歌手・ジャケットを出し、次へ・前へ・再生・一時停止を受ける", () => {
        const handlers: Record<string, (() => void) | null> = {};
        const ms = { metadata: null as unknown, playbackState: "none", setActionHandler: (a: string, fn: (() => void) | null) => { handlers[a] = fn; } };
        Object.defineProperty(navigator, "mediaSession", { value: ms, configurable: true });
        class FakeMeta { constructor(public init: Record<string, unknown>) {} }
        vi.stubGlobal("MediaMetadata", FakeMeta);
        try {
            const q: SongEntry[] = [
                { title: "曲A", artist: "歌手A", artwork: "https://is1-ssl.mzstatic.com/a.jpg", previewUrl: "https://p.test/a.m4a" },
                songs[1],
            ];
            const { result } = renderHook(() => useMusic(), { wrapper });
            act(() => result.current.play("bgm:u1", q, 0));
            const meta = (ms.metadata as FakeMeta).init;
            expect(meta.title).toBe("曲A");
            expect(meta.artist).toBe("歌手A");
            expect(ms.playbackState).toBe("playing");
            expect(handlers.nexttrack).toBeTypeOf("function");

            act(() => handlers.nexttrack!());
            expect(result.current.index).toBe(1);
            act(() => handlers.pause!());
            expect(result.current.playing).toBe(false);
            expect(ms.playbackState).toBe("paused");
            act(() => handlers.play!());
            expect(result.current.playing).toBe(true);
        } finally {
            delete (navigator as unknown as Record<string, unknown>).mediaSession;
            vi.unstubAllGlobals();
        }
    });
});
