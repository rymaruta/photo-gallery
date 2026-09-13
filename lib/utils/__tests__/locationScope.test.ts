import { describe, it, expect } from "vitest";
import { photoIsInLocation, sameLocation } from "../related";
import { photosInCollection, isIndexableCollection, collectEntries } from "../collections";
import type { Photo } from "../../data/photos";

/**
 * **集約ページの「この撮影地の写真」には向きが要る。**
 *
 * `sameLocation` は対称（`a.includes(b) || b.includes(a)`）で、写真ページの
 * 回遊（近くの写真を並べる）にはそれでよい。だが集約ページに使うと、
 * **広い方の写真が狭いページに載る**:
 *
 *     ページ「フィンランド」            ← 写真「ヘルシンキ, フィンランド」  ○
 *     ページ「ヘルシンキ, フィンランド」  ← 写真「フィンランド」            ✗
 *
 * 実測（撮影地12枚を埋めて実ビルド）: `/location/ロヴァニエミ,-フィンランド`
 * が **7枚**を並べていた（実際にそこで撮ったのは1枚）。
 * **これは `MIN_INDEXABLE_LOCATION = 2` を骨抜きにしていた**——
 * 別の場所の写真で枚数を水増しして、1枚のページが索引に載っていた。
 */
const P = (id: string, location: string) =>
    ({ id, src: `https://cdn/${id}.jpg`, location }) as Photo;

describe("撮影地の包含には向きがある", () => {
    it("細かい撮影地の写真は、広い見出しのページに載る", () => {
        expect(photoIsInLocation("ヘルシンキ, フィンランド", "フィンランド")).toBe(true);
    });

    it("広い撮影地の写真は、細かい見出しのページには載らない", () => {
        expect(photoIsInLocation("フィンランド", "ヘルシンキ, フィンランド")).toBe(false);
    });

    it("同じ撮影地なら載る（空白・大小の違いは無視）", () => {
        expect(photoIsInLocation("パリ, フランス", "パリ,  フランス")).toBe(true);
        expect(photoIsInLocation("Paris", "paris")).toBe(true);
    });

    it("1文字の撮影地では束ねない（誤爆が大きすぎる）", () => {
        expect(photoIsInLocation("京", "京")).toBe(false);
    });

    it("空なら載らない", () => {
        expect(photoIsInLocation(undefined, "パリ")).toBe(false);
        expect(photoIsInLocation("パリ", undefined)).toBe(false);
    });

    // **回遊の側は対称のまま。** 近くの写真を見せる導線なので、
    // ロヴァニエミの写真にフィンランドの写真が並ぶのは望ましい
    it("写真ページの回遊（sameLocation）は今までどおり対称", () => {
        expect(sameLocation("フィンランド", "ヘルシンキ, フィンランド")).toBe(true);
        expect(sameLocation("ヘルシンキ, フィンランド", "フィンランド")).toBe(true);
    });
});

describe("集約ページの中身と、索引に載るかどうか", () => {
    const photos = [
        P("a", "ロヴァニエミ, フィンランド"),
        P("b", "フィンランド"),
        P("c", "フィンランド"),
        P("d", "ヘルシンキ, フィンランド"),
        P("e", "ヘルシンキ, フィンランド"),
    ];

    it("国のページには、その国の写真が全部載る", () => {
        expect(photosInCollection(photos, "location", "フィンランド").map((p) => p.id).sort())
            .toEqual(["a", "b", "c", "d", "e"]);
    });

    it("街のページには、その街の写真だけが載る", () => {
        expect(photosInCollection(photos, "location", "ヘルシンキ,-フィンランド").map((p) => p.id).sort())
            .toEqual(["d", "e"]);
    });

    // **これが直したかったこと。** 対称だと国の写真2枚を数えて3枚になり、
    // 1枚しか無いページが索引に載っていた
    it("1枚しか無い街のページは索引に載らない（別の場所の写真で水増ししない）", () => {
        const inC = photosInCollection(photos, "location", "ロヴァニエミ,-フィンランド");
        expect(inC.map((p) => p.id)).toEqual(["a"]);
        expect(isIndexableCollection(inC.length, "location"), "1枚なのに索引に載せている").toBe(false);
    });
});

/**
 * **数える側とページの中身は、同じ関数で見る。**
 *
 * 一覧のチップは `collectEntries` が件数を持ち、ページの中身は
 * `photosInCollection` が決める。**片方だけ直すと、チップの「N枚」と
 * 実際に並ぶ枚数、そして noindex の判定が食い違う。**
 * 変異で確かめたら、**数える側だけ対称に戻しても全部緑**だった
 * （＝誰も見ていなかった）。
 */
describe("チップの件数と、ページの中身が一致する", () => {
    const photos = [
        P("a", "ロヴァニエミ, フィンランド"),
        P("b", "フィンランド"),
        P("c", "フィンランド"),
        P("d", "ヘルシンキ, フィンランド"),
        P("e", "ヘルシンキ, フィンランド"),
    ];

    it("撮影地のチップの件数が、そのページに並ぶ枚数と同じ", () => {
        for (const e of collectEntries(photos, "location")) {
            expect(e.count, `${e.label} のチップの件数がページの枚数と違う`)
                .toBe(photosInCollection(photos, "location", e.slug).length);
        }
    });

    it("1枚しか無い街は、チップでも1件（別の場所の写真で水増ししない）", () => {
        const e = collectEntries(photos, "location").find((x) => x.label.startsWith("ロヴァニエミ"));
        expect(e?.count).toBe(1);
    });
});

