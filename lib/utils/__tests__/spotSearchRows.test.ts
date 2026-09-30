import { describe, it, expect } from "vitest";
import { searchSpotRows, searchSpotsByName, type SpotSearchRow } from "../spots";
import { filterMapSpots } from "../mapFilter";
import type { Spot } from "../../data/spots";

/**
 * 「さがす」と地図が撮影スポットを語で引く規則（2026-09-30 のレビュー:
 * 「銀山温泉」で写真0件・ガイドが案内されない／地図はスポットを絞らない）。
 */
const ROWS: SpotSearchRow[] = [
    { s: "yamadera", n: "山寺", e: "Yamadera", r: "やまでら", a: ["立石寺"], g: "山形県 山形市" },
    { s: "ginzan-onsen", n: "銀山温泉", e: "Ginzan Onsen", r: "ぎんざんおんせん", a: ["銀山温泉街"], g: "山形県 尾花沢市" },
    { s: "ginzan-shrine", n: "石見銀山", r: "いわみぎんざん", g: "島根県 大田市" },
];

describe("searchSpotRows", () => {
    it("名前の完全一致が先頭、部分一致が後ろ", () => {
        expect(searchSpotRows(ROWS, "銀山温泉").map((r) => r.s)).toEqual(["ginzan-onsen"]);
        expect(searchSpotRows(ROWS, "銀山").map((r) => r.s)).toEqual(["ginzan-onsen", "ginzan-shrine"]);
    });

    it("読み・英語名・別名でも当たる（全角半角・大小・空白の揺れを落とす）", () => {
        expect(searchSpotRows(ROWS, "ぎんざんおんせん").map((r) => r.s)).toEqual(["ginzan-onsen"]);
        expect(searchSpotRows(ROWS, "ginzan onsen").map((r) => r.s)).toEqual(["ginzan-onsen"]);
        expect(searchSpotRows(ROWS, "ＹＡＭＡＤＥＲＡ").map((r) => r.s)).toEqual(["yamadera"]);
        expect(searchSpotRows(ROWS, "立石寺").map((r) => r.s)).toEqual(["yamadera"]);
    });

    it("地域だけで当たったものは、名前で当たったものの後ろ（同じ段は台帳の順）", () => {
        expect(searchSpotRows(ROWS, "山形").map((r) => r.s)).toEqual(["yamadera", "ginzan-onsen"]);
        const rows = [...ROWS, { s: "yamagata-castle", n: "山形城跡", g: "山形県 山形市" }];
        expect(searchSpotRows(rows, "山形")[0].s, "名前に「山形」を含む行が先").toBe("yamagata-castle");
    });

    it("空の語は何も当てない", () => {
        expect(searchSpotRows(ROWS, "")).toEqual([]);
        expect(searchSpotRows(ROWS, "   ")).toEqual([]);
    });

    it("既存の searchSpotsByName の並び（完全 → 前方 → 部分）は変わらない", () => {
        const spot = (slug: string, name: string, aliases?: string[]) => ({ slug, name, aliases } as Spot);
        const spots = [spot("b", "高屋神社"), spot("a", "たかや"), spot("c", "天空の鳥居", ["高屋神社の鳥居"])];
        expect(searchSpotsByName(spots, "高屋神社").map((s) => s.slug)).toEqual(["b", "c"]);
        expect(searchSpotsByName(spots, "たか").map((s) => s.slug)).toEqual(["a"]);
    });
});

describe("filterMapSpots", () => {
    const PINS = [
        { slug: "ginzan-onsen", name: "銀山温泉", region: "山形県 尾花沢市", lat: 38.58, lng: 140.53 },
        { slug: "takaya", name: "高屋神社", region: "香川県 観音寺市", lat: 34.1, lng: 133.6 },
    ];
    it("絞らなければ全部", () => {
        expect(filterMapSpots(PINS).map((p) => p.slug)).toEqual(["ginzan-onsen", "takaya"]);
    });
    it("語は名前と地域に当てる", () => {
        expect(filterMapSpots(PINS, { query: "銀山温泉" }).map((p) => p.slug)).toEqual(["ginzan-onsen"]);
        expect(filterMapSpots(PINS, { query: "香川" }).map((p) => p.slug)).toEqual(["takaya"]);
        expect(filterMapSpots(PINS, { query: "パリ" })).toEqual([]);
    });
    it("写真のカテゴリで絞っている間は出さない", () => {
        expect(filterMapSpots(PINS, { category: "風景" })).toEqual([]);
    });
    it("名前の索引で当たった綴りも残す（読み・英語名・別名）", () => {
        expect(filterMapSpots(PINS, { query: "ぎんざん", indexMatches: new Set(["ginzan-onsen"]) }).map((p) => p.slug)).toEqual(["ginzan-onsen"]);
        expect(filterMapSpots(PINS, { query: "ぎんざん" })).toEqual([]);
    });
    it("範囲の中だけ", () => {
        expect(filterMapSpots(PINS, { area: { south: 38, west: 140, north: 39, east: 141 } }).map((p) => p.slug)).toEqual(["ginzan-onsen"]);
    });
});
