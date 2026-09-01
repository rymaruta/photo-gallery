import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFavorites, resetFavoritesCache, setFavoritesUser, removeFavoritesUserData } from "../useFavorites";

const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => { store[key] = value; },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { store = {}; },
    };
})();
Object.defineProperty(window, "localStorage", { value: localStorageMock });

beforeEach(() => {
    localStorageMock.clear();
    // 保存済みの値はモジュール内にキャッシュされる（useSyncExternalStore は
    // 参照が安定したスナップショットを要求するため）。テスト間で持ち越さない。
    resetFavoritesCache();
});

describe("useFavorites", () => {
    it("初期値は空配列", () => {
        const { result } = renderHook(() => useFavorites());
        expect(result.current.favorites).toEqual([]);
    });

    it("localStorage に保存済みのお気に入りを読み込む", () => {
        localStorageMock.setItem("photo-gallery-favorites", JSON.stringify(["id1", "id2"]));
        const { result } = renderHook(() => useFavorites());
        expect(result.current.favorites).toEqual(["id1", "id2"]);
    });

    describe("isFavorite", () => {
        it("お気に入りに含まれている ID は true を返す", () => {
            localStorageMock.setItem("photo-gallery-favorites", JSON.stringify(["abc"]));
            const { result } = renderHook(() => useFavorites());
            expect(result.current.isFavorite("abc")).toBe(true);
        });

        it("含まれていない ID は false を返す", () => {
            const { result } = renderHook(() => useFavorites());
            expect(result.current.isFavorite("xyz")).toBe(false);
        });
    });

    describe("toggleFavorite", () => {
        it("未登録の ID を追加する", () => {
            const { result } = renderHook(() => useFavorites());
            act(() => { result.current.toggleFavorite("p1"); });
            expect(result.current.favorites).toContain("p1");
        });

        it("登録済みの ID を削除する", () => {
            localStorageMock.setItem("photo-gallery-favorites", JSON.stringify(["p1"]));
            const { result } = renderHook(() => useFavorites());
            act(() => { result.current.toggleFavorite("p1"); });
            expect(result.current.favorites).not.toContain("p1");
        });

        it("localStorage に反映される", () => {
            const { result } = renderHook(() => useFavorites());
            act(() => { result.current.toggleFavorite("p2"); });
            const stored = JSON.parse(localStorageMock.getItem("photo-gallery-favorites")!);
            expect(stored).toContain("p2");
        });
    });

    describe("clearFavorites", () => {
        it("全お気に入りを削除する", () => {
            localStorageMock.setItem("photo-gallery-favorites", JSON.stringify(["a", "b"]));
            const { result } = renderHook(() => useFavorites());
            act(() => { result.current.clearFavorites(); });
            expect(result.current.favorites).toEqual([]);
            expect(JSON.parse(localStorageMock.getItem("photo-gallery-favorites")!)).toEqual([]);
        });
    });
});

// お気に入りが共有キー1本だった頃は、A のハート一覧が同じ端末の B や
// 未ログイン閲覧者にそのまま見えていた。ログイン中はユーザーごとのキーに分ける。
describe("setFavoritesUser: アカウントごとにハートを分ける", () => {
    it("A のハートは B に見えず、A に戻れば見える", () => {
        setFavoritesUser("user-a");
        const { result, rerender } = renderHook(() => useFavorites());
        act(() => result.current.toggleFavorite("p1"));
        expect(result.current.favorites).toEqual(["p1"]);

        act(() => setFavoritesUser("user-b"));
        rerender();
        expect(result.current.favorites).toEqual([]);

        act(() => setFavoritesUser("user-a"));
        rerender();
        expect(result.current.favorites).toEqual(["p1"]);
    });

    it("初回ログインで共有キーから引き継ぎ、共有キーは空にする（次の人に見せない）", () => {
        localStorageMock.setItem("photo-gallery-favorites", JSON.stringify(["p1", "p2"]));
        act(() => setFavoritesUser("user-a"));
        const { result } = renderHook(() => useFavorites());
        expect(result.current.favorites).toEqual(["p1", "p2"]);
        // 共有キーは空になっている＝ログアウト後の閲覧者・次の人には見えない
        expect(JSON.parse(localStorageMock.getItem("photo-gallery-favorites")!)).toEqual([]);
        // 2回目以降のログインでは（自分のキーがあるので）引き継ぎは走らない
        localStorageMock.setItem("photo-gallery-favorites", JSON.stringify(["stranger"]));
        act(() => setFavoritesUser(null));
        act(() => setFavoritesUser("user-a"));
        const { result: again } = renderHook(() => useFavorites());
        expect(again.current.favorites).toEqual(["p1", "p2"]);
    });

    it("ログアウト（null）では共有キーに戻る", () => {
        localStorageMock.setItem("photo-gallery-favorites", JSON.stringify(["anon"]));
        act(() => setFavoritesUser(null));
        const { result } = renderHook(() => useFavorites());
        expect(result.current.favorites).toEqual(["anon"]);
    });
});

// 引き継ぎは端末で1回だけ。「user キーが無ければ初回」という判定だった頃は、
// 一度もハートしない人が毎回共有キーを吸い、別の人が未ログインで付けた
// ハートが次に初回ログインしたアカウントへ誤帰属していた（AS 系レビューの指摘）。
describe("setFavoritesUser: 引き継ぎは端末で1回だけ", () => {
    it("引き継ぎ済みの端末では、別アカウントの初回ログインでも匿名ハートを吸わない", () => {
        // user-a が引き継ぎを済ませる
        localStorageMock.setItem("photo-gallery-favorites", JSON.stringify(["a-old"]));
        act(() => setFavoritesUser("user-a"));
        // 匿名ハートが溜まる → user-b が初回ログイン
        localStorageMock.setItem("photo-gallery-favorites", JSON.stringify(["anon-heart"]));
        act(() => setFavoritesUser(null));
        act(() => setFavoritesUser("user-b"));
        const { result } = renderHook(() => useFavorites());
        expect(result.current.favorites).toEqual([]);   // 吸っていない
        // 匿名ハートは共有キーに残っている
        expect(JSON.parse(localStorageMock.getItem("photo-gallery-favorites")!)).toEqual(["anon-heart"]);
    });

    it("user キーが空配列でも上書きしない（全ハートを外した状態を尊重）", () => {
        localStorageMock.setItem("photo-gallery-favorites:user-a", JSON.stringify([]));
        localStorageMock.setItem("photo-gallery-favorites", JSON.stringify(["x"]));
        act(() => setFavoritesUser("user-a"));
        const { result } = renderHook(() => useFavorites());
        expect(result.current.favorites).toEqual([]);
    });
});

describe("removeFavoritesUserData: 退会でそのアカウントのハートを消す", () => {
    it("指定アカウントのキーだけを消す", () => {
        localStorageMock.setItem("photo-gallery-favorites:user-a", JSON.stringify(["p1"]));
        localStorageMock.setItem("photo-gallery-favorites", JSON.stringify(["anon"]));
        removeFavoritesUserData("user-a");
        expect(localStorageMock.getItem("photo-gallery-favorites:user-a")).toBeNull();
        expect(localStorageMock.getItem("photo-gallery-favorites")).not.toBeNull();
    });
});
