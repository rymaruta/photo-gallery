import { describe, it, expect, beforeEach, vi } from "vitest";
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

        // **上のテストは、フィクスチャが小さいせいで穴があった。**
        //
        // `84b0c59` で `slugify` に 200 バイトの上限を入れた（スラッグは
        // ファイル名になり、超えるとビルドごと落ちるため）。ところがここは
        // **タイトル＋説明＋撮影地をつないだ長い文字列**に同じ関数を掛けて
        // いたので、後ろにある撮影地が丸ごと落ちて救済が0件になった。
        // 実データ30件のうち16件が 200 バイト超で、**8件は撮影地がその外側**
        // （「フランス」は 455 バイト目、「オペラ・ガルニエ（パリ）」は
        // 283 バイト目）。**説明の無いフィクスチャでは一度も踏まない。**
        it("説明が長くても、スラッグ形のクエリで撮影地に一致する", () => {
            // 実データにある写真と同じくらいの説明（ja/en 各3段落）
            const long = "この場所を訪れたのは秋の終わりでした。".repeat(6)
                + "The light was soft and the streets were quiet all afternoon. ".repeat(6);
            const photos = [
                { ...mockPhotos[0], id: "loc1", description: long, location: "フランス ヴェルサイユ" },
                { ...mockPhotos[1], id: "loc2", description: long, location: "東京" },
            ];
            const { result } = renderHook(() => useGallery(photos));
            act(() => {
                result.current.setFilters({ query: "フランス-ヴェルサイユ" });
            });
            expect(result.current.filteredPhotos.map((p) => p.id),
                "説明に押し出されて撮影地が比較対象から落ちている").toEqual(["loc1"]);
        });

        // **機材名の検索を見るテストが1本も無かった。**
        // `/camera/<スラッグ>` の404救済は `/?q=<スラッグ>` に振り替えるので、
        // ここに機材名が入っていないと**必ず0件**になる。その土台ごと
        // 無防備だった（`p.exif?.camera` の行を消しても全緑）。
        it("機材名でも検索できる（/camera の404救済の土台）", () => {
            const photos = [
                { ...mockPhotos[0], id: "c1", exif: { camera: "SONY ILCE-7M3" } },
                { ...mockPhotos[1], id: "c2", exif: { camera: "Apple iPhone 14 Pro" } },
            ];
            const { result } = renderHook(() => useGallery(photos));
            act(() => { result.current.setFilters({ query: "sony-ilce-7m3" }); });
            expect(result.current.filteredPhotos.map((p) => p.id),
                "機材名が検索の対象に入っていない").toEqual(["c1"]);
        });

        // **二重のメーカー名で保存された古い行**（実データに
        // `"Hasselblad Hasselblad X2D II 100C"` が実在）。集約ページの鍵は
        // `dedupeCameraName` を通した名前なので、404救済が振り替える
        // `?q=` の値もそちら。生の値だけを見ていると、**畳み方が
        // 先頭トークン以外に広がった瞬間に0件**になる。
        it("畳んだ機材名でも検索できる（集約ページの鍵と同じ形）", () => {
            const photos = [
                { ...mockPhotos[0], id: "c1", exif: { camera: "Hasselblad Hasselblad X2D II 100C" } },
                { ...mockPhotos[1], id: "c2", exif: { camera: "Apple iPhone 14 Pro" } },
            ];
            const { result } = renderHook(() => useGallery(photos));
            // 畳んだ形（集約ページの鍵）
            act(() => { result.current.setFilters({ query: "hasselblad-x2d-ii-100c" }); });
            expect(result.current.filteredPhotos.map((p) => p.id)).toEqual(["c1"]);
            // 生の値でも従来どおり探せる（片方に寄せて壊していない）
            act(() => { result.current.setFilters({ query: "hasselblad-hasselblad-x2d-ii-100c" }); });
            expect(result.current.filteredPhotos.map((p) => p.id),
                "生の値で探せなくなっている").toEqual(["c1"]);
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

    // **並びが閲覧者のタイムゾーンで変わっていた。** ここで `new Date()` を
    // 通していた頃、ゾーン無しの `2024-11-01T07:30:00`（EXIF 由来の撮影日）は
    // ローカル時刻、日付だけの `2024-11-01` は UTC と解釈され、JST と UTC で
    // 並びが逆になった。静的HTMLはビルド時（UTC）の順で焼かれるので、
    // JST の閲覧者ではハイドレーションの前後で並びが変わることになる。
    describe("タイムゾーンで並びが変わらない", () => {
        const tzPhotos: Photo[] = [
            { id: "dayOnly", src: "d.jpg", title: { ja: "日付だけ", en: "d" }, category: "street", tags: [], date: "2024-11-01" },
            { id: "wall", src: "w.jpg", title: { ja: "時刻つき", en: "w" }, category: "street", tags: [], date: "2024-11-01T07:30:00" },
        ];

        it.each(["Asia/Tokyo", "UTC", "America/New_York"])("%s でも同じ順", (tz) => {
            const before = process.env.TZ;
            process.env.TZ = tz;
            try {
                const { result } = renderHook(() => useGallery(tzPhotos));
                // 同じ日の 07:30 は 00:00 より新しい（どのゾーンでも）
                expect(result.current.filteredPhotos.map((p) => p.id),
                    "閲覧者のタイムゾーンで並びが変わっている").toEqual(["wall", "dayOnly"]);
            } finally {
                if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
            }
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

        // **閉じ方が変わった（HIST-1）。** 開くときに履歴を1件積むように
        // したので、閉じるときは `history.back()` でその1件を戻して消す。
        // ブラウザの戻りは非同期なので、URL の確認は1ティック待つ。
        // `replaceState` で消すと、履歴に「?photo= の無い同じページ」が
        // 2件並び、閉じたあとの戻るが**空振り**になる。
        it("閉じると、積んだ1件を戻して ?photo= を消す", async () => {
            const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
            try {
                const { result } = renderHook(() => useGallery(mockPhotos));
                act(() => { result.current.open(0); });
                act(() => { result.current.close(); });
                // 実ブラウザではこの `back()` が URL を戻す。jsdom の履歴は
                // ファイル内のテストで共有されるので、URL ではなく**契約**を見る
                expect(back, "積んだ履歴を戻していない（戻るが空振りする）").toHaveBeenCalledTimes(1);
            } finally {
                back.mockRestore();
            }
        });

        // 共有リンク（`/?photo=<id>`）で来たときは、その1件が既に
        // 「開いている状態」なので積まない。積むと閉じたときの戻り先が
        // `?photo=` 付きになり、画面と アドレスバーが食い違う
        it("URL から開いたときは積まない（閉じたら消すだけ）", async () => {
            const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
            try {
                window.history.replaceState({}, "", `/?photo=${mockPhotos[0].id}`);
                const { result } = renderHook(() => useGallery(mockPhotos));
                act(() => { result.current.openById(mockPhotos[0].id); });
                expect(back).not.toHaveBeenCalled();

                act(() => { result.current.close(); });
                expect(back, "積んでいないのに戻している（ページを離れる）").not.toHaveBeenCalled();
                expect(new URLSearchParams(window.location.search).get("photo")).toBeNull();
            } finally {
                back.mockRestore();
            }
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

        // **戻るで閉じられるようにする（HIST-1）。**
        // URL の同期は全部 `replaceState` だったので、その場で開いたモーダル
        // （静的ページがまだ無い新着写真はグリッドのタップで直接開く）は
        // **戻るで閉じずにページごと戻っていた**——一覧のスクロール位置も
        // 絞り込みもまとめて失う。スマホの主要導線。
        it("開くと履歴が1件増える", () => {
            const before = window.history.length;
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => { result.current.open(0); });
            expect(window.history.length, "履歴を積んでいない（戻るでページを離れる）")
                .toBe(before + 1);
            expect((window.history.state as { photoModal?: string } | null)?.photoModal)
                .toBe(result.current.filteredPhotos[0].id);
        });

        // **共有リンクから送ったときに積んでいた（レビューが実ブラウザで再現）。**
        // 「いまの URL にその id が載っているか」だけで決めていたので、
        // 送った瞬間に条件が揃って push され、閉じると `back()` が1枚目の
        // エントリへ戻して**モーダルが開き直る**（1回目の「閉じる」が効かない）。
        it("共有リンクから開いて送っても、履歴は増えない", () => {
            window.history.replaceState({}, "", `/?photo=${mockPhotos[0].id}`);
            const before = window.history.length;
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => { result.current.openById(mockPhotos[0].id); });
            act(() => { result.current.next(); });
            expect(window.history.length, "送った先で履歴を積んでいる（閉じると開き直す）")
                .toBe(before);
        });

        it("共有リンクから開いて送ったあと、閉じるときに戻さない", () => {
            const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
            try {
                window.history.replaceState({}, "", `/?photo=${mockPhotos[0].id}`);
                const { result } = renderHook(() => useGallery(mockPhotos));
                act(() => { result.current.openById(mockPhotos[0].id); });
                act(() => { result.current.next(); });
                act(() => { result.current.close(); });
                expect(back, "戻してしまい、前の写真で開き直す").not.toHaveBeenCalled();
                expect(new URLSearchParams(window.location.search).get("photo")).toBeNull();
            } finally {
                back.mockRestore();
            }
        });

        // **Next の内部状態を潰さない。** `replaceState({}, ...)` で消すと、
        // そのエントリに戻ったとき Next の popstate ハンドラが
        // `if (!event.state.__NA) window.location.reload()` に落ち、
        // **ページごと再読み込みされて一覧のスクロール位置が消える**
        // （レビューが実ブラウザで確認: scrollY 1049 → 0）。
        it("履歴を書いても Next の内部状態を消さない", () => {
            window.history.replaceState({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["x"] }, "", "/");
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => { result.current.open(0); });
            const opened = window.history.state as Record<string, unknown>;
            expect(opened.__NA, "開いたときに Next の状態を消している（戻ると再読み込みされる）").toBe(true);
            expect(opened.__PRIVATE_NEXTJS_INTERNALS_TREE).toEqual(["x"]);

            act(() => { result.current.setFilters({ category: "landscape" }); });
            expect((window.history.state as Record<string, unknown>).__NA,
                "フィルタの同期で Next の状態を消している").toBe(true);
        });

        // 送るたびに積むと、閉じるのに送った回数ぶん戻るを押すことになる
        it("前後に送っても履歴は増えない", () => {
            const { result } = renderHook(() => useGallery(mockPhotos));
            act(() => { result.current.open(0); });
            const afterOpen = window.history.length;
            act(() => { result.current.next(); });
            act(() => { result.current.next(); });
            expect(window.history.length, "送るたびに履歴を積んでいる").toBe(afterOpen);
        });

        // 閉じたあとに「?photo= の無い同じページ」が2件並ぶと、戻るが空振りする。
        // **`history.length` は戻っても減らない**（ブラウザも同じ）ので、
        // 「積んだ印が現在地から外れたか」で見る。
        // 戻る操作で閉じた場合は popstate が既に1件戻しているので、
        // ここで もう一度 `back()` を呼ぶと**2件戻ってページを離れる**
        it("戻る操作で閉じたときは二重に戻さない", () => {
            const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
            try {
                const { result } = renderHook(() => useGallery(mockPhotos));
                act(() => { result.current.open(0); });
                // 戻るで閉じた状態を作る（積んだ印の無い履歴に載っている）
                window.history.replaceState({}, "", "/");
                act(() => { result.current.close(); });
                expect(back, "二重に戻している（ページを離れる）").not.toHaveBeenCalled();
            } finally {
                back.mockRestore();
            }
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
