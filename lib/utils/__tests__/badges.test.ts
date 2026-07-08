import { describe, it, expect } from "vitest";
import { computeBadges, type BadgeInput } from "../badges";

const zero: BadgeInput = { photoCount: 0, distanceKm: 0, places: 0, tripCount: 0, categories: 0, likes: 0 };

function ids(input: Partial<BadgeInput>): string[] {
    return computeBadges({ ...zero, ...input }).map((b) => b.id);
}

describe("computeBadges", () => {
    it("何も満たさなければ空", () => {
        expect(computeBadges(zero)).toEqual([]);
    });

    it("距離は閾値ちょうどで獲得できる", () => {
        expect(ids({ distanceKm: 99 })).toEqual([]);
        expect(ids({ distanceKm: 100 })).toEqual(["dist-100"]);
    });

    it("同じ系統では最上位の1つだけ", () => {
        expect(ids({ distanceKm: 12000 })).toEqual(["dist-10000"]);
        expect(ids({ photoCount: 150 })).toEqual(["photos-100"]);
    });

    it("複数の系統は併存する", () => {
        const earned = ids({ distanceKm: 1500, places: 6, photoCount: 12, tripCount: 3, categories: 3, likes: 15 });
        expect(earned).toEqual(["dist-1000", "places-5", "photos-10", "trips-3", "cat-3", "likes-10"]);
    });

    it("ラベルは日英両方を持つ", () => {
        const [b] = computeBadges({ ...zero, likes: 100 });
        expect(b.label.ja).toBeTruthy();
        expect(b.label.en).toBeTruthy();
        expect(b.detail.ja).toBeTruthy();
    });
});
