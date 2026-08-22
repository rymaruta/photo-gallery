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

// 数を描かない呼び出し元（ボタン単体）まで無条件に GET /users/<id>/follow を
// 投げていた。ユーザー検索では結果1件ごとに1本、どこにも描かれない数の
// 問い合わせが飛ぶ。数が要るかは呼び出し元が知っているので、引数で断れるようにした。
describe("useFollow: 数を使わない呼び出し元は数の問い合わせを飛ばさない", () => {
    it("withCounts=false なら数を取りに行かない", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ userIds: [] }) });
        const useFollow = await load();

        const { result } = renderHook(() => useFollow(TARGET, true, false));
        await waitFor(() => expect(result.current.resolved).toBe(true));
        expect(mockPublicFetch).not.toHaveBeenCalled();
    });

    it("既定では取りに行く（数のピルの表示を壊していない）", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ userIds: [] }) });
        const useFollow = await load();

        const { result } = renderHook(() => useFollow(TARGET, true));
        await waitFor(() => expect(result.current.followers).toBe(3));
        expect(mockPublicFetch).toHaveBeenCalledWith(`/users/${encodeURIComponent(TARGET)}/follow`);
    });
});
