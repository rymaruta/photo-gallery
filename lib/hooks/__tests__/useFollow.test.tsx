import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// フォロー状態が**まだ分かっていない**間を表す `resolved` が無かった頃は、
// 初期値の false を「未フォロー」と同じ扱いにしていた。一覧を取り終える前に
// ボタンが「フォロー」と出て、押しても既にフォロー済みで画面が変わらない。
// ログイン済みなのに「ログインしてください」が出る場面もあった。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());
vi.mock("../../utils/api", () => ({
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    userPublicFetch: (...a: unknown[]) => mockPublicFetch(...a),
    publicFetch: (...a: unknown[]) => mockPublicFetch(...a),
}));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const TARGET = "22222222-2222-4222-8222-222222222222";

function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

beforeEach(async () => {
    vi.resetModules();
    mockUserFetch.mockReset();
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ followers: 3, following: 1 }) });
});

async function load() {
    const mod = await import("../useFollow");
    mod.resetFollowingCache?.();
    return mod.useFollow;
}

describe("useFollow: 判定が終わるまで押させない", () => {
    it("一覧を取り終えるまで resolved は false", async () => {
        const slow = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
        mockUserFetch.mockReturnValue(slow.promise);
        const useFollow = await load();

        const { result } = renderHook(() => useFollow(TARGET, true));
        expect(result.current.resolved).toBe(false);

        slow.resolve({ ok: true, json: async () => ({ userIds: [TARGET] }) });
        await waitFor(() => expect(result.current.resolved).toBe(true));
        // 取り終えたらフォロー中と分かる
        expect(result.current.isFollowing).toBe(true);
    });

    it("取得に失敗しても resolved は立つ（永久に押せないボタンにしない）", async () => {
        mockUserFetch.mockImplementation(() => Promise.reject(new Error("down")));
        const useFollow = await load();

        const { result } = renderHook(() => useFollow(TARGET, true));
        await waitFor(() => expect(result.current.resolved).toBe(true));
    });

    it("未ログインなら待たずに確定する（フォローしていないと分かっている）", async () => {
        const useFollow = await load();
        const { result } = renderHook(() => useFollow(TARGET, false));
        await waitFor(() => expect(result.current.resolved).toBe(true));
        expect(result.current.isFollowing).toBe(false);
        // 一覧は取りにいかない
        expect(mockUserFetch).not.toHaveBeenCalled();
    });
});
