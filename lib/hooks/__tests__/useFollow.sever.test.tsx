import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// **ブロックでフォローが切れたことを、押した人の画面へ反映する。**
//
// 最初はここで `resetFollowingCache()`（ログアウト用）を撃っていた。
// レビューが実測して分かったのは、それが**直すつもりの症状を直さず、
// 別の症状を作る**こと:
//
//   - `isFollowing` はこの共有ストアではなく**コンポーネントの state**。
//     リセットしても effect が回らないので「フォロー中」のまま
//   - `counts.clear()` は即座に効くので `countsKnown` が true → false。
//     数のピルが消え、取り直しの契機は `online` / `visibilitychange`
//     しか無いのでそのタブでは戻らない
//
// ＝「フォロー中のまま、数字だけ消える」。直す前より悪い。
// `noteFollowSevered` は一覧から外して数は**取り直す**。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());
vi.mock("../../utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../utils/api")>()),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
    userPublicFetch: (...a: unknown[]) => mockPublicFetch(...a),
    publicFetch: (...a: unknown[]) => mockPublicFetch(...a),
}));
vi.mock("@/lib/utils/log", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const TARGET = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
    vi.resetModules();
    mockUserFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ userIds: [TARGET] }) });
    mockPublicFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ followers: 3, following: 1 }) });
});

async function load() {
    const mod = await import("../useFollow");
    mod.resetFollowingCache();
    return mod;
}

describe("noteFollowSevered: ブロックで切れたフォローを反映する", () => {
    it("張り直すと「フォローしていない」になる", async () => {
        const mod = await load();
        const first = renderHook(() => mod.useFollow(TARGET, true));
        await waitFor(() => expect(first.result.current.isFollowing).toBe(true));

        mod.noteFollowSevered(TARGET);

        // 張り直す＝呼び出し側が `key` を変える（`UserProfileClient`）
        first.unmount();
        const again = renderHook(() => mod.useFollow(TARGET, true));
        await waitFor(() => expect(again.result.current.resolved).toBe(true));
        expect(again.result.current.isFollowing, "一覧から外れていない").toBe(false);
    });

    // **数のピルを消さない。** ここが `resetFollowingCache()` との違い
    it("数は消さずに取り直す（ピルが「…」に化けない）", async () => {
        const mod = await load();
        const { result } = renderHook(() => mod.useFollow(TARGET, true));
        await waitFor(() => expect(result.current.countsKnown).toBe(true));

        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ followers: 2, following: 1 }) });
        const before = mockPublicFetch.mock.calls.length;
        mod.noteFollowSevered(TARGET);

        // 一度も未取得（`countsKnown === false`）に落ちない
        expect(result.current.countsKnown, "数を捨てている（ピルが消える）").toBe(true);
        await waitFor(() => expect(result.current.followers).toBe(2));
        expect(mockPublicFetch.mock.calls.length, "取り直していない").toBeGreaterThan(before);
    });

    // 逆向きの確認: ログアウト用の方は数を捨てる（用途が違う）
    it("resetFollowingCache は数を捨てる（だからブロックには使えない）", async () => {
        const mod = await load();
        const { result } = renderHook(() => mod.useFollow(TARGET, true));
        await waitFor(() => expect(result.current.countsKnown).toBe(true));

        mod.resetFollowingCache();
        await waitFor(() => expect(result.current.countsKnown).toBe(false));
    });

    it("空の id では何もしない", async () => {
        const mod = await load();
        const before = mockPublicFetch.mock.calls.length;
        mod.noteFollowSevered("");
        expect(mockPublicFetch.mock.calls.length).toBe(before);
    });
});
