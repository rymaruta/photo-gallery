import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";

// フォロー状態が**まだ分かっていない**間を表す `resolved` が無かった頃は、
// 初期値の false を「未フォロー」と同じ扱いにしていた。一覧を取り終える前に
// ボタンが「フォロー」と出て、押しても既にフォロー済みで画面が変わらない。
// ログイン済みなのに「ログインしてください」が出る場面もあった。

const mockUserFetch = vi.hoisted(() => vi.fn());
const mockPublicFetch = vi.hoisted(() => vi.fn());
// **実物を土台にする。** 列挙だけだと、実装が新しく使い始めた export
// （`readApiError` など）が undefined になり、呼んだ瞬間に投げたものを
// catch が飲む——緑のまま間違ったことを測るテストになる。
vi.mock("../../utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../utils/api")>()),
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

// **「まだ分からない」と「0人」を混ぜていた。**
//
// 数は共有ストアから `?? EMPTY`（0/0）で読んでいたので、取得が落ちた人の
// プロフィールは「フォロワー 0 / フォロー中 0」と言い切っていた——失敗の
// 印も再試行の導線も無く、本当に0人の人と区別が付かない。
describe("フォロー数が分かっていない間", () => {
    // **フェイクタイマーで回して、最後に片付ける。**
    // 実タイマーのままだと、失敗した取り込みの撃ち直し（400ms → 800ms の
    // バックオフ）が**このテストが終わったあとに発火**する。`loadCounts` は
    // モジュール側の関数なので、コンポーネントを片付けても止まらない
    // ——あとのテストの「呼ばれていないこと」を壊す。**フルスイートでだけ
    // 落ちるフレークの正体がこれだった**（単体では次のテストまでに落ち着く
    // ので出ない。実測: フル3回で1回、単体10回で0回）。
    it("取得に失敗したら「0人」と言わない（countsKnown=false）", async () => {
        vi.useFakeTimers();
        try {
            mockPublicFetch.mockRejectedValue(new Error("network"));
            const useFollow = await load();

            const { result } = renderHook(() => useFollow(TARGET, false));
            await vi.advanceTimersByTimeAsync(5000);   // 撃ち直しを使い切らせる

            expect(result.current.resolved).toBe(true);
            expect(result.current.countsKnown, "取れていないのに数を言い切っている").toBe(false);
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
            cleanup();
        }
    });

    // **一度落ちたら二度と出ない、を避ける。** 数は「取れるまで出さない」
    // ようにしたので、落ちたままだとピルが永久に出ない——このフックの
    // effect は再取得の契機を持たない（失敗表示と再試行ボタンがある他の
    // 画面と違い、ここには導線が無い）。待ってから撃ち直す。
    it("一度落ちても、やり直して取れたら出す", async () => {
        vi.useFakeTimers();
        try {
            const useFollow = await load();
            mockPublicFetch
                .mockRejectedValueOnce(new Error("network"))
                .mockResolvedValue({ ok: true, json: async () => ({ followers: 7, following: 2 }) });

            const { result } = renderHook(() => useFollow(TARGET, false));
            await vi.advanceTimersByTimeAsync(1000);

            expect(result.current.countsKnown, "やり直していない").toBe(true);
            expect(result.current.followers).toBe(7);
        } finally {
            // **残ったタイマーと購読も片付ける。** これを外すと、失敗経路の
            // 撃ち直し（指数バックオフの sleep）が**フェイクタイマーを
            // 戻したあとに実タイマーで動き出し**、あとのテストの
            // 「呼ばれていないこと」を壊す。フルスイートでだけ落ちる
            // フレークの正体がこれだった（単体では次のテストまでに
            // 落ち着くので出ない）
            vi.clearAllTimers();
            vi.useRealTimers();
            cleanup();
        }
    });

    // **撃ち直しを使い切ったあとの契機。** 2回まで撃ち直しても駄目だと
    // ピルは永久に出ない（この effect は targetUserId などでしか回らない）。
    // 失敗表示と再試行ボタンを足すのはデザインの追加になるので、
    // 「戻ってきた／回線が戻った」を契機にする。
    it("使い切ったあとでも、タブに戻れば取り直す", async () => {
        vi.useFakeTimers();
        try {
            const useFollow = await load();
            mockPublicFetch.mockRejectedValue(new Error("network"));

            const { result } = renderHook(() => useFollow(TARGET, false));
            await vi.advanceTimersByTimeAsync(5000);
            expect(result.current.countsKnown).toBe(false);
            const spent = mockPublicFetch.mock.calls.length;

            // 別のタブへ行って戻ってくる（今度はサーバーが答える）
            mockPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ followers: 5, following: 4 }) });
            await act(async () => {
                document.dispatchEvent(new Event("visibilitychange"));
                await vi.advanceTimersByTimeAsync(50);
            });

            expect(mockPublicFetch.mock.calls.length, "戻ってきても取り直していない").toBeGreaterThan(spent);
            await act(async () => { await vi.advanceTimersByTimeAsync(50); });
            expect(result.current.countsKnown, "取り直したのに数が出ていない").toBe(true);
            expect(result.current.followers).toBe(5);
        } finally {
            // **残ったタイマーと購読も片付ける。** これを外すと、失敗経路の
            // 撃ち直し（指数バックオフの sleep）が**フェイクタイマーを
            // 戻したあとに実タイマーで動き出し**、あとのテストの
            // 「呼ばれていないこと」を壊す。フルスイートでだけ落ちる
            // フレークの正体がこれだった（単体では次のテストまでに
            // 落ち着くので出ない）
            vi.clearAllTimers();
            vi.useRealTimers();
            cleanup();
        }
    });

    it("回線が戻ったときも取り直す", async () => {
        vi.useFakeTimers();
        try {
            const useFollow = await load();
            mockPublicFetch.mockRejectedValue(new Error("network"));

            const { result } = renderHook(() => useFollow(TARGET, false));
            await vi.advanceTimersByTimeAsync(5000);
            const spent = mockPublicFetch.mock.calls.length;

            mockPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ followers: 1, following: 1 }) });
            await act(async () => {
                window.dispatchEvent(new Event("online"));
                await vi.advanceTimersByTimeAsync(50);
            });

            expect(mockPublicFetch.mock.calls.length).toBeGreaterThan(spent);
            await act(async () => { await vi.advanceTimersByTimeAsync(50); });
            expect(result.current.countsKnown).toBe(true);
        } finally {
            // **残ったタイマーと購読も片付ける。** これを外すと、失敗経路の
            // 撃ち直し（指数バックオフの sleep）が**フェイクタイマーを
            // 戻したあとに実タイマーで動き出し**、あとのテストの
            // 「呼ばれていないこと」を壊す。フルスイートでだけ落ちる
            // フレークの正体がこれだった（単体では次のテストまでに
            // 落ち着くので出ない）
            vi.clearAllTimers();
            vi.useRealTimers();
            cleanup();
        }
    });

    // 取れている人の画面では、タブを切り替えても問い合わせを増やさない
    it("数が取れていれば、戻ってきても取り直さない", async () => {
        const useFollow = await load();
        const { result } = renderHook(() => useFollow(TARGET, false));
        await waitFor(() => expect(result.current.countsKnown).toBe(true));
        const spent = mockPublicFetch.mock.calls.length;

        await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });

        expect(mockPublicFetch.mock.calls.length, "取れているのに撃ち直している").toBe(spent);
    });

    it("やり直しても駄目なら、数は出さない（0 と言わない）", async () => {
        vi.useFakeTimers();
        try {
            const useFollow = await load();
            mockPublicFetch.mockRejectedValue(new Error("network"));

            const { result } = renderHook(() => useFollow(TARGET, false));
            await vi.advanceTimersByTimeAsync(5000);

            expect(result.current.countsKnown).toBe(false);
            // 撃ち直しは上限まで（初回 + COUNTS_RETRIES=2）
            expect(mockPublicFetch.mock.calls.length, "際限なく撃ち直している").toBe(3);
        } finally {
            // **残ったタイマーと購読も片付ける。** これを外すと、失敗経路の
            // 撃ち直し（指数バックオフの sleep）が**フェイクタイマーを
            // 戻したあとに実タイマーで動き出し**、あとのテストの
            // 「呼ばれていないこと」を壊す。フルスイートでだけ落ちる
            // フレークの正体がこれだった（単体では次のテストまでに
            // 落ち着くので出ない）
            vi.clearAllTimers();
            vi.useRealTimers();
            cleanup();
        }
    });

    // **押したあとに、押す前の数で上書きしない。** いいね側で `touchedRef` を
    // 入れて潰したのと同じ形（`b685b5e`）が、こちらに残っていた。
    // 走っていた取り込みは世代で弾き、代わりに押したあとの数を取り直す
    // （サーバーが返すのは `followers` だけで `following` は分からないため）。
    it("取り込み中に押したら、古い数で巻き戻さず取り直す", async () => {
        const useFollow = await load();
        const settlers: Array<(v: unknown) => void> = [];
        mockPublicFetch.mockImplementation(() => new Promise((res) => { settlers.push(res); }));
        mockUserFetch.mockImplementation((url: string) =>
            Promise.resolve(url === "/user/following"
                ? { ok: true, json: async () => ({ userIds: [] }) }
                : { ok: true, json: async () => ({ followers: 4 }) }));

        const { result } = renderHook(() => useFollow(TARGET, true));
        await waitFor(() => expect(result.current.resolved).toBe(true));
        await waitFor(() => expect(settlers.length).toBe(1));   // 1本目の取り込みが飛んでいる

        await act(async () => { await result.current.toggle(); });
        // 押したので取り直しが飛ぶ
        await waitFor(() => expect(settlers.length).toBe(2));

        // 1本目（押す前の数）がいま着地する → 弾かれる
        await act(async () => {
            settlers[0]({ ok: true, json: async () => ({ followers: 3, following: 1 }) });
            await Promise.resolve();
        });
        expect(result.current.countsKnown, "押す前の数を採っている").toBe(false);

        // 取り直しの答え（押したあとの数）が着地する
        await act(async () => {
            settlers[1]({ ok: true, json: async () => ({ followers: 4, following: 1 }) });
            await Promise.resolve();
        });
        expect(result.current.followers).toBe(4);
        expect(result.current.following).toBe(1);
    });

    // **本番の形で確かめる。** `toggle()` を呼ぶのは `FollowAction`
    // （`withCounts=false`）だけで、数のピルを描くのは同じ画面の
    // `FollowButton`（`withCounts=true`）。「押した側が数を取らない」ので、
    // 押した側だけを見ていると**誰も取り直さない**穴に気づけない
    // （実際、この形のテストが無かったので素通りした）。
    describe("本番の組み合わせ（押す側は数を取らない）", () => {
        function renderPair() {
            const pill = renderHook(() => useFollowRef.current!(TARGET, true));      // FollowButton 相当
            const action = renderHook(() => useFollowRef.current!(TARGET, true, false)); // FollowAction 相当
            return { pill, action };
        }
        const useFollowRef: { current: Awaited<ReturnType<typeof load>> | null } = { current: null };

        beforeEach(async () => { useFollowRef.current = await load(); });

        it("取り込み中に押しても、ピルは出る", async () => {
            const settlers: Array<(v: unknown) => void> = [];
            mockPublicFetch.mockImplementation(() => new Promise((res) => { settlers.push(res); }));
            mockUserFetch.mockImplementation((url: string) =>
                Promise.resolve(url === "/user/following"
                    ? { ok: true, json: async () => ({ userIds: [] }) }
                    : { ok: true, json: async () => ({ followers: 4 }) }));

            const { pill, action } = renderPair();
            await waitFor(() => expect(action.result.current.resolved).toBe(true));
            await waitFor(() => expect(settlers.length).toBe(1));

            await act(async () => { await action.result.current.toggle(); });
            // 押した側は数を取らない。潰した取り込みを誰かが取り直す必要がある
            await waitFor(() => expect(settlers.length).toBe(2));
            await act(async () => {
                settlers[1]({ ok: true, json: async () => ({ followers: 4, following: 1 }) });
                await Promise.resolve();
            });

            expect(pill.result.current.countsKnown, "押したらピルが永久に出なくなっている").toBe(true);
            expect(pill.result.current.followers).toBe(4);
        });

        it("押して失敗したときも、ピルは出る", async () => {
            const settlers: Array<(v: unknown) => void> = [];
            mockPublicFetch.mockImplementation(() => new Promise((res) => { settlers.push(res); }));
            mockUserFetch.mockImplementation((url: string) =>
                Promise.resolve(url === "/user/following"
                    ? { ok: true, json: async () => ({ userIds: [] }) }
                    : { ok: false, status: 503, json: async () => ({ error: "だめ" }) }));

            const { pill, action } = renderPair();
            await waitFor(() => expect(action.result.current.resolved).toBe(true));
            await waitFor(() => expect(settlers.length).toBe(1));

            await act(async () => { await action.result.current.toggle(); });
            await waitFor(() => expect(settlers.length).toBe(2));
            await act(async () => {
                settlers[1]({ ok: true, json: async () => ({ followers: 3, following: 1 }) });
                await Promise.resolve();
            });

            expect(pill.result.current.countsKnown, "失敗のあとピルが出なくなっている").toBe(true);
            expect(pill.result.current.followers).toBe(3);
        });

        // **古い取り込みの後片付けが、新しい札を消していた。**
        // 走っている取り込みは `finally` で無条件に札を外していたので、
        // 押した拍子に始まった取り直しの札まで消える——そのあと同じ相手を
        // 見る購読者が現れると、まだ走っているのに**3本目**が飛ぶ。
        // すぐ上の `fetchFollowingSet` は同じ理由で自分の札だけ外している。
        it("古い取り込みの完了が、取り直しの札を消さない", async () => {
            const settlers: Array<(v: unknown) => void> = [];
            mockPublicFetch.mockImplementation(() => new Promise((res) => { settlers.push(res); }));
            mockUserFetch.mockImplementation((url: string) =>
                Promise.resolve(url === "/user/following"
                    ? { ok: true, json: async () => ({ userIds: [] }) }
                    : { ok: true, json: async () => ({ followers: 4 }) }));

            const { action } = renderPair();
            await waitFor(() => expect(action.result.current.resolved).toBe(true));
            await waitFor(() => expect(settlers.length).toBe(1));   // p1

            await act(async () => { await action.result.current.toggle(); });
            await waitFor(() => expect(settlers.length).toBe(2));   // p2（取り直し）

            // p1 だけが遅れて着地する（p2 はまだ走っている）
            await act(async () => {
                settlers[0]({ ok: true, json: async () => ({ followers: 3, following: 1 }) });
                await Promise.resolve();
            });

            // ここで同じ相手を見る購読者が増える（別のタブ・別の部品）
            renderHook(() => useFollowRef.current!(TARGET, true));
            await act(async () => { await Promise.resolve(); });

            expect(settlers.length, "走っている取り込みがあるのに投げ直している").toBe(2);
        });

        // 取り込んでいない画面（ユーザー検索の一覧）では、押しても取りに行かない
        it("取り込んでいなければ、押しても取りに行かない", async () => {
            mockPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ followers: 1, following: 1 }) });
            mockUserFetch.mockImplementation((url: string) =>
                Promise.resolve(url === "/user/following"
                    ? { ok: true, json: async () => ({ userIds: [] }) }
                    : { ok: true, json: async () => ({ followers: 2 }) }));

            const action = renderHook(() => useFollowRef.current!(TARGET, true, false));
            await waitFor(() => expect(action.result.current.resolved).toBe(true));
            await act(async () => { await action.result.current.toggle(); });

            expect(mockPublicFetch, "数を描かない画面から GET を増やしている").not.toHaveBeenCalled();
        });
    });

    // **画面を離れたら撃ち直しをやめる。** `loadCounts` はモジュール側の
    // 関数なので、アンマウントでは止まらず、結果を誰も読まないまま最大2本の
    // GET が飛んでいた。テストでは、終わったあとの発火が**次のテストの
    // 「呼ばれていないこと」を壊していた**（レビューの実測: 何もしない
    // 1.5秒の間に2回）。購読が0になったら降りる。
    it("誰も見ていなければ撃ち直さない", async () => {
        vi.useFakeTimers();
        try {
            const useFollow = await load();
            mockPublicFetch.mockRejectedValue(new Error("network"));

            const { unmount } = renderHook(() => useFollow(TARGET, false));
            await vi.advanceTimersByTimeAsync(10);       // 1本目が失敗する
            const afterFirst = mockPublicFetch.mock.calls.length;
            expect(afterFirst).toBe(1);

            unmount();                                   // 画面を離れる
            await vi.advanceTimersByTimeAsync(5000);     // バックオフの時間を全部進める

            expect(mockPublicFetch.mock.calls.length, "離れたあとも撃ち直している")
                .toBe(afterFirst);
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
            cleanup();
        }
    });

    it("取得できたら数を出す（正常系）", async () => {
        const useFollow = await load();
        const { result } = renderHook(() => useFollow(TARGET, false));

        await waitFor(() => expect(result.current.countsKnown).toBe(true));
        expect(result.current.followers).toBe(3);
        expect(result.current.following).toBe(1);
    });

    // **数を描かない画面（ユーザー検索）からフォローしたとき、知らない数を
    // 共有ストアに焼き付けない。** 焼き付けると、その足でプロフィールを
    // 開いたときに「フォロワー 501 / フォロー中 0」（実際は87人）と出る。
    it("数を取らない呼び出しのフォローは、共有ストアを汚さない", async () => {
        const useFollow = await load();
        mockUserFetch.mockImplementation((url: string) =>
            Promise.resolve(url === "/user/following"
                ? { ok: true, json: async () => ({ userIds: [] }) }
                : { ok: true, json: async () => ({ followers: 501 }) }));

        // withCounts=false（FollowAction 相当）
        const { result } = renderHook(() => useFollow(TARGET, true, false));
        await waitFor(() => expect(result.current.resolved).toBe(true));
        await act(async () => { await result.current.toggle(); });

        expect(result.current.countsKnown, "知らない数を書き込んでいる").toBe(false);
    });

    // **プロフィールの実経路**（数を持つ `FollowButton` と、数を取らない
    // `FollowAction` が同じ相手で並ぶ）。押すのは後者だが、数のピルは
    // 前者が描く——共有ストア経由でその場で動くことを固定する。
    // ここが「知っている側の楽観更新」で、変異させても落ちるテストが
    // 無かった（レビュー指摘）。
    it("数を持つ側のピルが、その場で +1 する", async () => {
        const useFollow = await load();
        mockUserFetch.mockImplementation((url: string) =>
            Promise.resolve(url === "/user/following"
                ? { ok: true, json: async () => ({ userIds: [] }) }
                : new Promise(() => { })));   // 応答は返さない（楽観更新だけを見る）

        const pill = renderHook(() => useFollow(TARGET, true));            // 数を描く側
        const action = renderHook(() => useFollow(TARGET, true, false));   // 押す側
        await waitFor(() => expect(pill.result.current.countsKnown).toBe(true));
        expect(pill.result.current.followers).toBe(3);

        void action.result.current.toggle();

        await waitFor(() => expect(
            pill.result.current.followers,
            "押した側と数を描く側で共有ストアが繋がっていない",
        ).toBe(4));
    });

    it("失敗したら数も元に戻す", async () => {
        const useFollow = await load();
        mockUserFetch.mockImplementation((url: string) =>
            Promise.resolve(url === "/user/following"
                ? { ok: true, json: async () => ({ userIds: [] }) }
                : { ok: false, status: 500, json: async () => ({ error: "だめ" }) }));

        const { result } = renderHook(() => useFollow(TARGET, true));
        await waitFor(() => expect(result.current.countsKnown).toBe(true));
        await act(async () => { await result.current.toggle(); });

        expect(result.current.followers, "失敗したのに増えたまま").toBe(3);
        expect(result.current.isFollowing).toBe(false);
    });

    it("数を取る呼び出しでは、今までどおり楽観更新＋確定値", async () => {
        const useFollow = await load();
        mockUserFetch.mockImplementation((url: string) =>
            Promise.resolve(url === "/user/following"
                ? { ok: true, json: async () => ({ userIds: [] }) }
                : { ok: true, json: async () => ({ followers: 4 }) }));

        const { result } = renderHook(() => useFollow(TARGET, true));
        await waitFor(() => expect(result.current.countsKnown).toBe(true));
        await act(async () => { await result.current.toggle(); });

        expect(result.current.followers).toBe(4);
        expect(result.current.following, "知っている方まで壊していない").toBe(1);
    });
});
