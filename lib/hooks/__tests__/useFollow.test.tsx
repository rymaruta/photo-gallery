import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

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

// ログアウトの掃除（resetFollowingCache）と取得中の Promise の競合。
// 取得中にリセット → 取得完了、の順だと、完了時の `followingCache = set` が
// 空にしたはずのキャッシュへ**前の人のフォロー一覧を書き戻していた**。
// 同じタブで別の人がログインすると、その一覧がそのまま使われる。
describe("fetchFollowingSet: リセット後に古い取得結果を書き戻さない", () => {
    it("取得中にリセットされたら、結果をキャッシュに残さない（次は取り直す）", async () => {
        const slow = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
        mockUserFetch.mockReturnValueOnce(slow.promise);
        const mod = await import("../useFollow");
        mod.resetFollowingCache();

        const first = mod.fetchFollowingSet();          // 取得開始（未完了）
        mod.resetFollowingCache();                       // その間にログアウト
        slow.resolve({ ok: true, json: async () => ({ userIds: [TARGET] }) });
        expect([...(await first)]).toEqual([TARGET]);    // 待っていた人には返る

        // キャッシュには残っていない＝次の呼び出しは取り直す
        mockUserFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ userIds: [] }) });
        const second = await mod.fetchFollowingSet();
        expect(second.size).toBe(0);
        expect(mockUserFetch).toHaveBeenCalledTimes(2);
    });

    it("旧い取得が後から完了しても、リセット後の新しい取得の結果が残る", async () => {
        const oldFetch = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
        const newFetch = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
        mockUserFetch.mockReturnValueOnce(oldFetch.promise).mockReturnValueOnce(newFetch.promise);
        const mod = await import("../useFollow");
        mod.resetFollowingCache();

        const oldP = mod.fetchFollowingSet();   // Aの取得（未完了）
        mod.resetFollowingCache();               // ログアウト
        const newP = mod.fetchFollowingSet();   // Bの取得（未完了）

        // Aの取得が**あとから**完了する
        oldFetch.resolve({ ok: true, json: async () => ({ userIds: [TARGET] }) });
        await oldP;

        // 旧い完了が新しい取得の参照を消していない＝3本目を投げない
        const again = mod.fetchFollowingSet();
        expect(mockUserFetch).toHaveBeenCalledTimes(2);

        newFetch.resolve({ ok: true, json: async () => ({ userIds: ["b-user"] }) });
        expect([...(await newP)]).toEqual(["b-user"]);
        expect([...(await again)]).toEqual(["b-user"]);
        // キャッシュに残るのはBの一覧（Aのは書き戻されていない）
        const cached = await mod.fetchFollowingSet();
        expect([...cached]).toEqual(["b-user"]);
        expect(mockUserFetch).toHaveBeenCalledTimes(2);
    });

    it("リセットを挟まなければキャッシュされる（取り直さない）", async () => {
        mockUserFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ userIds: [TARGET] }) });
        const mod = await import("../useFollow");
        mod.resetFollowingCache();

        await mod.fetchFollowingSet();
        await mod.fetchFollowingSet();
        expect(mockUserFetch).toHaveBeenCalledTimes(1);
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

// 失敗を空 Set で誤魔化さない（SW-b1）。空を返すと、フォロー中フィードが
// 「誰もフォローしていない」空表示に化けて気づけない。
describe("fetchFollowingSet: 失敗は投げる", () => {
    it("!ok は reject（空 Set を返して0件に化けさせない）", async () => {
        mockUserFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        const mod = await import("../useFollow");
        mod.resetFollowingCache();
        await expect(mod.fetchFollowingSet()).rejects.toThrow();
        // 失敗はキャッシュされない＝次は取り直す
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ userIds: [TARGET] }) });
        expect([...(await mod.fetchFollowingSet())]).toEqual([TARGET]);
    });
});

// resetFollowingCache が listeners.clear() で購読ごと消していた（FS-5）。
// マウントされたままのコンポーネントは targetUserId が変わるまで再購読せず、
// 以後フォロー数が永久に更新されない。今はログインが必ずページ遷移を
// 伴うので実害は出ていないが、モーダルログインを入れた瞬間に踏む地雷。
describe("resetFollowingCache: 購読を切らない", () => {
    it("リセット後も、マウント中のコンポーネントに数の更新が届く", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ userIds: [] }) });
        const mod = await import("../useFollow");
        mod.resetFollowingCache();

        const { result } = renderHook(() => mod.useFollow(TARGET, true));
        await waitFor(() => expect(result.current.followers).toBe(3));

        // ログアウト相当。数は 0 に戻る（購読が生きていれば再描画される）
        act(() => { mod.resetFollowingCache(); });
        await waitFor(() => expect(result.current.followers).toBe(0));

        // 別のコンポーネントが同じ相手の数を取り直したら、こちらにも届く
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ followers: 9, following: 2 }) });
        renderHook(() => mod.useFollow(TARGET, true));
        await waitFor(() => expect(result.current.followers).toBe(9));
    });
});
