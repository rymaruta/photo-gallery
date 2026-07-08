import { describe, it, expect } from "vitest";
import { buildJourneyPoints } from "../journey";
import type { Photo } from "@/lib/data/photos";

function photo(id: string, lat: number, lng: number, date?: string, extra: Partial<Photo> = {}): Photo {
    return { id, src: `/p/${id}.jpg`, coords: { lat, lng }, date, ...extra } as unknown as Photo;
}

describe("buildJourneyPoints", () => {
    it("撮影日の昇順に並べる", () => {
        const pts = buildJourneyPoints([
            photo("c", 3, 3, "2026-03-01"),
            photo("a", 1, 1, "2026-01-01"),
            photo("b", 2, 2, "2026-02-01"),
        ]);
        expect(pts.map((p) => p.photo.id)).toEqual(["a", "b", "c"]);
    });

    it("date が無ければ createdAt を使う", () => {
        const pts = buildJourneyPoints([
            photo("late", 2, 2, undefined, { createdAt: "2026-06-01" } as Partial<Photo>),
            photo("early", 1, 1, undefined, { createdAt: "2026-01-01" } as Partial<Photo>),
        ]);
        expect(pts.map((p) => p.photo.id)).toEqual(["early", "late"]);
    });

    it("位置情報なし・非公開・日付不明は除外する", () => {
        const noCoords = { id: "x", src: "/x.jpg", date: "2026-01-01" } as unknown as Photo;
        const hidden = photo("h", 1, 1, "2026-01-02", { published: false } as Partial<Photo>);
        const noDate = photo("n", 2, 2, undefined);
        const ok = photo("ok", 3, 3, "2026-01-03");
        const pts = buildJourneyPoints([noCoords, hidden, noDate, ok]);
        expect(pts.map((p) => p.photo.id)).toEqual(["ok"]);
    });

    it("max を超える長旅は間引かれ、最初と最後は必ず残る", () => {
        const many = Array.from({ length: 100 }, (_, i) =>
            photo(`p${i}`, i, i, new Date(Date.UTC(2026, 0, 1 + i)).toISOString()),
        );
        const pts = buildJourneyPoints(many, 30);
        expect(pts.length).toBeLessThanOrEqual(30);
        expect(pts[0].photo.id).toBe("p0");
        expect(pts[pts.length - 1].photo.id).toBe("p99");
        // 順序は保たれる
        const times = pts.map((p) => p.t);
        expect([...times].sort((a, b) => a - b)).toEqual(times);
    });

    it("max 以下ならそのまま全件返す", () => {
        const five = Array.from({ length: 5 }, (_, i) => photo(`p${i}`, i, i, `2026-01-0${i + 1}`));
        expect(buildJourneyPoints(five, 30)).toHaveLength(5);
    });
});
