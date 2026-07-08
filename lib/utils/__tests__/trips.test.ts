import { describe, it, expect } from "vitest";
import { buildTrips } from "../trips";
import type { Photo } from "@/lib/data/photos";

function photo(id: string, date: string, extra: Partial<Photo> = {}): Photo {
    return { id, src: `/p/${id}.jpg`, date, ...extra } as unknown as Photo;
}

describe("buildTrips", () => {
    it("撮影日の間隔（既定3日超）で旅を分割する", () => {
        const trips = buildTrips([
            photo("a1", "2026-05-03"),
            photo("a2", "2026-05-04"),
            photo("a3", "2026-05-06"),
            photo("b1", "2026-05-20"), // 14日空く → 新しい旅
            photo("b2", "2026-05-21"),
        ]);
        expect(trips).toHaveLength(2);
        // 新しい旅から順
        expect(trips[0].photos.map((p) => p.id)).toEqual(["b1", "b2"]);
        expect(trips[1].photos.map((p) => p.id)).toEqual(["a1", "a2", "a3"]);
    });

    it("旅の中の写真は撮影日昇順", () => {
        const trips = buildTrips([
            photo("late", "2026-05-05"),
            photo("early", "2026-05-03"),
        ]);
        expect(trips[0].photos.map((p) => p.id)).toEqual(["early", "late"]);
        expect(trips[0].start).toBeLessThan(trips[0].end);
    });

    it("場所は登場頻度順に集計される", () => {
        const trips = buildTrips([
            photo("1", "2026-05-03", { location: "京都" }),
            photo("2", "2026-05-03", { location: "大阪" }),
            photo("3", "2026-05-04", { location: "京都" }),
        ]);
        expect(trips[0].places).toEqual(["京都", "大阪"]);
    });

    it("GPSつき写真から旅の移動距離を積算する", () => {
        const trips = buildTrips([
            photo("t", "2026-05-03", { coords: { lat: 35.68, lng: 139.76 } }),  // 東京
            photo("o", "2026-05-04", { coords: { lat: 34.69, lng: 135.5 } }),   // 大阪
        ]);
        // 東京–大阪はおよそ400km
        expect(trips[0].distanceKm).toBeGreaterThan(350);
        expect(trips[0].distanceKm).toBeLessThan(450);
    });

    it("日付の無い写真は対象外", () => {
        const noDate = { id: "x", src: "/x.jpg" } as unknown as Photo;
        const trips = buildTrips([noDate, photo("ok", "2026-05-03")]);
        expect(trips).toHaveLength(1);
        expect(trips[0].photos.map((p) => p.id)).toEqual(["ok"]);
    });

    it("date が無ければ createdAt でグルーピングする", () => {
        const trips = buildTrips([
            { id: "c", src: "/c.jpg", createdAt: "2026-06-01T10:00:00Z" } as unknown as Photo,
        ]);
        expect(trips).toHaveLength(1);
    });

    it("gapDays を変えると分割の粒度が変わる", () => {
        const photos = [photo("a", "2026-05-01"), photo("b", "2026-05-04")];
        expect(buildTrips(photos, 1)).toHaveLength(2);
        expect(buildTrips(photos, 5)).toHaveLength(1);
    });
});
