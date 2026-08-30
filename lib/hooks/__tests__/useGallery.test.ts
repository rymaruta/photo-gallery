import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import useGallery from "../useGallery";
import type { Photo } from "../../data/photos";

// URLのフィルター同期（useEffect）がテスト間で状態汚染しないようリセット
beforeEach(() => {
    window.history.replaceState({}, "", "/");
});

const mockPhotos: Photo[] = [
    {
        id: "1",
        src: "a.jpg",
        title: { ja: "夜の街", en: "Night Street" },
        category: "street",
        tags: ["night", "urban"],
        date: "2024-03-01",
        likes: 10,
    },
    {
        id: "2",
        src: "b.jpg",
        title: { ja: "山の夕暮れ", en: "Mountain Sunset" },
        category: "landscape",
        tags: ["mountain"],
        date: "2024-01-15",
        likes: 5,
    },
    {
        id: "3",
        src: "c.jpg",
        title: { ja: "都市建築", en: "City Architecture" },
        category: "architecture",
        tags: ["urban", "building"],
        date: "2024-06-10",
        likes: 20,
    },
];

describe("useGallery", () => {
    describe("初期状態", () => {
        it("フィルタなしで全写真を返す", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            expect(result.current.filteredPhotos).toHaveLength(3);
        });

        it("デフォルトソートは新しい順（date 降順）", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            const dates = result.current.filteredPhotos.map((p) => p.date);
            expect(dates[0]).toBe("2024-06-10");
            expect(dates[1]).toBe("2024-03-01");
            expect(dates[2]).toBe("2024-01-15");
        });

        it("currentIndex の初期値は null", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            expect(result.current.currentIndex).toBeNull();
        });
    });

    describe("カテゴリフィルタ", () => {
        it("street カテゴリで絞り込める", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.setFilters({ category: "street" });
            });
            expect(result.current.filteredPhotos).toHaveLength(1);
            expect(result.current.filteredPhotos[0].id).toBe("1");
        });

        it("all に戻すと全件表示", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.setFilters({ category: "street" });
            });
            act(() => {
                result.current.setFilters({ category: "all" });
            });
            expect(result.current.filteredPhotos).toHaveLength(3);
        });
    });

    describe("タグフィルタ", () => {
        it("urban タグで絞り込める", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.setFilters({ selectedTags: ["urban"] });
            });
            expect(result.current.filteredPhotos).toHaveLength(2);
        });

        it("複数タグは AND 条件", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.setFilters({ selectedTags: ["urban", "building"] });
            });
            expect(result.current.filteredPhotos).toHaveLength(1);
            expect(result.current.filteredPhotos[0].id).toBe("3");
        });
    });

    describe("キーワード検索", () => {
        it("日本語タイトルで検索できる", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.setFilters({ query: "街" });
            });
            expect(result.current.filteredPhotos).toHaveLength(1);
            expect(result.current.filteredPhotos[0].id).toBe("1");
        });

        it("英語タイトルで検索できる", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.setFilters({ query: "sunset" });
            });
            expect(result.current.filteredPhotos).toHaveLength(1);
            expect(result.current.filteredPhotos[0].id).toBe("2");
        });

        it("クエリが空のときは全件", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.setFilters({ query: "" });
            });
            expect(result.current.filteredPhotos).toHaveLength(3);
        });

        // 集約ページの404救済は /location/<スラッグ> を `/?q=<スラッグ>` に
        // 振り替える。スラッグは空白をハイフンに潰してあるので、生の includes
        // だけだと**多語の撮影地が必ず「該当なし」**に落ちていた
        // （"フランス ヴェルサイユ".includes("フランス-ヴェルサイユ") は false）。
        // タグ側は tagSlug を両側にかけて解決済み。location も両側を
        // 同じ正規化で比べる。
        it("スラッグ形（空白→ハイフン）のクエリでも撮影地に一致する", () => {
            const photos = [
                { ...mockPhotos[0], id: "loc1", location: "フランス ヴェルサイユ" },
                { ...mockPhotos[1], id: "loc2", location: "Mount Fuji" },
                { ...mockPhotos[2], id: "loc3", location: "東京" },
            ];
            const { result } = renderHook(() => useGallery(photos));
            act(() => {
                result.current.setFilters({ query: "フランス-ヴェルサイユ" });
            });
            expect(result.current.filteredPhotos.map((p) => p.id)).toEqual(["loc1"]);

            act(() => {
                result.current.setFilters({ query: "mount-fuji" });
            });
            expect(result.current.filteredPhotos.map((p) => p.id)).toEqual(["loc2"]);
        });

        it("生の撮影地でも従来どおり検索できる（壊していない）", () => {
            const photos = [
                { ...mockPhotos[0], id: "loc1", location: "フランス ヴェルサイユ" },
                { ...mockPhotos[1], id: "loc2", location: "東京" },
            ];
            const { result } = renderHook(() => useGallery(photos));
            act(() => {
                result.current.setFilters({ query: "ヴェルサイユ" });
            });
            expect(result.current.filteredPhotos.map((p) => p.id)).toEqual(["loc1"]);
        });
    });

    // **集約ページの404救済が0件に落ちていた。**
    //
    // 写真ページのタグリンクは `slugify` した形を指す。まだ `/tag/<スラッグ>`
    // が生成されていない新着写真では 404 → `/?tags=<スラッグ>` に振り替わる。
    // ところがここの比較は「trim + 小文字 + 空白→ハイフン」だけで、
    // `slugify` が潰す `/ \ ? # %` を残していた（コメントには「同じ規則」と
    // 書いてあった）。`#旅` や `白/黒` は自由入力で普通に入る。
    describe("集約ページからの振り替え（スラッグ）", () => {
        const odd: Photo[] = [
            { id: "h", src: "h.jpg", title: { ja: "ハッシュ", en: "Hash" }, category: "白/黒", tags: ["#旅"], date: "2024-05-01" },
            { id: "n", src: "n.jpg", title: { ja: "ふつう", en: "Plain" }, category: "street", tags: ["night"], date: "2024-05-02" },
        ];

        it("`#` を含むタグでも、スラッグで絞り込める", () => {
            window.history.replaceState({}, "", "/?tags=%E6%97%85");   // ?tags=旅
            const { result } = renderHook(() => useGallery(odd));
            expect(result.current.filteredPhotos.map((p) => p.id),
                "一覧に写真があるのに0件になっている").toEqual(["h"]);
        });

        it("`/` を含むカテゴリでも、スラッグで絞り込める", () => {
            window.history.replaceState({}, "", "/?category=%E7%99%BD-%E9%BB%92");   // ?category=白-黒
            const { result } = renderHook(() => useGallery(odd));
            expect(result.current.filteredPhotos.map((p) => p.id)).toEqual(["h"]);
        });

        it("`/` を含む撮影地でも、スラッグ形の検索が当たる", () => {
            const withLoc: Photo[] = [
                { id: "L", src: "l.jpg", title: { ja: "渋谷", en: "S" }, category: "street", tags: [], date: "2024-05-01", location: "東京 / 渋谷" },
                ...odd,
            ];
            window.history.replaceState({}, "", "/?q=%E6%9D%B1%E4%BA%AC-%E6%B8%8B%E8%B0%B7");   // ?q=東京-渋谷
            const { result } = renderHook(() => useGallery(withLoc));
            expect(result.current.filteredPhotos.map((p) => p.id)).toEqual(["L"]);
        });

        // **URL 側の値も正規化する。** 表示名や大文字のまま来る経路がある
        // （古いリンク・手で書いた URL）。写真側は正規キーに畳んであるので、
        // 生のまま比べると0件になる。
        it("表示名で来たカテゴリも、正規キーの写真に当たる", () => {
            const en: Photo[] = [
                { id: "a", src: "a.jpg", title: { ja: "建築", en: "Arch" }, category: "architecture", tags: [], date: "2024-05-01" },
                ...odd,
            ];
            window.history.replaceState({}, "", "/?category=%E5%BB%BA%E7%AF%89");   // ?category=建築
            const { result } = renderHook(() => useGallery(en));
            expect(result.current.filteredPhotos.map((p) => p.id),
                "表示名のカテゴリが0件になっている").toEqual(["a"]);
        });

        // 表示名で来ても解決する（今までの動きを壊していない）
        it("表示名のカテゴリも今までどおり解決する", () => {
            const ja: Photo[] = [
                { id: "j", src: "j.jpg", title: { ja: "風景", en: "L" }, category: "風景", tags: [], date: "2024-05-01" },
                ...odd,
            ];
            window.history.replaceState({}, "", "/?category=landscape");
            const { result } = renderHook(() => useGallery(ja));
            expect(result.current.filteredPhotos.map((p) => p.id)).toEqual(["j"]);
        });

        it("同じタグが2つ来ても1つに畳む（チップの key が衝突する）", () => {
            window.history.replaceState({}, "", "/?tags=night,night");
            const { result } = renderHook(() => useGallery(odd));
            expect(result.current.filters.selectedTags).toEqual(["night"]);
        });
    });

    // **スラッグにすると空になる値**（`-` `#` `/` `%` `...`）。
    // `slugify` はこれらを URL のパス片に置けないので空文字にする。
    // 空のまま比べると `includes("")` が常に真＝**全件一致**、タグ側は
    // 別々のタグ同士が一致する。スラッグに寄せたときに作った穴。
    describe("スラッグが空になる値", () => {
        const odd2: Photo[] = [
            { id: "dash", src: "d.jpg", title: { ja: "ダッシュ", en: "Dash" }, category: "street", tags: ["-"], date: "2024-05-01" },
            { id: "hash", src: "h.jpg", title: { ja: "シャープ", en: "Hash" }, category: "street", tags: ["###"], date: "2024-05-02" },
            { id: "plain", src: "p.jpg", title: { ja: "ふつう", en: "Plain" }, category: "street", tags: ["night"], date: "2024-05-03" },
        ];

        it("検索語が空スラッグでも、全件一致にならない", () => {
            window.history.replaceState({}, "", "/?q=-");
            const { result } = renderHook(() => useGallery(odd2));
            expect(result.current.filteredPhotos.map((p) => p.id),
                "絞り込みが効かず全件出ている").toEqual([]);
        });

        it("生の文字が本文にあれば、今までどおり当たる", () => {
            const withDash: Photo[] = [
                { id: "t", src: "t.jpg", title: { ja: "F/2.8 の話", en: "About F/2.8" }, category: "street", tags: [], date: "2024-05-04" },
                ...odd2,
            ];
            window.history.replaceState({}, "", "/?q=F%2F2.8");
            const { result } = renderHook(() => useGallery(withDash));
            expect(result.current.filteredPhotos.map((p) => p.id)).toEqual(["t"]);
        });

        it("空スラッグのタグ同士が一致しない", () => {
            window.history.replaceState({}, "", "/?tags=-");
            const { result } = renderHook(() => useGallery(odd2));
            expect(result.current.filteredPhotos.map((p) => p.id),
                "別のタグの写真まで出ている").toEqual(["dash"]);
        });

        it("カテゴリが空スラッグならフィルタ無しに倒す", () => {
            window.history.replaceState({}, "", "/?category=-");
            const { result } = renderHook(() => useGallery(odd2));
            expect(result.current.filters.category, "空のまま絞り込んでいる").toBe("all");
            expect(result.current.filteredPhotos).toHaveLength(3);
        });
    });

    describe("ソート", () => {
        it("古い順（old）でソートできる", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.setFilters({ sort: "old" });
            });
            const dates = result.current.filteredPhotos.map((p) => p.date);
            expect(dates[0]).toBe("2024-01-15");
            expect(dates[2]).toBe("2024-06-10");
        });

        it("人気順（popular）でソートできる", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.setFilters({ sort: "popular" });
            });
            const likes = result.current.filteredPhotos.map((p) => p.likes);
            expect(likes[0]).toBe(20);
            expect(likes[2]).toBe(5);
        });
    });

    describe("URL 同期（?photo=）", () => {
        // 共有リンク /?photo=<id> で開いても、フィルタ同期の replaceState が
        // ?photo= を消していた。見えている写真とアドレスバーが食い違い、
        // 再読込・ブックマーク・アドレスバーのコピーのどれでも戻れなかった。
        it("モーダルを開くと ?photo= がURLに載る", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => { result.current.open(0); });
            expect(new URLSearchParams(window.location.search).get("photo"))
                .toBe(result.current.filteredPhotos[0].id);
        });

        it("閉じると ?photo= が消える", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => { result.current.open(0); });
            act(() => { result.current.close(); });
            expect(new URLSearchParams(window.location.search).get("photo")).toBeNull();
        });

        it("前後に送ると ?photo= も追従する", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => { result.current.open(0); });
            act(() => { result.current.next(); });
            expect(new URLSearchParams(window.location.search).get("photo"))
                .toBe(result.current.filteredPhotos[1].id);
        });

        // **feed だけ URL に載っていなかった。** 他のフィルターは全部載るのに
        // ここだけ落ちていたので、「フォロー中」で写真を開いて戻ると
        // 「すべて」に戻っていた（同じ画面の中でここだけ挙動が違う）。
        it("フォロー中も URL に載る", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => { result.current.setFilters({ feed: "following" }); });
            expect(new URLSearchParams(window.location.search).get("feed")).toBe("following");
        });

        it("すべてに戻せば URL からも消える", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => { result.current.setFilters({ feed: "following" }); });
            act(() => { result.current.setFilters({ feed: "all" }); });
            expect(new URLSearchParams(window.location.search).get("feed")).toBeNull();
        });

        it("URL の feed を読んで復元する", () => {
            window.history.replaceState({}, "", "/?feed=following");
            const { result } = renderHook(() => useGallery(mockPhotos));
            expect(result.current.filters.feed).toBe("following");
        });

        // 知らない文字列を入れられても既定のまま（総当たりで確かめている）
        it("知らない値は無視する", () => {
            window.history.replaceState({}, "", "/?feed=whatever");
            const { result } = renderHook(() => useGallery(mockPhotos));
            expect(result.current.filters.feed).toBe("all");
        });

        // **開けるまで `?photo=` を落とさない。**
        // この同期は「開いている写真」しか書かないので、マウント直後に走ると
        // URL から id が消える。すぐ開ければ書き戻るが、一覧がその場に無いと
        // （`?feed=following` のフォロー集合待ち・新着写真の API 待ち）
        // 落ちたままになり、数百ms後に開けるようになっても id が無い
        it("まだ開けていない ?photo= は URL に残す", () => {
            window.history.replaceState({}, "", "/?photo=missing-yet");
            renderHook(() => useGallery([]));   // 一覧がまだ無い
            expect(new URLSearchParams(window.location.search).get("photo")).toBe("missing-yet");
        });

        it("一覧が来て開けたら、そのまま載り続ける", () => {
            window.history.replaceState({}, "", `/?photo=${mockPhotos[1].id}`);
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => { result.current.openById(mockPhotos[1].id); });
            expect(new URLSearchParams(window.location.search).get("photo")).toBe(mockPhotos[1].id);
        });

        it("無いと分かったら捨てる（死んだ ?photo= を残さない）", () => {
            window.history.replaceState({}, "", "/?photo=deleted");
            const { result } = renderHook(() => useGallery(mockPhotos));
            expect(new URLSearchParams(window.location.search).get("photo")).toBe("deleted");
            // **その場で外れる**（次に同期が走るまで待たない）。待つ形だと
            // 再読込のたびに同じ「見つかりません」が出続ける
            act(() => { result.current.setPendingPhoto(null); });
            expect(new URLSearchParams(window.location.search).get("photo")).toBeNull();
        });

        it("捨てても、他のフィルターは URL に残す", () => {
            window.history.replaceState({}, "", "/?category=landscape&photo=deleted");
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => { result.current.setPendingPhoto(null); });
            const params = new URLSearchParams(window.location.search);
            expect(params.get("photo")).toBeNull();
            expect(params.get("category"), "巻き添えで他のフィルターまで消している").toBe("landscape");
        });

        it("開いてから閉じれば、待ち id は復活しない", () => {
            window.history.replaceState({}, "", `/?photo=${mockPhotos[0].id}`);
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => { result.current.openById(mockPhotos[0].id); });
            act(() => { result.current.close(); });
            expect(new URLSearchParams(window.location.search).get("photo"),
                "閉じたのに ?photo= が戻っている").toBeNull();
        });

        it("フィルタと同時に載る（どちらも失わない）", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => { result.current.setFilters({ category: "landscape" }); });
            act(() => { result.current.open(0); });
            const params = new URLSearchParams(window.location.search);
            expect(params.get("category")).toBe("landscape");
            expect(params.get("photo")).toBe(result.current.filteredPhotos[0].id);
        });
    });

    describe("openById（?photo= からの復元）", () => {
        it("IDで開ける", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            let ok = false;
            act(() => { ok = result.current.openById("3"); });
            expect(ok).toBe(true);
            expect(result.current.filteredPhotos[result.current.currentIndex!].id).toBe("3");
        });

        it("一覧に無いIDでは何も起きない（false を返す）", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            let ok = true;
            act(() => { ok = result.current.openById("nope"); });
            expect(ok).toBe(false);
            expect(result.current.currentIndex).toBeNull();
        });
    });

    describe("モーダル操作", () => {
        it("open で currentIndex が設定される", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.open(1);
            });
            expect(result.current.currentIndex).toBe(1);
        });

        it("close で currentIndex が null になる", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.open(0);
            });
            act(() => {
                result.current.close();
            });
            expect(result.current.currentIndex).toBeNull();
        });

        it("next で次の index に進む", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.open(0);
            });
            act(() => {
                result.current.next();
            });
            expect(result.current.currentIndex).toBe(1);
        });

        it("prev で前の index に戻る", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.open(2);
            });
            act(() => {
                result.current.prev();
            });
            expect(result.current.currentIndex).toBe(1);
        });

        it("最後の次は先頭に循環する", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => {
                result.current.open(2);
            });
            act(() => {
                result.current.next();
            });
            expect(result.current.currentIndex).toBe(0);
        });
    });
});
