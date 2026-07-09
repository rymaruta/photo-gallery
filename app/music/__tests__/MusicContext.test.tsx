import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { renderHook, act } from "@testing-library/react";
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
