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

    // **一覧をまだ持っていない／取りに行っている最中でも効くこと。**
    //
    // 最初は `followingCache?.delete()` だけだった。外す先が無い回は
    // 何もできず、**押す前の一覧があとから書き戻って**「フォロー中」が
    // 復活する（レビューが実測）。しかも共有ストアなので、ギャラリーの
    // フォロー中フィードにもブロックした相手の写真が出続ける。
    // `resetFollowingCache` が持っていた `cacheGen` の札が、こちらには
    // 無かった
    it("一覧を取りに行っている最中でも効く", async () => {
        const mod = await load();
        let settle!: (v: unknown) => void;
        mockUserFetch.mockReturnValue(new Promise((r) => { settle = r; }));

        const first = renderHook(() => mod.useFollow(TARGET, true));
        await waitFor(() => expect(mockUserFetch).toHaveBeenCalled());

        // 一覧が届く前にブロックする
        mod.noteFollowSevered(TARGET);

        // 押す前の一覧があとから届く
        settle({ ok: true, json: async () => ({ userIds: [TARGET] }) });
        await waitFor(() => expect(first.result.current.resolved).toBe(true));

        // 取り直しは「切れたあと」の一覧を返す
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ userIds: [] }) });
        first.unmount();
        const again = renderHook(() => mod.useFollow(TARGET, true));
        await waitFor(() => expect(again.result.current.resolved).toBe(true));
        expect(again.result.current.isFollowing, "押す前の一覧が書き戻っている").toBe(false);
    });

    // **飛んでいるフォローの POST が着地して書き戻さないこと。**
    // `toggle` は成功したら `followingCache.add()` する。ブロックが
    // その間に挟まると、切れているのに「フォロー中」が共有ストアへ戻る
    it("押しかけのフォローが着地しても書き戻さない", async () => {
        const mod = await load();
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ userIds: [] }) });
        const { result } = renderHook(() => mod.useFollow(TARGET, true));
        await waitFor(() => expect(result.current.resolved).toBe(true));

        let settlePost!: (v: unknown) => void;
        mockUserFetch.mockReturnValue(new Promise((r) => { settlePost = r; }));
        const pressed = result.current.toggle();
        await waitFor(() => expect(result.current.pending).toBe(true));

        mod.noteFollowSevered(TARGET);
        settlePost({ ok: true, json: async () => ({ followers: 1 }) });
        await pressed;

        // 張り直すと「フォローしていない」
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ userIds: [] }) });
        const again = renderHook(() => mod.useFollow(TARGET, true));
        await waitFor(() => expect(again.result.current.resolved).toBe(true));
        expect(again.result.current.isFollowing, "着地した POST が書き戻している").toBe(false);
    });

    // **走っている数の取り込みは「押す前の数」。書き戻させない。**
    // `bumpCountsGen` を落としても全テストが緑だった（レビューが実証）
    // ——2本目は取り込みが終わってから撃つので、札が一度も効いていなかった
    it("取り込み中の古い数を書き戻させない", async () => {
        const mod = await load();
        let settleOld!: (v: unknown) => void;
        mockPublicFetch.mockReturnValueOnce(new Promise((r) => { settleOld = r; }));

        const { result } = renderHook(() => mod.useFollow(TARGET, true));
        await waitFor(() => expect(mockPublicFetch).toHaveBeenCalled());
        expect(result.current.countsKnown).toBe(false);

        // 取り込みが returning する前にブロック。取り直しは切れたあとの数
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ followers: 2, following: 1 }) });
        mod.noteFollowSevered(TARGET);

        // 押す前の数（3）があとから届く
        settleOld({ ok: true, json: async () => ({ followers: 3, following: 1 }) });

        await waitFor(() => expect(result.current.followers).toBe(2));
        expect(result.current.followers, "押す前の数が書き戻っている").toBe(2);
    });

    it("空の id では何もしない", async () => {
        const mod = await load();
        const before = mockPublicFetch.mock.calls.length;
        mod.noteFollowSevered("");
        expect(mockPublicFetch.mock.calls.length).toBe(before);
    });
});
