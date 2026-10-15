import { describe, it, expect } from "vitest";
import type { Photo } from "../../data/photos";
import { haversineKm } from "../journey";
import {
    routeCoordinates, connectKm, unwrapped, thinned, routeShape, deduplicated,
    arcControl, arcControls, firstYear, countriesInOrder, countriesLine, photoDayUtc,
} from "../travelRoute";
import { visitedCountryCount, countryIn } from "../visitedCountries";

// マイページの「旅の記録」の線（案 H1「星図」）。iOS の `TravelRouteTests.swift` と
// 同じ見張り——線と距離が同じ写真・同じ順でつながること、形の収め方。

const photo = (id: string, date: string | null, lat: number | null, lng: number | null, location?: string): Photo => ({
    id, src: `https://x/${id}.jpg`, title: id, category: "travel", tags: [],
    ...(date !== null ? { date } : {}),
    ...(lat !== null && lng !== null ? { coords: { lat, lng } } : {}),
    ...(location ? { location } : {}),
} as unknown as Photo);

describe("距離と線は同じ写真・同じ順", () => {
    it("🔴 日時の無い写真・座標の無い写真は入れない。距離は線の点をつないだ長さ", () => {
        const photos = [
            photo("c", "2026-05-03", 34.69, 135.50),
            photo("a", "2026-05-01", 35.68, 139.76),
            photo("nodate", null, 25.03, 121.56),
            photo("nocoords", "2026-05-02", null, null),
        ];
        const coords = routeCoordinates(photos);
        expect(coords).toEqual([{ lat: 35.68, lng: 139.76 }, { lat: 34.69, lng: 135.50 }]);
        expect(connectKm(coords)).toBeCloseTo(haversineKm(coords[0], coords[1]), 9);
    });

    it("🔴 閲覧者のタイムゾーンで順が変わらない（ゾーン無しの T 形式を Date に通さない）", () => {
        const photos = [
            photo("tokyo", "2024-11-01", 35.68, 139.77),
            photo("osaka", "2024-11-01T07:30:00", 34.69, 135.50),
            photo("sapporo", "2024-11-02", 43.06, 141.35),
        ];
        const before = process.env.TZ;
        try {
            process.env.TZ = "Asia/Tokyo";
            const jst = routeCoordinates(photos);
            process.env.TZ = "UTC";
            const utc = routeCoordinates(photos);
            expect(jst).toEqual(utc);
            // 日付だけの撮影日は、同じ日の時刻つきより先
            expect(jst.map((c) => c.lat)).toEqual([35.68, 34.69, 43.06]);
        } finally {
            if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
        }
    });
});

describe("形の収め方", () => {
    it("線は 0〜1 に収まり、古い順。北が上", () => {
        const shape = routeShape([
            { lat: 35.68, lng: 139.76 },  // 東京
            { lat: 25.03, lng: 121.56 },  // 台北
            { lat: 48.86, lng: 2.35 },    // パリ
        ])!;
        expect(shape).not.toBeNull();
        expect(shape.points).toHaveLength(3);
        for (const p of shape.points) {
            expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(1);
            expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(1);
        }
        expect(shape.points[0].x, "東京が一番東").toBeCloseTo(1, 9);
        expect(shape.points[2].x, "パリが一番西").toBeCloseTo(0, 9);
        expect(shape.points[2].y, "パリが一番北（上）").toBeCloseTo(0, 9);
        expect(shape.points[1].y, "台北が一番南（下）").toBeCloseTo(1, 9);
        // 経度 30° ごと（30・60・90・120）と緯度 10° ごと（30・40）
        expect(shape.meridians).toHaveLength(4);
        expect(shape.parallels).toHaveLength(2);
    });

    it("🔴 日付変更線をまたいでも、線が地球の裏を回らない（東京→ホノルル）", () => {
        const u = unwrapped([{ lat: 35.68, lng: 139.76 }, { lat: 21.31, lng: -157.86 }]);
        expect(u[1].lng).toBeCloseTo(202.14, 9);
    });

    it("1点だけ・点が無いときは線を出さない", () => {
        expect(routeShape([])).toBeNull();
        expect(routeShape([{ lat: 35, lng: 139 }])).toBeNull();
    });

    it("同じ町の中だけの線は、枠いっぱいに引き伸ばさない（大旅行に見せない）", () => {
        expect(routeShape([{ lat: 35.680, lng: 139.760 }, { lat: 35.690, lng: 139.770 }])).toBeNull();
        const shape = routeShape([{ lat: 35.0, lng: 139.0 }, { lat: 35.0, lng: 140.5 }]);
        expect(shape?.points).toHaveLength(2);
        expect(Math.abs((shape?.points[1].x ?? 0) - (shape?.points[0].x ?? 0)), "2° の幅の中に置く").toBeLessThan(0.8);
    });

    it("続けて同じ所の点は1つに。一番新しい点は残す", () => {
        const merged = deduplicated([{ x: 0, y: 0 }, { x: 0.001, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0.505, y: 0.5 }]);
        expect(merged).toEqual([{ x: 0, y: 0 }, { x: 0.505, y: 0.5 }]);
    });

    it("間引いても最初と最後の点は残る", () => {
        const many = Array.from({ length: 1000 }, (_, i) => i);
        const thin = thinned(many, 240);
        expect(thin).toHaveLength(240);
        expect(thin[0]).toBe(0);
        expect(thin[thin.length - 1]).toBe(999);
        expect(thinned([1, 2, 3], 240)).toEqual([1, 2, 3]);
    });
});

describe("弧", () => {
    const box = { width: 338, height: 52 };

    it("🔴 東へは上・西へは下へふくらむ。長いほど大きく、頂点は余白に収まる", () => {
        const east = arcControl({ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, box, 16);
        const west = arcControl({ x: 0.8, y: 0.5 }, { x: 0.2, y: 0.5 }, box, 16);
        expect(east.y, "東へは上").toBeLessThan(0.5);
        expect(west.y, "西へは下").toBeGreaterThan(0.5);
        expect(east.x).toBeCloseTo(0.5, 9);
        const short = arcControl({ x: 0.45, y: 0.5 }, { x: 0.55, y: 0.5 }, box, 16);
        expect(east.y, "長い区間ほど高い").toBeLessThan(short.y);
        const most = arcControl({ x: 0, y: 0 }, { x: 1, y: 0 }, box, 16, 9);
        // 頂点（曲げの点の半分の高さ）は余白の 16 まで
        expect(most.y * 52 / 2).toBeGreaterThanOrEqual(-16 - 1e-9);
    });

    it("🔴 同じ2か所を何度も行き来すると、回ごとに大きくふくらむ（束に潰れない）", () => {
        const jp = { x: 1, y: 0.9 }, eu = { x: 0, y: 0.4 };
        const controls = arcControls([jp, eu, jp, eu, jp], box, 16);
        expect(controls).toHaveLength(4);
        expect(controls[2].y, "西へ: 2回目はもっと下").toBeGreaterThan(controls[0].y);
        expect(controls[3].y, "東へ: 2回目はもっと上").toBeLessThan(controls[1].y);
    });
});

describe("国・地域と年", () => {
    it("国・地域は初めて訪れた順で、数は visitedCountryCount と同じ", () => {
        const photos = [
            photo("p", "2026-03-01", null, null, "パリ, フランス"),
            photo("t", "2026-01-01", null, null, "東京, 日本"),
            photo("f", "2026-02-01", null, null, "台北, 台湾"),
            photo("t2", "2026-04-01", null, null, "京都, 日本"),
        ];
        const names = countriesInOrder(photos);
        expect(names).toEqual(["日本", "台湾", "フランス"]);
        expect(names).toHaveLength(visitedCountryCount(photos));
        expect(names[0]).toBe(countryIn("東京, 日本"));
        expect(countriesLine(["日本", "台湾", "フランス"])).toBe("日本・台湾・フランス");
        expect(countriesLine(["a", "b", "c", "d", "e"]).endsWith(" ほか2")).toBe(true);
    });

    it("一番古い写真の年", () => {
        expect(firstYear([photo("b", "2025-06-01", 1, 1), photo("a", "2024-11-03", 2, 2)])).toBe(2024);
        expect(firstYear([photo("x", null, 1, 1)])).toBeNull();
    });

    it("🔴 年は UTC の暦日から（アプリの TripBook.day(of:in: utc)）。閲覧者の時計で年が変わらない", () => {
        // 撮影日の無い写真の投稿日時。ニューヨークの大晦日の夜は UTC では翌年の元日
        const ny = { ...photo("ny", null, 40.71, -74.0), createdAt: "2024-12-31T20:00:00-05:00" } as Photo;
        expect(photoDayUtc(ny)).toEqual({ y: 2025, m: 1, d: 1 });
        expect(firstYear([ny])).toBe(2025);
        const before = process.env.TZ;
        try {
            process.env.TZ = "America/New_York";
            expect(firstYear([ny])).toBe(2025);
        } finally {
            if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
        }
    });
});

describe("日付として読める写真だけ（アプリの TravelRoute.coordinates と同じ選び方）", () => {
    it("撮影日が暦の上に無い・読めない写真は、投稿日時で読む。どちらも読めなければ入れない", () => {
        const bad = photo("bad", "unknown", 25.03, 121.56);
        const badButCreated = { ...photo("bc", "2024-13-40", 43.06, 141.35), createdAt: "2024-11-05T01:00:00Z" } as Photo;
        expect(photoDayUtc(bad)).toBeNull();
        expect(photoDayUtc(badButCreated)).toEqual({ y: 2024, m: 11, d: 5 });
        const coords = routeCoordinates([photo("a", "2024-11-01", 35.68, 139.76), bad, badButCreated]);
        expect(coords.map((c) => c.lat)).toEqual([35.68, 43.06]);
    });

    it("読めない写真は「いちばん古い年」に数えない", () => {
        expect(firstYear([photo("bad", "unknown", 1, 1), photo("a", "2024-11-03", 2, 2)])).toBe(2024);
        expect(firstYear([photo("bad", "0000-00-00", 1, 1)])).toBeNull();
    });

    it("時刻帯の無い投稿日時は、日付だけ読む（閲覧者の時計で日が変わらない）", () => {
        const p = { ...photo("x", null, 1, 1), createdAt: "2024-12-31T23:30:00" } as Photo;
        expect(photoDayUtc(p)).toEqual({ y: 2024, m: 12, d: 31 });
    });
});
