import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// localStorage モック
const store: Record<string, string> = {};
Object.defineProperty(globalThis, "localStorage", {
    value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    },
    configurable: true,
});

// api モジュールをモック。
// いいね数の読み取りは userPublicFetch（ユーザーAPI）を使う。
// publicFetch は管理APIを向いており、いいね/コメント/フォローの経路は存在しない。
const mockPublicFetch = vi.hoisted(() => vi.fn());
const mockUserFetch = vi.hoisted(() => vi.fn());
// **実物を土台にする。** 列挙だけだと、実装が新しく使い始めた export
// （`isGoneResponse`）が undefined になり、呼んだ瞬間に投げる——それを
// hook の catch が飲むので、**緑のまま間違ったことを測るテスト**になる。
vi.mock("../../utils/api", async (importActual) => ({
    ...(await importActual<typeof import("../../utils/api")>()),
    publicFetch: (...a: unknown[]) => mockPublicFetch(...a),
    userPublicFetch: (...a: unknown[]) => mockPublicFetch(...a),
    userFetch: (...a: unknown[]) => mockUserFetch(...a),
}));

import { usePhotoLikes } from "../usePhotoLikes";
import { resetFavoritesCache } from "../useFavorites";

beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    // お気に入りはモジュール内にキャッシュされる。localStorage を消すだけでは
    // 前のテストの状態が残り、次のテストの初期値が「いいね済み」になる。
    resetFavoritesCache();
    mockPublicFetch.mockReset();
    mockUserFetch.mockReset();
    // デフォルト: 初回のカウント取得は失敗扱い（初期値を維持）
    mockPublicFetch.mockResolvedValue({ ok: false });
});

afterEach(() => vi.clearAllMocks());

describe("usePhotoLikes", () => {
    it("初期状態は未いいね・初期カウント", () => {
        const { result } = renderHook(() => usePhotoLikes("p1", 10, true));
        expect(result.current.liked).toBe(false);
        expect(result.current.count).toBe(10);
    });

    it("マウント時にサーバーの最新カウントを反映する", async () => {
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ likes: 42 }) });
        const { result } = renderHook(() => usePhotoLikes("p1", 10, true));
        await waitFor(() => expect(result.current.count).toBe(42));
    });

    it("ログイン時: いいねで楽観+1 → サーバー確定値を反映", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ likes: 6 }) });
        const { result } = renderHook(() => usePhotoLikes("p1", 5, true));

        await act(async () => { await result.current.toggle(); });

        expect(result.current.liked).toBe(true);
        expect(result.current.count).toBe(6);
        expect(mockUserFetch).toHaveBeenCalledWith("/photos/p1/like", { method: "POST" });
    });

    it("いいね済みから解除で DELETE を呼ぶ", async () => {
        store["photo-gallery-favorites"] = JSON.stringify(["p1"]); // 既にお気に入り
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ likes: 4 }) });
        const { result } = renderHook(() => usePhotoLikes("p1", 5, true));
        expect(result.current.liked).toBe(true);

        await act(async () => { await result.current.toggle(); });

        expect(result.current.liked).toBe(false);
        expect(mockUserFetch).toHaveBeenCalledWith("/photos/p1/like", { method: "DELETE" });
    });

    it("未ログイン時はローカルのみ変更し、公開の件数は動かさない", async () => {
        // 動かしていた頃は、42いいねの写真でハートを押すと「43」に見え、
        // もう一度押すと「42」に戻った——サーバーには何も送っていないので、
        // 公開の数字を勝手に上下させているだけだった。
        const { result } = renderHook(() => usePhotoLikes("p1", 5, false));
        await act(async () => { await result.current.toggle(); });
        expect(result.current.liked).toBe(true);   // お気に入りには入る
        expect(result.current.count).toBe(5);      // 公開の件数は動かさない
        expect(mockUserFetch).not.toHaveBeenCalled();
    });

    // 未ログインで押した状態のままログインすると、次の一押しが DELETE に
    // なって「取り消し」扱いになっていた——投稿者にいいねも通知も届かない。
    // 別の端末では逆に、いいね済みの写真が未いいねに見えた。
    // サーバーの真値（/user/likes/<id>）を初期値にする。
    describe("サーバー側のいいね状態", () => {
        it("端末のお気に入りより、サーバーの答えを優先する", async () => {
            // 端末には「いいね済み」が残っているが、サーバーには無い
            store["photo-gallery-favorites"] = JSON.stringify(["p1"]);
            resetFavoritesCache();
            mockUserFetch.mockImplementation((path: string) =>
                Promise.resolve(path.startsWith("/user/likes/")
                    ? { ok: true, json: async () => ({ liked: false }) }
                    : { ok: true, json: async () => ({ likes: 1 }) }));

            const { result } = renderHook(() => usePhotoLikes("p1", 0, true));
            await waitFor(() => expect(result.current.liked).toBe(false));

            // だから最初の一押しは POST（取り消しではない）
            await act(async () => { await result.current.toggle(); });
            expect(mockUserFetch).toHaveBeenCalledWith("/photos/p1/like", { method: "POST" });
        });

        it("未ログインならサーバーには聞かない", async () => {
            // ログイン時は必ず1回聞く、を先に確かめてから「未ログインでは聞かない」を見る。
            // 「呼ばれていないこと」だけを waitFor で見ると、実装を消しても通る。
            mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ liked: false }) });
            const authed = renderHook(() => usePhotoLikes("p1", 0, true));
            await waitFor(() => expect(mockUserFetch).toHaveBeenCalledWith(
                "/user/likes/p1", expect.anything()));
            authed.unmount();

            mockUserFetch.mockClear();
            renderHook(() => usePhotoLikes("p2", 0, false));
            await new Promise((r) => setTimeout(r, 20));
            expect(mockUserFetch).not.toHaveBeenCalled();
        });

        it("写真が変わったら状態を持ち越さない", async () => {
            // モーダルは同じフックのまま次の写真へ進む。持ち越すと、
            // 1枚目に付けたいいねが2枚目にも付いて見え、押すと DELETE が飛ぶ
            // （＝2枚目にはいいねが付かない）。
            mockUserFetch.mockImplementation((path: string) =>
                Promise.resolve(path.startsWith("/user/likes/")
                    ? { ok: true, json: async () => ({ liked: false }) }
                    : { ok: true, json: async () => ({ likes: 1 }) }));
            const { result, rerender } = renderHook(
                ({ id }) => usePhotoLikes(id, 0, true), { initialProps: { id: "p1" } });

            await act(async () => { await result.current.toggle(); });
            expect(result.current.liked).toBe(true);

            rerender({ id: "p2" });
            await waitFor(() => expect(result.current.liked).toBe(false));

            mockUserFetch.mockClear();
            await act(async () => { await result.current.toggle(); });
            expect(mockUserFetch).toHaveBeenCalledWith("/photos/p2/like", { method: "POST" });
        });

        it("応答が返る前に別の写真へ送っても、そちらのハートと件数を壊さない", async () => {
            // モーダルは同じフックのまま次の写真へ進む。await の後に
            // 「まだ同じ写真か」を見ずに書いていた頃は、Aで押した結果が
            // Bのハートと件数に反映されていた（Bがいいね済みでも空になり、
            // 次の一押しが POST になって二重に付く）。
            let failA: ((v: unknown) => void) | undefined;
            mockUserFetch.mockImplementation((path: string) => {
                if (path.startsWith("/user/likes/")) {
                    return Promise.resolve({ ok: true, json: async () => ({ liked: false }) });
                }
                if (path === "/photos/A/like") return new Promise((r) => { failA = r; });
                return Promise.resolve({ ok: true, json: async () => ({ likes: 3 }) });
            });

            const { result, rerender } = renderHook(
                ({ id, likes }) => usePhotoLikes(id, likes, true),
                { initialProps: { id: "A", likes: 10 } });

            // A のいいねを開始（応答はまだ返さない）
            let pending: Promise<boolean> | undefined;
            act(() => { pending = result.current.toggle(); });

            // 応答を待たずに B へ送る
            rerender({ id: "B", likes: 3 });
            await waitFor(() => expect(result.current.count).toBe(3));

            // ここで A の要求が失敗して返る
            await act(async () => {
                failA?.({ ok: false });
                await pending;
            });

            // B の表示は壊れていない
            expect(result.current.count).toBe(3);
            expect(result.current.liked).toBe(false);
        });

        it("写真を送ると件数も引き継がない", async () => {
            mockUserFetch.mockImplementation(() =>
                Promise.resolve({ ok: false }));   // 件数の取得は失敗させる
            mockPublicFetch.mockResolvedValue({ ok: false });

            const { result, rerender } = renderHook(
                ({ id, likes }) => usePhotoLikes(id, likes, true),
                { initialProps: { id: "A", likes: 42 } });
            await waitFor(() => expect(result.current.count).toBe(42));

            rerender({ id: "B", likes: 3 });
            // 42 のまま出し続けない
            await waitFor(() => expect(result.current.count).toBe(3));
        });

        it("答えが遅れて届いても、先に押したハートを上書きしない", async () => {
            let resolveLiked: ((v: unknown) => void) | undefined;
            mockUserFetch.mockImplementation((path: string) => {
                if (path.startsWith("/user/likes/")) {
                    return new Promise((r) => { resolveLiked = r; });
                }
                return Promise.resolve({ ok: true, json: async () => ({ likes: 1 }) });
            });
            const { result } = renderHook(() => usePhotoLikes("p1", 0, true));
            await act(async () => { await result.current.toggle(); });
            expect(result.current.liked).toBe(true);

            // 遅れて「いいねしていません」が届く
            await act(async () => {
                resolveLiked?.({ ok: true, json: async () => ({ liked: false }) });
                await Promise.resolve();
            });
            expect(result.current.liked).toBe(true);
        });
    });

    it("サーバー失敗時は楽観更新を巻き戻す", async () => {
        mockUserFetch.mockResolvedValue({ ok: false });
        const { result } = renderHook(() => usePhotoLikes("p1", 5, true));

        await act(async () => { await result.current.toggle(); });

        expect(result.current.liked).toBe(false); // 巻き戻し
        expect(result.current.count).toBe(5);
    });
});

// いいねの失敗が log.warn だけで、押した人には「ハートが黙って戻る」
// としか見えなかった（フォローは文言を出すのに非対称）。呼び出し元が
// 伝えられるよう、toggle は成否を返す（SW-b4）
describe("usePhotoLikes: toggle は成否を返す", () => {
    it("失敗したら false（呼び出し元がトーストを出せる）", async () => {
        mockUserFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
        const { result } = renderHook(() => usePhotoLikes("p1", 10, true));
        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.toggle(); });
        expect(ok).toBe(false);
    });

    it("成功したら true", async () => {
        mockUserFetch.mockResolvedValue({ ok: true, json: async () => ({ likes: 11, liked: true }) });
        const { result } = renderHook(() => usePhotoLikes("p1", 10, true));
        let ok: boolean | undefined;
        await act(async () => { ok = await result.current.toggle(); });
        expect(ok).toBe(true);
    });
});

// **押したあとに、押す前の数字が遅れて届いて巻き戻していた。**
//
// マウント時の件数取得は「押す前の数」を運ぶ。同じ番人（`touchedRef`）を
// `serverLiked` にだけ入れて、数字に入れ忘れていたので、回線が遅いと
// **ハートは付いたまま数字だけ元に戻る**（サーバーの真値は増えている）。
describe("遅れて届いた初回の件数", () => {
    it("押したあとの確定値を巻き戻さない", async () => {
        let settleInitial: ((v: unknown) => void) | null = null;
        mockPublicFetch.mockImplementation(() => new Promise((res) => { settleInitial = res; }));
        mockUserFetch.mockImplementation((url: string) =>
            Promise.resolve(url.startsWith("/user/likes/")
                ? { ok: true, json: async () => ({ liked: false }) }
                : { ok: true, json: async () => ({ likes: 43 }) }));

        const { result } = renderHook(() => usePhotoLikes("p1", 42, true));
        await act(async () => { await result.current.toggle(); });
        expect(result.current.count).toBe(43);

        // 押す前に投げた取得が、いま着地する
        await act(async () => {
            settleInitial!({ ok: true, json: async () => ({ likes: 42 }) });
            await Promise.resolve();
        });

        expect(result.current.count, "押す前の数字で巻き戻している").toBe(43);
        expect(result.current.liked).toBe(true);
    });

    // **未ログインで押しただけでも番人が立っていた。**
    // 未ログインはサーバーに何も送らないのに、マウント時の件数取得
    // （唯一の是正経路。cron ビルドが止まっている間、`photos.json` の
    // 数字は古くなる）が永久に殺され、古い数字が出たまま固定されていた。
    it("未ログインで押しても、届いた最新の件数は反映する", async () => {
        let settleInitial: ((v: unknown) => void) | null = null;
        mockPublicFetch.mockImplementation(() => new Promise((res) => { settleInitial = res; }));

        const { result } = renderHook(() => usePhotoLikes("p1", 42, false));
        await act(async () => { await result.current.toggle(); });

        await act(async () => {
            settleInitial!({ ok: true, json: async () => ({ likes: 57 }) });
            await Promise.resolve();
        });

        expect(result.current.count, "未ログインなのに件数の更新を止めている").toBe(57);
    });

    // 巻き戻した＝「押す前」の姿に戻ったので、遅れて届く真値は弾かない
    it("保存に失敗して巻き戻したあとも、届いた件数は反映する", async () => {
        let settleInitial: ((v: unknown) => void) | null = null;
        mockPublicFetch.mockImplementation(() => new Promise((res) => { settleInitial = res; }));
        mockUserFetch.mockImplementation((url: string) =>
            Promise.resolve(url.startsWith("/user/likes/")
                ? { ok: true, json: async () => ({ liked: false }) }
                : { ok: false, status: 500, json: async () => ({}) }));

        const { result } = renderHook(() => usePhotoLikes("p1", 42, true));
        await act(async () => { await result.current.toggle(); });
        expect(result.current.count).toBe(42);   // 巻き戻し済み

        await act(async () => {
            settleInitial!({ ok: true, json: async () => ({ likes: 57 }) });
            await Promise.resolve();
        });

        expect(result.current.count, "巻き戻したあとも真値を弾いている").toBe(57);
    });

    it("押していなければ、届いた数字をそのまま出す（正常系）", async () => {
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ likes: 42 }) });
        const { result } = renderHook(() => usePhotoLikes("p1", 10, true));
        await waitFor(() => expect(result.current.count).toBe(42));
    });
});

// **非公開になった写真のいいねは、解除だけ通る。**
//
// サーバー（`api-user/src/likes.ts` の DELETE）はマーカーを消してカウンタも
// 減らしたうえで、非公開・削除済みなら数字を返さずに 404 を返す（減算に
// 公開判定を足すと「本人が永久に取り消せない」ため意図してそうしてある）。
// クライアントが一律「失敗」と読んで巻き戻すと、**サーバーは解除済みなのに
// 画面はいいね済み**のまま、押し直しても同じ 404 で永久に直らない。
describe("もう見えない写真のいいね", () => {
    const gone = { ok: false, status: 404, json: async () => ({ error: "写真が見つかりません" }), clone() { return this; } };

    it("解除は成功として扱う（巻き戻さない）", async () => {
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ likes: 11 }) });
        mockUserFetch.mockImplementation((url: string) =>
            Promise.resolve(url.startsWith("/user/likes/")
                ? { ok: true, json: async () => ({ liked: true }) }
                : gone));

        const { result } = renderHook(() => usePhotoLikes("p1", 11, true));
        await waitFor(() => expect(result.current.liked).toBe(true));

        let ok = false;
        await act(async () => { ok = await result.current.toggle(); });

        expect(ok, "解除できているのに失敗として伝えている").toBe(true);
        expect(result.current.liked, "サーバーは解除済みなのに、いいね済みへ戻している").toBe(false);
        expect(result.current.count).toBe(10);
    });

    // 付ける側は逆。非公開ならマーカーごと戻されて何も起きていないので、
    // 巻き戻すのが正しい
    it("付ける側は今までどおり巻き戻して失敗を伝える", async () => {
        mockPublicFetch.mockResolvedValue({ ok: true, json: async () => ({ likes: 11 }) });
        mockUserFetch.mockImplementation((url: string) =>
            Promise.resolve(url.startsWith("/user/likes/")
                ? { ok: true, json: async () => ({ liked: false }) }
                : gone));

        const { result } = renderHook(() => usePhotoLikes("p1", 11, true));
        await waitFor(() => expect(result.current.count).toBe(11));

        let ok = true;
        await act(async () => { ok = await result.current.toggle(); });

        expect(ok).toBe(false);
        expect(result.current.liked).toBe(false);
        expect(result.current.count).toBe(11);
    });
});
