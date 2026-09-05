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
        totalLength: () => Object.values(store).reduce((n, v) => n + v.length, 0),
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

// **容量が足りない端末で、引き継ぎがハートを消していた。**
//
// `storageSet` は失敗を握って次の行へ進む。引き継ぎは
// 「① 印を書く → ② ユーザーのキーへコピー → ③ 共有キーを空にする」の順で、
// **② は大きい書き込み・③ は小さい書き込み**（`[]`）。満杯の端末では
// ② だけが落ちて ③ は通るので、**未ログインで貯めたハートがどこにも
// 残らないまま消える**。利用者には何も出ない。
//
// 実 Chromium でも同じ順序で再現している（5MB を端まで詰めた状態で
// ②が QuotaExceededError・③が成功）。
describe("setFavoritesUser: 容量が足りないとき", () => {
    /**
     * 満杯の端末に相当する localStorage。**合計の長さで弾く**——
     * 実際の `QuotaExceededError` は「値が長いから」ではなく
     * 「入れると容量を超えるから」なので、**小さい書き込みは通る**。
     * 値の長さだけで弾く形にしていたら、数バイトの控え（引き継ぎ待ちの
     * 相手）まで書けず、自分のテストの前提が実際とずれていた
     */
    function limitTo(maxTotalLength: number) {
        const orig = localStorageMock.setItem;
        localStorageMock.setItem = (key: string, value: string) => {
            const others = localStorageMock.totalLength() - (localStorageMock.getItem(key)?.length ?? 0);
            if (others + value.length > maxTotalLength) throw new DOMException("full", "QuotaExceededError");
            orig(key, value);
        };
        return () => { localStorageMock.setItem = orig; };
    }

    // **`activeUserId` はモジュールに残る**（`resetFavoritesCache` は消さない）。
    // 前のテストと同じ id を渡すと `setFavoritesUser` は入口で return するので、
    // 毎回いったん null に戻す（これを忘れて正常系が空振りした）
    beforeEach(() => { setFavoritesUser(null); });

    it("コピーに失敗したら、共有キーを空にしない（ハートを消さない）", () => {
        localStorageMock.setItem("photo-gallery-favorites", JSON.stringify(["a", "b", "c"]));
        resetFavoritesCache();
        // 共有キー（13文字）が既に入っているので、合計20ではコピー（+13）は
        // 入らないが、控え `"user-a"`（8文字）は入る＝実際の満杯に近い
        const restore = limitTo(20);
        try {
            setFavoritesUser("user-a");
        } finally {
            restore();
        }

        expect(localStorageMock.getItem("photo-gallery-favorites"),
            "コピーできていないのに共有キーを空にした（ハートが消えた）").toBe(JSON.stringify(["a", "b", "c"]));
    });

    it("空きが戻れば、次のログインで引き継げる（諦めたままにしない）", () => {
        localStorageMock.setItem("photo-gallery-favorites", JSON.stringify(["a", "b", "c"]));
        resetFavoritesCache();
        // 共有キー13文字。コピー（+13）は入らないが控え（+8）は入る大きさ
        const restore = limitTo(25);
        try { setFavoritesUser("user-a"); } finally { restore(); }
        expect(localStorageMock.getItem("photo-gallery-favorites:migrating"),
            "引き継ぎ待ちの控えが書けていない（テストの前提が崩れている）").toBe(JSON.stringify("user-a"));

        // 別のタブ/次回の起動で、空きが戻った状態からもう一度
        setFavoritesUser(null);
        setFavoritesUser("user-a");
        expect(localStorageMock.getItem("photo-gallery-favorites:user-a")).toBe(JSON.stringify(["a", "b", "c"]));
        expect(localStorageMock.getItem("photo-gallery-favorites")).toBe(JSON.stringify([]));
        // **引き継ぎ待ちの控えを残さない。** 判定には影響しない（印が立つので
        // もう読まれない）が、消さないと端末に使わないキーが残り続ける。
        // 正常系だけでは観測できない——控えが書かれるのは「失敗してから
        // 成功する」この経路だけ（変異で素通りしたので、ここで固定する）
        expect(localStorageMock.getItem("photo-gallery-favorites:migrating"),
            "引き継ぎ待ちの控えが残っている").toBeNull();
    });

    // **やり直しの窓を、別のアカウントに使わせない。**
    // 「失敗したら印を立てない」だけにしたら、窓が開いている間に別の人が
    // 未ログインでハートを付け、次に初回ログインした**別のアカウントが
    // その人のハートごと吸い込む**ようになっていた（レビュー指摘・再現済み）
    // ——このファイルの上のコメント (b) が直したはずの誤帰属の再発。
    it("失敗のあと別の人がログインしても、その人は吸わない", () => {
        localStorageMock.setItem("photo-gallery-favorites", JSON.stringify(["a-old-1", "a-old-2"]));
        resetFavoritesCache();
        // 共有キーは21文字。コピー（+21）は入らないが、引き継ぎ待ちの控え
        // `"user-a"`（+8）は入る大きさにする
        const restore = limitTo(30);
        try { setFavoritesUser("user-a"); } finally { restore(); }
        expect(localStorageMock.getItem("photo-gallery-favorites:migrating"),
            "引き継ぎ待ちの控えが書けていない（テストの前提が崩れている）").toBe(JSON.stringify("user-a"));

        // 別の人が未ログインでハートを付けた
        localStorageMock.setItem("photo-gallery-favorites", JSON.stringify(["a-old-1", "a-old-2", "anon-by-someone-else"]));
        resetFavoritesCache();
        setFavoritesUser(null);
        setFavoritesUser("user-b");

        expect(localStorageMock.getItem("photo-gallery-favorites:user-b"),
            "別のアカウントが他人のハートを吸っている").toBeNull();
        // 打ち切って、以後は誰も吸わない（共有キーは匿名のまま残る）
        expect(localStorageMock.getItem("photo-gallery-favorites:migrated")).not.toBeNull();
        expect(localStorageMock.getItem("photo-gallery-favorites")).toBe(
            JSON.stringify(["a-old-1", "a-old-2", "anon-by-someone-else"]));
    });

    // 正常系: 書ける端末では今までどおり（引き継いで共有キーを空に）
    it("書ける端末では今までどおり引き継ぐ", () => {
        localStorageMock.setItem("photo-gallery-favorites", JSON.stringify(["a"]));
        resetFavoritesCache();
        setFavoritesUser("user-a");
        expect(localStorageMock.getItem("photo-gallery-favorites:user-a")).toBe(JSON.stringify(["a"]));
        expect(localStorageMock.getItem("photo-gallery-favorites")).toBe(JSON.stringify([]));
        // 引き継ぎ待ちの控えは残さない（判定には影響しないが、端末に
        // 使わないキーが残り続ける。変異で素通りしたので固定する）
        expect(localStorageMock.getItem("photo-gallery-favorites:migrating")).toBeNull();
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
