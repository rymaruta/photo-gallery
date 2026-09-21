import { describe, it, expect } from "vitest";
import type { Photo } from "../../data/photos";
import type { Spot } from "../../data/spots";
import {
    normalizeSpotName, spotById, spotBySlug, publishedSpots, searchSpotsByName,
    spotsInRegion, nearbySpots, photosForSpot, suggestSpotLinks,
} from "../spots";

const now = "2026-09-21T00:00:00.000Z";

function spot(over: Partial<Spot> & Pick<Spot, "spotId" | "slug" | "name">): Spot {
    return { createdAt: now, updatedAt: now, ...over };
}

const takaya = spot({
    spotId: "sp_0000000000a1", slug: "takaya-jinja", name: "高屋神社",
    aliases: ["天空の鳥居", "Takaya Shrine"],
    address: "香川県観音寺市高屋町2800",
    region: { country: "日本", prefecture: "香川県", city: "観音寺市" },
    coords: { lat: 34.14, lng: 133.68 }, category: "神社",
});
const hitachi = spot({
    spotId: "sp_0000000000b2", slug: "hitachi-seaside-park", name: "国営ひたち海浜公園",
    region: { country: "日本", prefecture: "茨城県", city: "ひたちなか市" },
    coords: { lat: 36.40, lng: 140.59 }, category: "公園",
});
const garnier = spot({
    spotId: "sp_0000000000c3", slug: "opera-garnier", name: "オペラ・ガルニエ",
    aliases: ["オペラ・ガルニエ（パリ）", "Palais Garnier"],
    region: { country: "フランス", city: "パリ" },
    coords: { lat: 48.87, lng: 2.33 }, category: "建築",
});
const draft = spot({ spotId: "sp_0000000000d4", slug: "shimo", name: "下書きの地点", status: "draft" });

const ALL = [takaya, hitachi, garnier, draft];

function photo(over: Partial<Photo> & Pick<Photo, "id">): Photo {
    return { src: `/uploads/${over.id}.jpg`, ...over } as Photo;
}

describe("normalizeSpotName", () => {
    it("括弧・空白・大文字小文字の揺れを畳む", () => {
        expect(normalizeSpotName("オペラ・ガルニエ（パリ）")).toBe(normalizeSpotName("オペラ・ガルニエ (パリ)"));
        expect(normalizeSpotName(" Takaya  Shrine ")).toBe("takayashrine");
    });
    it("中黒は残す（「オペラ・ガルニエ」と「オペラガルニエ」は別扱いにしない）", () => {
        // 記号を落としすぎると別の地点まで同じ綴りになる。落とすのは括弧と読点だけ
        expect(normalizeSpotName("オペラ・ガルニエ")).toContain("・");
    });
});

describe("引き当て", () => {
    it("ID で引ける / 無ければ undefined", () => {
        expect(spotById(ALL, "sp_0000000000b2")?.name).toBe("国営ひたち海浜公園");
        expect(spotById(ALL, "sp_none")).toBeUndefined();
        expect(spotById(ALL, undefined)).toBeUndefined();
    });
    it("slug で引ける（改名しても URL は動かない前提の鍵）", () => {
        expect(spotBySlug(ALL, "opera-garnier")?.spotId).toBe("sp_0000000000c3");
    });
    it("下書きは公開一覧に出ない", () => {
        expect(publishedSpots(ALL).map((s) => s.slug)).not.toContain("shimo");
        expect(publishedSpots(ALL)).toHaveLength(3);
    });
});

describe("searchSpotsByName", () => {
    it("別名でも見つかる", () => {
        expect(searchSpotsByName(ALL, "天空の鳥居").map((s) => s.spotId)).toEqual(["sp_0000000000a1"]);
        expect(searchSpotsByName(ALL, "Palais").map((s) => s.spotId)).toEqual(["sp_0000000000c3"]);
    });
    it("完全一致 → 前方一致 → 部分一致 の順に出す", () => {
        const spots = [
            spot({ spotId: "x1", slug: "a", name: "海浜公園前" }),           // 前方一致
            spot({ spotId: "x2", slug: "b", name: "国営ひたち海浜公園" }),     // 部分一致
            spot({ spotId: "x3", slug: "c", name: "海浜公園" }),             // 完全一致
        ];
        expect(searchSpotsByName(spots, "海浜公園").map((s) => s.spotId)).toEqual(["x3", "x1", "x2"]);
    });
    it("空の問いには何も返さない（全件を返さない）", () => {
        expect(searchSpotsByName(ALL, "   ")).toEqual([]);
    });
});

describe("spotsInRegion", () => {
    it("指定した階層だけを見る", () => {
        expect(spotsInRegion(ALL, { country: "日本" }).map((s) => s.spotId).sort())
            .toEqual(["sp_0000000000a1", "sp_0000000000b2"]);
        expect(spotsInRegion(ALL, { prefecture: "香川県" }).map((s) => s.spotId)).toEqual(["sp_0000000000a1"]);
    });
    it("指定が無ければ全件（絞らない）", () => {
        expect(spotsInRegion(ALL, {})).toHaveLength(4);
    });
});

describe("nearbySpots", () => {
    it("半径の中だけを近い順に返す", () => {
        const near = nearbySpots(ALL, { lat: 34.15, lng: 133.69 }, 5);
        expect(near.map((s) => s.spotId)).toEqual(["sp_0000000000a1"]);
    });
    it("遠い地点は入らない", () => {
        expect(nearbySpots(ALL, { lat: 36.40, lng: 140.59 }, 5).map((s) => s.spotId))
            .toEqual(["sp_0000000000b2"]);
    });
    it("座標を持たないスポットは数えない", () => {
        expect(nearbySpots([draft], { lat: 0, lng: 0 }, 20000)).toEqual([]);
    });
});

describe("photosForSpot", () => {
    const photos = [
        photo({ id: "p1", spotId: "sp_0000000000a1", createdAt: "2026-01-01" }),
        photo({ id: "p2", spotId: "sp_0000000000a1", createdAt: "2026-03-01" }),
        photo({ id: "p3", spotId: "sp_0000000000a1", createdAt: "2026-02-01", published: false }),
        photo({ id: "p4", location: "高屋神社", createdAt: "2026-04-01" }), // 名前は同じだが未紐づけ
    ];
    it("spotId で紐づいた公開写真だけを新しい順に返す", () => {
        expect(photosForSpot(photos, "sp_0000000000a1").map((p) => p.id)).toEqual(["p2", "p1"]);
    });
    it("撮影地の文字列が同じだけの写真は数えない（枚数の水増しをしない）", () => {
        expect(photosForSpot(photos, "sp_0000000000a1").map((p) => p.id)).not.toContain("p4");
    });
});

describe("suggestSpotLinks", () => {
    it("名前が1件だけ一致したら confirmed", () => {
        const s = suggestSpotLinks([photo({ id: "p1", location: "香川県 観音寺市 高屋神社" })], ALL);
        // 「香川県 観音寺市 高屋神社」は台帳の名前と綴りが違う＝一致しない
        expect(s[0].verdict).toBe("unmatched");

        const t = suggestSpotLinks([photo({ id: "p2", location: "高屋神社" })], ALL);
        expect(t[0]).toMatchObject({ verdict: "confirmed", spotId: "sp_0000000000a1" });
    });
    it("同じ名前が2件あれば ambiguous（機械が選ばない）", () => {
        const twins = [
            spot({ spotId: "t1", slug: "t1", name: "清水寺", region: { prefecture: "京都府" } }),
            spot({ spotId: "t2", slug: "t2", name: "清水寺", region: { prefecture: "兵庫県" } }),
        ];
        const s = suggestSpotLinks([photo({ id: "p1", location: "清水寺" })], twins);
        expect(s[0].verdict).toBe("ambiguous");
        expect(s[0].spotId).toBeUndefined();
    });
    it("名前が一致しても座標が200km以上離れていれば ambiguous", () => {
        const s = suggestSpotLinks(
            [photo({ id: "p1", location: "高屋神社", coords: { lat: 43.06, lng: 141.35 } })], ALL);
        expect(s[0].verdict).toBe("ambiguous");
        expect(s[0].reason).toContain("km 離れている");
    });
    it("被写体と撮影位置の差（数十km）では ambiguous にしない", () => {
        const fuji = [spot({ spotId: "f1", slug: "fuji", name: "富士山", coords: { lat: 35.36, lng: 138.73 } })];
        // 山中湖畔（約 15km 先）から撮った1枚
        const s = suggestSpotLinks([photo({ id: "p1", location: "富士山", coords: { lat: 35.42, lng: 138.87 } })], fuji);
        expect(s[0].verdict).toBe("confirmed");
    });
    it("座標が近いだけでは候補にしない（名前の一致が必須）", () => {
        const s = suggestSpotLinks([photo({ id: "p1", location: "観音寺市のどこか", coords: takaya.coords })], ALL);
        expect(s[0].verdict).toBe("unmatched");
    });
    it("既に紐づいた写真と、撮影地が空の写真は触らない", () => {
        const s = suggestSpotLinks([
            photo({ id: "p1", location: "高屋神社", spotId: "sp_0000000000a1" }),
            photo({ id: "p2" }),
        ], ALL);
        expect(s).toEqual([]);
    });
});
