import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockSearchSongs = vi.hoisted(() => vi.fn());
vi.mock("../../utils/music", () => ({ searchSongs: mockSearchSongs }));

import { useSongSearch } from "../useSongSearch";

const song = (id: string) => ({ id, title: id, artist: "A", artworkUrl: "", previewUrl: "" });

beforeEach(() => { mockSearchSongs.mockReset(); });

// **3画面で同じものを書いていた。** しかも世代で追い越しを捨てる仕掛けは
// ストーリーにしか無く、残り2つでは遅れて返った古い結果が新しい結果を
// 上書きしていた（画面には打っていない語の結果が出る）。
describe("useSongSearch", () => {
    it("結果を返す", async () => {
        mockSearchSongs.mockResolvedValue([song("a")]);
        const { result } = renderHook(() => useSongSearch());
        await act(async () => { await result.current.search("旅"); });
        expect(result.current.results.map((s) => s.id)).toEqual(["a"]);
        expect(result.current.searching).toBe(false);
        expect(result.current.error).toBe(false);
    });

    it("空の語では引きに行かない", async () => {
        const { result } = renderHook(() => useSongSearch());
        await act(async () => { await result.current.search("   "); });
        expect(mockSearchSongs).not.toHaveBeenCalled();
    });

    it("失敗は0件と分ける", async () => {
        mockSearchSongs.mockRejectedValue(new Error("boom"));
        const { result } = renderHook(() => useSongSearch());
        await act(async () => { await result.current.search("旅"); });
        expect(result.current.error, "0件と同じ無反応になる").toBe(true);
        expect(result.current.results).toEqual([]);
        expect(result.current.searching).toBe(false);
    });

    // **追い越しを捨てる。** 遅れて返った古い結果で上書きしない
    it("古い応答は採用しない", async () => {
        let resolveOld: (v: unknown) => void = () => { };
        mockSearchSongs.mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }));
        mockSearchSongs.mockResolvedValueOnce([song("new")]);

        const { result } = renderHook(() => useSongSearch());
        act(() => { void result.current.search("きょう"); });
        await act(async () => { await result.current.search("今日"); });
        expect(result.current.results.map((s) => s.id)).toEqual(["new"]);

        await act(async () => { resolveOld([song("old")]); await Promise.resolve(); });
        expect(result.current.results.map((s) => s.id), "打っていない語の結果が出ている").toEqual(["new"]);
    });

    // **古い応答の失敗も採用しない。** 拾うと、成功している検索に
    // 「失敗しました」が出る
    it("古い応答の失敗も採用しない", async () => {
        let rejectOld: (e: unknown) => void = () => { };
        mockSearchSongs.mockImplementationOnce(() => new Promise((_r, rj) => { rejectOld = rj; }));
        mockSearchSongs.mockResolvedValueOnce([song("new")]);

        const { result } = renderHook(() => useSongSearch());
        act(() => { void result.current.search("きょう"); });
        await act(async () => { await result.current.search("今日"); });
        await act(async () => { rejectOld(new Error("late")); await Promise.resolve(); });
        expect(result.current.error).toBe(false);
        expect(result.current.results.map((s) => s.id)).toEqual(["new"]);
    });

    // **古い応答の終了処理も採用しない。** 拾うと、走っている検索の
    // 「検索中」が消えて無反応に見える
    it("古い応答は『検索中』を消さない", async () => {
        let resolveOld: (v: unknown) => void = () => { };
        mockSearchSongs.mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }));
        mockSearchSongs.mockImplementationOnce(() => new Promise(() => { /* 返らない */ }));

        const { result } = renderHook(() => useSongSearch());
        act(() => { void result.current.search("きょう"); });
        act(() => { void result.current.search("今日"); });
        await waitFor(() => expect(result.current.searching).toBe(true));

        await act(async () => { resolveOld([song("old")]); await Promise.resolve(); });
        expect(result.current.searching, "走っている検索が無反応に見える").toBe(true);
    });

    it("clear で結果と失敗を捨てる", async () => {
        mockSearchSongs.mockResolvedValue([song("a")]);
        const { result } = renderHook(() => useSongSearch());
        await act(async () => { await result.current.search("旅"); });
        act(() => { result.current.clear(); });
        expect(result.current.results).toEqual([]);
        expect(result.current.error).toBe(false);
    });

    // 閉じたあとに届いた応答で結果が埋まると、開き直したときに
    // 前回の検索結果が一瞬出る
    it("clear のあとに届いた応答は採用しない", async () => {
        let resolveLate: (v: unknown) => void = () => { };
        mockSearchSongs.mockImplementationOnce(() => new Promise((r) => { resolveLate = r; }));
        const { result } = renderHook(() => useSongSearch());
        act(() => { void result.current.search("旅"); });
        act(() => { result.current.clear(); });
        await act(async () => { resolveLate([song("late")]); await Promise.resolve(); });
        expect(result.current.results, "閉じたのに結果が埋まっている").toEqual([]);
    });
});
