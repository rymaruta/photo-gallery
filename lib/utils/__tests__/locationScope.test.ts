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

// 🔴 字の包含で見ていたので、「福岡」が宮城県白石市の大字「福岡八宮」に当たり、
// 蔵王キツネ村の写真が /location/福岡 に載っていた（owner の指摘・本番で確認・2026-09-30）
describe("撮影地は名前として含むときだけ当てる（字の途中では当てない）", () => {
    const ZAO = "蔵王キツネ村, 南蔵王七ヶ宿線, 福岡八宮, 白石市, 宮城県, 989-0733, 日本";

    it("蔵王キツネ村は /location/福岡 に載らない・宮城県や白石市には載る", () => {
        expect(photoIsInLocation(ZAO, "福岡")).toBe(false);
        expect(photoIsInLocation(ZAO, "宮城県")).toBe(true);
        expect(photoIsInLocation(ZAO, "白石市")).toBe(true);
        expect(photoIsInLocation(ZAO, "蔵王キツネ村")).toBe(true);
    });

    it("行政区分の字の前後なら名前として当てる", () => {
        expect(photoIsInLocation("東京都 渋谷区", "東京")).toBe(true);
        expect(photoIsInLocation("兵庫県神戸市", "神戸")).toBe(true);
        expect(photoIsInLocation("兵庫県神戸市", "兵庫県")).toBe(true);
        expect(photoIsInLocation("福岡県福岡市", "福岡")).toBe(true);
        expect(photoIsInLocation("宮崎県西臼杵郡", "宮崎県")).toBe(true);
    });

    it("別の地名の一部には当てない", () => {
        expect(photoIsInLocation("東京都", "京都")).toBe(false);
        expect(photoIsInLocation("大阪城公園", "大阪")).toBe(false);
    });

    it("括弧の中・語の並びでも当てる（これまでの一致を保つ）", () => {
        expect(photoIsInLocation("オペラ・ガルニエ（パリ）", "パリ")).toBe(true);
        expect(photoIsInLocation("香川県 観音寺市 高屋神社", "高屋神社")).toBe(true);
        expect(photoIsInLocation("オペラ座, パリ, フランス", "パリ, フランス")).toBe(true);
        expect(photoIsInLocation("パリ, ドイツ, フランス", "パリ, フランス")).toBe(false);
    });

    it("写真ページの「この場所の写真」（sameLocation）も同じ規則", () => {
        expect(sameLocation(ZAO, "福岡")).toBe(false);
        expect(sameLocation("福岡", ZAO)).toBe(false);
        expect(sameLocation("パリ, フランス", "パリ")).toBe(true);
    });
});

