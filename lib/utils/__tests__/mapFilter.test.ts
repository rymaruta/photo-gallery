import { describe, it, expect } from "vitest";
import type { Photo } from "@/lib/data/photos";
import {
    matchesMapQuery,
    mapCategories,
    matchesMapCategory,
    filterMapPhotos,
    isInBounds,
    photosInBounds,
    sortByDistance,
} from "@/lib/utils/mapFilter";

const p = (id: string, extra: Partial<Photo> = {}): Photo => ({
    id, src: `https://cdn/${id}.jpg`, userId: "u1", published: true,
    createdAt: "2026-01-01T00:00:00.000Z", ...extra,
} as Photo);

describe("matchesMapQuery", () => {
    it("空の語は全部通す（絞り込みを始めていない状態）", () => {
        expect(matchesMapQuery(p("a", { location: "パリ" }), "")).toBe(true);
        expect(matchesMapQuery(p("a", { location: "パリ" }), "   ")).toBe(true);
    });

    it("撮影地に当たる", () => {
        expect(matchesMapQuery(p("a", { location: "パリ, フランス" }), "パリ")).toBe(true);
        expect(matchesMapQuery(p("a", { location: "パリ, フランス" }), "ベルリン")).toBe(false);
    });

    it("題にも当たる（ja / en のどちらでも）", () => {
        const photo = p("a", { title: { ja: "雲海", en: "Sea of clouds" } });
        expect(matchesMapQuery(photo, "雲海")).toBe(true);
        expect(matchesMapQuery(photo, "clouds")).toBe(true);
    });

    it("大文字小文字は区別しない", () => {
        expect(matchesMapQuery(p("a", { location: "Helsinki" }), "HELSINKI")).toBe(true);
    });

    // 集約ページの404救済は `/location/<スラッグ>` を検索に振り替える。
    // スラッグは空白がハイフンなので、生の includes だけだと必ず0件になる。
    it("ハイフンで繋いだスラッグでも当たる", () => {
        expect(matchesMapQuery(p("a", { location: "フランス ヴェルサイユ" }), "フランス-ヴェルサイユ")).toBe(true);
    });

    // `includes("")` は常に真。スラッグが空に落ちる語で全件一致にしない
    it("スラッグが空に落ちる語で全件一致にしない", () => {
        expect(matchesMapQuery(p("a", { location: "パリ" }), "###")).toBe(false);
        expect(matchesMapQuery(p("a", { location: "パリ" }), "-")).toBe(false);
    });

    // **説明・タグは当てない。** 地図の欄は場所を探す欄で、説明に地名が
    // 出てくるだけの写真を「そこで撮れる」と読ませない
    it("説明文やタグには当てない", () => {
        const photo = p("a", {
            location: "札幌",
            description: "パリで見た景色を思い出した",
            tags: ["paris"],
        });
        expect(matchesMapQuery(photo, "パリ")).toBe(false);
        expect(matchesMapQuery(photo, "paris")).toBe(false);
    });
});

describe("mapCategories", () => {
    it("多い順に返し、別名は同じスラッグに畳む", () => {
        const photos = [
            p("a", { category: "風景" }), p("b", { category: "landscape" }),
            p("c", { category: "建築" }), p("d", { category: "建物" }), p("e", { category: "建築" }),
        ];
        expect(mapCategories(photos)).toEqual([
            { slug: "architecture", count: 3 },
            { slug: "landscape", count: 2 },
        ]);
    });

    it("カテゴリの無い写真は数えない", () => {
        expect(mapCategories([p("a"), p("b", { category: "  " })])).toEqual([]);
    });

    it("同数なら slug の順（入力順で並びが変わらない）", () => {
        const a = mapCategories([p("1", { category: "nature" }), p("2", { category: "animal" })]);
        const b = mapCategories([p("1", { category: "animal" }), p("2", { category: "nature" })]);
        expect(a).toEqual(b);
        expect(a.map((c) => c.slug)).toEqual(["animal", "nature"]);
    });
});

describe("matchesMapCategory", () => {
    it("`all` と空は全部通す", () => {
        expect(matchesMapCategory(p("a", { category: "風景" }), "all")).toBe(true);
        expect(matchesMapCategory(p("a", { category: "風景" }), "")).toBe(true);
    });
    it("別名で保存された写真も同じチップで拾う", () => {
        expect(matchesMapCategory(p("a", { category: "建物" }), "architecture")).toBe(true);
        expect(matchesMapCategory(p("a", { category: "建築" }), "architecture")).toBe(true);
        expect(matchesMapCategory(p("a", { category: "風景" }), "architecture")).toBe(false);
    });
});

describe("filterMapPhotos", () => {
    it("語とチップの両方を通す（AND）", () => {
        const photos = [
            p("a", { location: "パリ", category: "建築" }),
            p("b", { location: "パリ", category: "風景" }),
            p("c", { location: "京都", category: "建築" }),
        ];
        expect(filterMapPhotos(photos, { query: "パリ", category: "architecture" }).map((x) => x.id))
            .toEqual(["a"]);
    });
    it("既定では何も落とさない", () => {
        const photos = [p("a"), p("b")];
        expect(filterMapPhotos(photos).map((x) => x.id)).toEqual(["a", "b"]);
    });
});

describe("isInBounds", () => {
    const b = { south: 35, west: 139, north: 36, east: 140 };
    it("中は真、外は偽", () => {
        expect(isInBounds({ lat: 35.5, lng: 139.5 }, b)).toBe(true);
        expect(isInBounds({ lat: 34.9, lng: 139.5 }, b)).toBe(false);
        expect(isInBounds({ lat: 35.5, lng: 141 }, b)).toBe(false);
    });
    it("辺の上は中に数える", () => {
        expect(isInBounds({ lat: 35, lng: 139 }, b)).toBe(true);
        expect(isInBounds({ lat: 36, lng: 140 }, b)).toBe(true);
    });
    // `worldCopyJump` で中心が ±180 を越えると west > east になる
    it("日付変更線をまたぐ範囲でも数えられる", () => {
        const across = { south: -10, west: 170, north: 10, east: -170 };
        expect(isInBounds({ lat: 0, lng: 179 }, across)).toBe(true);
        expect(isInBounds({ lat: 0, lng: -179 }, across)).toBe(true);
        expect(isInBounds({ lat: 0, lng: 0 }, across)).toBe(false);
    });
    it("南北が入れ替わって渡されても壊れない", () => {
        expect(isInBounds({ lat: 35.5, lng: 139.5 }, { south: 36, west: 139, north: 35, east: 140 })).toBe(true);
    });
    it("有限でない座標は外", () => {
        expect(isInBounds({ lat: NaN, lng: 139.5 }, b)).toBe(false);
    });
});

describe("photosInBounds", () => {
    const photos = [
        { id: "a", coords: { lat: 35.5, lng: 139.5 } },
        { id: "b", coords: { lat: 10, lng: 10 } },
    ];
    it("範囲が無ければ全部（「このエリアを検索」を押す前）", () => {
        expect(photosInBounds(photos, null).map((x) => x.id)).toEqual(["a", "b"]);
    });
    it("範囲の中だけ残す", () => {
        expect(photosInBounds(photos, { south: 35, west: 139, north: 36, east: 140 }).map((x) => x.id))
            .toEqual(["a"]);
    });
});

describe("sortByDistance", () => {
    it("近い順に並べ、km を添える", () => {
        const here = { lat: 35, lng: 139 };
        const out = sortByDistance([
            { id: "far", coords: { lat: 36, lng: 139 } },
            { id: "near", coords: { lat: 35.01, lng: 139 } },
        ], here);
        expect(out.map((x) => x.id)).toEqual(["near", "far"]);
        expect(out[0].km).toBeLessThan(2);
        expect(out[1].km).toBeGreaterThan(100);
    });
    it("元の配列を壊さない", () => {
        const input = [{ id: "a", coords: { lat: 1, lng: 1 } }];
        sortByDistance(input, { lat: 0, lng: 0 });
        expect(input).toEqual([{ id: "a", coords: { lat: 1, lng: 1 } }]);
    });
});
