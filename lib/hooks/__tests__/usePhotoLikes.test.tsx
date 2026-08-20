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
vi.mock("../../utils/api", () => ({
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

    it("未ログイン時はローカルのみ変更しサーバーを呼ばない", async () => {
        const { result } = renderHook(() => usePhotoLikes("p1", 5, false));
        await act(async () => { await result.current.toggle(); });
        expect(result.current.liked).toBe(true);
        expect(result.current.count).toBe(6); // 楽観更新のみ
        expect(mockUserFetch).not.toHaveBeenCalled();
    });

    // 未ログインで押した状態のままログインすると、次の一押しが DELETE に
    // なって「取り消し」扱いになっていた——投稿者にいいねも通知も届かない。
    // 別の端末では逆に、いいね済みの写真が未いいねに見えた。
    // サーバーの真値（/user/likes/<id>）を初期値にする。
    describe("サーバー側のいいね状態", () => {
        it("端末のお気に入りより、サーバーの答えを優先する", async () => {
            // 端末には「いいね済み」が残っているが、サーバーには無い
            store["jp_favorites"] = JSON.stringify(["p1"]);
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
