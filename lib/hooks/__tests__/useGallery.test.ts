import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, render } from "@testing-library/react";
import React, { useLayoutEffect } from "react";
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

        // **守っているのは「全件一致にならない」こと。**「0件」はその一例だった。
        // タグを検索の材料に入れた（`useGallery.ts`）ので、`-` という**そのタグを
        // 持つ写真**には素の `includes` で当たるようになった——これは
        // 「空スラッグが全件に当たる」穴とは別物で、生の文字としての一致。
        // 危ない側（3件とも出る）が起きないことを名指しで見る。
        it("検索語が空スラッグでも、全件一致にならない", () => {
            window.history.replaceState({}, "", "/?q=-");
            const { result } = renderHook(() => useGallery(odd2));
            const ids = result.current.filteredPhotos.map((p) => p.id);
            expect(ids, "絞り込みが効かず全件出ている").not.toEqual(["dash", "hash", "plain"]);
            expect(ids, "その文字を持たない写真まで出ている").toEqual(["dash"]);
        });

        it("スラッグが空になる別の値でも全件一致にならない", () => {
            window.history.replaceState({}, "", "/?q=%23%23%23");
            const { result } = renderHook(() => useGallery(odd2));
            expect(result.current.filteredPhotos.map((p) => p.id)).toEqual(["hash"]);
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

    /**
     * **タグとカテゴリも検索の材料に入れる。**
     *
     * 入っていなかったので、owner 自身が書いた語を打っても0件だった。
     * 実データ（公開30枚）で数えた:
     *
     *     タグ59種のうち **12種が0件**（nature 3枚 / architecture 2枚 /
     *       yamanaka 2枚 / loyly 2枚 / 「動物」…）
     *     1件以上当たっていた **47種も偶然**（題か説明に同じ語がある回だけ）
     *       ——しかもそのうち **4種は一部の写真しか出ていなかった**
     *     カテゴリは `landscape` 12枚 → **0件**・`nature` 3枚 → 0件
     *
     * しかも**ホームのタグチップは上位10種だけ**（`POPULAR_TAG_LIMIT`）なので、
     * 残り49種はチップからも選べない——打つしかないのに打っても出なかった。
     */
    // **欄の文言が実態より狭いことを名乗っていた。** 撮影地とカメラ名は前から
    // 入っていたのに「タイトルや説明で検索」と書いてあった。両方の言語とも
    // 旧文言に戻しても全4930件が緑だったので、ここで縛る
    describe("検索欄の文言は、実際に探せる範囲を名乗る", () => {
        it("タグに触れている（ja / en とも）", async () => {
            const { getLabels } = await import("../../../app/i18n/labels");
            expect(getLabels("ja").search.placeholder, "日本語の文言がタグに触れていない").toContain("タグ");
            expect(getLabels("en").search.placeholder.toLowerCase(),
                "英語の文言が「タイトルか説明」だけを名乗っている").not.toContain("title or description");
        });
    });

    describe("タグ・カテゴリでも探せる", () => {
        const tagged: Photo[] = [
            { id: "s", src: "s.jpg", title: { ja: "湖の朝", en: "Lake morning" },
              category: "nature", tags: ["swan", "白鳥"], date: "2024-05-01" },
            { id: "o", src: "o.jpg", title: { ja: "街の夜", en: "City night" },
              category: "street", tags: ["night"], date: "2024-05-02" },
        ];

        it("タグの語で探せる（題にも説明にも無い語）", () => {
            window.history.replaceState({}, "", "/?q=swan");
            const { result } = renderHook(() => useGallery(tagged));
            expect(result.current.filteredPhotos.map((p) => p.id),
                "タグが検索の材料に入っていない").toEqual(["s"]);
        });

        it("日本語のタグでも探せる", () => {
            window.history.replaceState({}, "", "/?q=%E7%99%BD%E9%B3%A5");
            const { result } = renderHook(() => useGallery(tagged));
            expect(result.current.filteredPhotos.map((p) => p.id)).toEqual(["s"]);
        });

        it("カテゴリの語で探せる", () => {
            window.history.replaceState({}, "", "/?q=nature");
            const { result } = renderHook(() => useGallery(tagged));
            expect(result.current.filteredPhotos.map((p) => p.id),
                "カテゴリが検索の材料に入っていない").toEqual(["s"]);
        });

        // **日本語のカテゴリでも探せる。** `useGallery` は写真を先に正規化して
        // `category` を**スラッグ**にするので（`normalizeKey`）、スラッグだけを
        // 材料にすると「建築」と打った人には当たらない。表示に使う日本語名も足す
        it("日本語のカテゴリ語で探せる（保存はスラッグに畳まれていても）", () => {
            const ja: Photo[] = [
                { id: "k", src: "k.jpg", title: { ja: "ビル", en: "Building" },
                  category: "建築", tags: [], date: "2024-05-01" },
                { id: "z", src: "z.jpg", title: { ja: "海", en: "Sea" },
                  category: "nature", tags: [], date: "2024-05-02" },
            ];
            window.history.replaceState({}, "", "/?q=%E5%BB%BA%E7%AF%89");
            const { result } = renderHook(() => useGallery(ja));
            expect(result.current.filteredPhotos.map((p) => p.id),
                "日本語の表示名が材料に入っていない").toEqual(["k"]);
        });

        // **タグは区切って連結する。** 詰めて並べると、隣り合う2つが
        // くっついて**存在しない語**ができ、その語で当たってしまう。
        //
        // ⚠️ **これが効くのは素の `includes` の経路だけ。** もう一段の
        // スラッグ比較（`normalizeForSearch` を両側に掛ける側）は空白を
        // `-` に潰すので、**区切っていても**タグをまたいだ語で当たる
        // （実測 `?q=山中湖-swan` → 1件・`?q=finland-helsinki` → 4件）。
        // 実害は低い——`?q=` に振り替わるのは撮影地と機材のスラッグだけで、
        // そこは前後で結果が変わらないことを実データ14件で確かめてある。
        it("隣り合うタグがくっついた語では当たらない", () => {
            const two: Photo[] = [
                { id: "f", src: "f.jpg", title: { ja: "写真", en: "Photo" },
                  category: "street", tags: ["fuji", "film"], date: "2024-05-01" },
            ];
            window.history.replaceState({}, "", "/?q=fujifilm");
            const { result } = renderHook(() => useGallery(two));
            expect(result.current.filteredPhotos, "タグを詰めて連結している").toHaveLength(0);
        });

        // **材料を足しただけで、規則は変えていない。** 当たらない語は当たらない
        it("関係ない語では当たらない", () => {
            window.history.replaceState({}, "", "/?q=penguin");
            const { result } = renderHook(() => useGallery(tagged));
            expect(result.current.filteredPhotos).toHaveLength(0);
        });

        // タグが無い・カテゴリが無い写真で落ちない（`undefined` を連結しない）
        it("タグもカテゴリも無い写真を混ぜても壊れない", () => {
            const bare = [{ id: "b", src: "b.jpg", title: { ja: "無印", en: "Bare" }, date: "2024-05-03" } as Photo, ...tagged];
            window.history.replaceState({}, "", "/?q=undefined");
            const { result } = renderHook(() => useGallery(bare));
            expect(result.current.filteredPhotos, "undefined が本文として混ざっている").toHaveLength(0);
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

        // トップの「自分／フォロー中／すべて」。開いて戻ったとき・再読込で
        // 「自分」が「すべて」に戻らないよう URL に載せる（`feed` のときに一度直した形）
        it("scope を URL に載せ、すべてに戻せば消える", () => {
            const { result } = renderHook(() => useGallery(mockPhotos, "me"));
            act(() => { result.current.setFilters({ scope: "featured" }); });
            expect(new URLSearchParams(window.location.search).get("scope")).toBe("featured");
            act(() => { result.current.setFilters({ scope: "all" }); });
            expect(new URLSearchParams(window.location.search).get("scope")).toBeNull();
        });

        it("URL の scope を読んで復元する。知らない値は無視", () => {
            window.history.replaceState({}, "", "/?scope=following");
            expect(renderHook(() => useGallery(mockPhotos, "me")).result.current.filters.scope).toBe("following");
            window.history.replaceState({}, "", "/?scope=whatever");
            expect(renderHook(() => useGallery(mockPhotos, "me")).result.current.filters.scope).toBe("all");
        });

        // **「おすすめ」は絞らず、並べ替える**（iOS の `HomeFeed` と同じ・2026-09-29）。
        // 運営が選んだ写真（`featured`）を先に、残りはいいねの多い順＝**空にならない**。
        // 以前は選ばれた写真だけに絞っていて、本番（featured 0枚）では空だった
        it("おすすめ: 選ばれた写真を先に、残りはいいねの多い順。未ログインでも同じ", () => {
            const photos = [
                // いいねは全部明示する（`mockPhotos` がいいねを持っているので、引き継ぐと並びが変わる）
                { ...mockPhotos[0], id: "plain-liked", likes: 5 },
                { ...mockPhotos[1], id: "pick-1", featured: true, likes: 0 },
                { ...mockPhotos[2], id: "plain", likes: 0 },
                { ...mockPhotos[0], id: "pick-2", featured: true, likes: 2 },
            ];
            window.history.replaceState({}, "", "/?scope=featured");
            const order = (viewer: string | null) =>
                renderHook(() => useGallery(photos, viewer)).result.current.filteredPhotos.map((p) => p.id);
            expect(order("me").slice(0, 3)).toEqual(["pick-2", "pick-1", "plain-liked"]);
            expect(order("me")).toHaveLength(4);                 // 絞らない
            // **本人の id に依らない。** ここを `ownUserId` で分岐させると、
            // 未ログインの人に「おすすめ」が出なくなる
            expect(order(null)).toEqual(order("me"));
        });

        it("おすすめ: 印が `true` の写真だけを先に出す（truthy では拾わない）", () => {
            // 壊れた値を通す（本番のデータは何でもありうる）。型の穴は
            // **配列ごと**開ける——要素に `@ts-expect-error` を置くと、
            // エラーが出るのは呼び出し側なので「使われていない」と言われる
            const photos = [
                { ...mockPhotos[0], id: "truthy", featured: "yes", likes: 9 },
                { ...mockPhotos[1], id: "pick", featured: true, likes: 0 },
            ] as unknown as Photo[];
            window.history.replaceState({}, "", "/?scope=featured");
            expect(renderHook(() => useGallery(photos, "me")).result.current.filteredPhotos.map((p) => p.id))
                .toEqual(["pick", "truthy"]);
        });

        // **開けるまで `?photo=` を落とさない。**
        // この同期は「開いている写真」しか書かないので、マウント直後に走ると
        // URL から id が消える。すぐ開ければ書き戻るが、一覧がその場に無いと
        // （新着写真の API 待ち・絞り込みで外れているだけ）
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

/**
 * 🔴 **`<Link>` で飛んだ行き先のクエリを、読み直して追随する。**
 *
 * 2026-09-23 まで、`urlFilters` の依存は `[clientRender]` だけだった
 * ——水和のときに一度読んだきり読み直さないので、`<Link>` の遷移で
 * 行き先の `?category=` を知らないまま、空の絞り込みを URL へ書き戻していた。
 * 実ブラウザで `history` の呼び出しを記録して確かめた症状:
 *
 *     1889.6ms  pushState     /search?category=landscape   ← Next の <Link>
 *     1953.2ms  replaceState  /search                      ← useGallery が消す
 *
 * **URL は一度は正しくなっている。** 消していたのはこのフック自身だった。
 */
describe("URL の読み直し（<Link> の遷移）", () => {
    it("pushState で `?category=` が付いたら、絞り込みが追随する", () => {
        const { result } = renderHook(() => useGallery(mockPhotos));
        expect(result.current.filteredPhotos, "はじめは全件").toHaveLength(3);
        act(() => {
            window.history.pushState({}, "", "/search?category=landscape");
        });
        expect(result.current.filters.category, "行き先のクエリを読んでいない").toBe("landscape");
        expect(result.current.filteredPhotos).toHaveLength(1);
        expect(result.current.filteredPhotos[0].id).toBe("2");
    });

    /**
     * 🔴 **消さない。** 追随できても、直後の同期が空の絞り込みで
     * 書き戻したら同じことになる（それが元の症状）。
     */
    /**
     * 🔴 **本物の `<Link>` と同じ順序を作る。**
     *
     * 実ブラウザで記録した順は **行き先の描画 → `pushState` → 効果**。
     * つまり効果が走るとき、描画が見ていた URL は**1つ古い**。そのまま
     * 書くと行き先のクエリを消す——これが元の症状そのもの。
     *
     * `useLayoutEffect` は passive な `useEffect` より先に走るので、
     * 「描き終わったが、こちらの同期はまだ」という隙間をここで作れる。
     * （`pushState` を直に呼ぶ上のテストでは、知らせ → 描き直しが先に
     * 済んでしまうので、この順序は作れない＝門を外しても落ちなかった。）
     */
    it("描画のあとに URL が変わっても、クエリを消さない", () => {
        const seen: string[] = [];
        function Probe() {
            const g = useGallery(mockPhotos);
            useLayoutEffect(() => {
                // 描き終わった直後・同期の前に、行き先の URL になる
                if (window.location.search === "") window.history.pushState({}, "", "/search?category=landscape");
            });
            seen.push(g.filters.category ?? "");
            return null;
        }
        render(React.createElement(Probe));
        expect(window.location.search, "同期が行き先のクエリを消した").toBe("?category=landscape");
        expect(seen.at(-1), "最後の描画で絞り込みを読めていない").toBe("landscape");
    });

    it("追随したあと、URL からクエリが消えない", () => {
        const { result } = renderHook(() => useGallery(mockPhotos));
        act(() => {
            window.history.pushState({}, "", "/search?category=landscape");
        });
        expect(result.current.filters.category).toBe("landscape");
        expect(window.location.search, "同期がクエリを消した").toBe("?category=landscape");
    });

    /**
     * ⚠️ **`replaceState` ＋ `popstate` を投げる形では見張れない。**
     * `replaceState` はこちらが包んでいるので、その時点で知らせが行く
     * ——`popstate` を1行も聞かなくても通ってしまう（変異で確認）。
     * **本物の「戻る」**（`history.back()`）は履歴を動かすだけで
     * `pushState` / `replaceState` を通らないので、こちらで見る。
     */
    it("戻ると、絞り込みも戻る（popstate）", async () => {
        const { result } = renderHook(() => useGallery(mockPhotos));
        act(() => {
            window.history.pushState({}, "", "/search?category=landscape");
        });
        expect(result.current.filters.category).toBe("landscape");
        await act(async () => {
            // jsdom の `back()` は履歴の移動を**非同期**で行う。
            // 固定の待ちだと取りこぼすので、`popstate` が来るまで待つ
            const back = new Promise<void>((resolve) => {
                window.addEventListener("popstate", () => resolve(), { once: true });
            });
            window.history.back();
            await back;
        });
        expect(window.location.search, "URL が戻っていない（前提が崩れている）").toBe("");
        expect(result.current.filters.category, "戻ったのに絞り込みが残っている").toBe("all");
    });

    /**
     * **人が触ったぶんは URL より強い**（外した絞り込みが URL から生き返らない）。
     * この性質は前からあるもので、読み直しを入れても変わっていない。
     */
    it("人が外した絞り込みは、URL から生き返らない", () => {
        const { result } = renderHook(() => useGallery(mockPhotos));
        act(() => {
            window.history.pushState({}, "", "/search?category=landscape");
        });
        expect(result.current.filters.category).toBe("landscape");
        act(() => {
            result.current.setFilters({ category: "all" });
        });
        expect(result.current.filters.category, "URL の値が生き返っている").toBe("all");
        expect(result.current.filteredPhotos).toHaveLength(3);
    });
});
