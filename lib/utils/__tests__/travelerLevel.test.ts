import { describe, it, expect } from "vitest";
import type { Photo } from "../../data/photos";
import { computeTravelerStats, travelerScore, travelerLevel, earnedBadges } from "../travelerLevel";

function p(over: Partial<Photo> & { id: string }): Photo {
    return { src: `https://cdn/${over.id}.jpg`, ...over } as Photo;
}

describe("computeTravelerStats", () => {
    it("likes / movedCount を合計し、ユニークな場所を数える", () => {
        const photos = [
            p({ id: "a", likes: 5, movedCount: 2, location: "北海道" }),
            p({ id: "b", likes: 3, movedCount: 0, location: "北海道" }),
            p({ id: "c", likes: 10, movedCount: 1, location: "沖縄" }),
        ];
        const s = computeTravelerStats(photos);
        expect(s.postCount).toBe(3);
        expect(s.totalLikes).toBe(18);
        expect(s.totalMoved).toBe(3);
        expect(s.placeCount).toBe(2);
    });

    it("負値・非数の likes/moved は無視する", () => {
        const s = computeTravelerStats([p({ id: "a", likes: -5, movedCount: NaN as unknown as number })]);
        expect(s.totalLikes).toBe(0);
        expect(s.totalMoved).toBe(0);
    });

    it("coords つき写真から距離を積算する", () => {
        const s = computeTravelerStats([
            p({ id: "a", coords: { lat: 35, lng: 135 }, createdAt: "2026-01-01" }),
            p({ id: "b", coords: { lat: 36, lng: 136 }, createdAt: "2026-01-02" }),
        ]);
        expect(s.distanceKm).toBeGreaterThan(100);
        expect(s.distanceKm).toBeLessThan(200);
    });

    it("空配列でも壊れない", () => {
        expect(computeTravelerStats([])).toEqual({
            postCount: 0, totalLikes: 0, totalMoved: 0, distanceKm: 0, placeCount: 0, tripCount: 0,
        });
    });
});

describe("travelerScore", () => {
    it("moved を最重視する（同じ数なら moved の方がスコアが高い）", () => {
        const base = { postCount: 0, totalLikes: 0, totalMoved: 0, distanceKm: 0, placeCount: 0, tripCount: 0 };
        const movedScore = travelerScore({ ...base, totalMoved: 10 });
        const likeScore = travelerScore({ ...base, totalLikes: 10 });
        expect(movedScore).toBeGreaterThan(likeScore);
    });

    it("指標が増えるとスコアは単調に増える", () => {
        const a = travelerScore({ postCount: 1, totalLikes: 1, totalMoved: 1, distanceKm: 10, placeCount: 1, tripCount: 1 });
        const b = travelerScore({ postCount: 2, totalLikes: 2, totalMoved: 2, distanceKm: 20, placeCount: 2, tripCount: 2 });
        expect(b).toBeGreaterThan(a);
    });
});

describe("travelerLevel", () => {
    const empty = { postCount: 0, totalLikes: 0, totalMoved: 0, distanceKm: 0, placeCount: 0, tripCount: 0 };

    it("スコア0はLv.1", () => {
        const l = travelerLevel(empty);
        expect(l.level).toBe(1);
        expect(l.prevAt).toBe(0);
        expect(l.progress).toBeGreaterThanOrEqual(0);
    });

    it("スコアが上がるとレベルも上がる", () => {
        const high = travelerLevel({ ...empty, totalMoved: 100 });
        expect(high.level).toBeGreaterThan(1);
    });

    it("最高レベルは nextAt=null, progress=1", () => {
        const max = travelerLevel({ ...empty, totalMoved: 100000 });
        expect(max.nextAt).toBeNull();
        expect(max.progress).toBe(1);
    });

    it("progress は 0..1 に収まる", () => {
        const l = travelerLevel({ ...empty, totalMoved: 3 });
        expect(l.progress).toBeGreaterThanOrEqual(0);
        expect(l.progress).toBeLessThanOrEqual(1);
    });

    it("ロケールで称号が変わる", () => {
        expect(travelerLevel(empty, "ja").title).toBe("旅の記録者");
        expect(travelerLevel(empty, "en").title).toBe("Traveler");
    });
});

describe("earnedBadges", () => {
    const empty = { postCount: 0, totalLikes: 0, totalMoved: 0, distanceKm: 0, placeCount: 0, tripCount: 0 };

    it("しきい値未満はバッジなし", () => {
        expect(earnedBadges(empty)).toEqual([]);
    });

    it("各カテゴリで到達した最大段のみ返す", () => {
        const badges = earnedBadges({ ...empty, totalMoved: 25 });
        const moved = badges.filter((b) => b.key.startsWith("moved"));
        expect(moved.length).toBe(1);
        expect(moved[0].key).toBe("moved-20"); // 25 は 20 段（次は 50）
    });

    it("複数カテゴリのバッジが出る", () => {
        const badges = earnedBadges({ postCount: 30, totalLikes: 60, totalMoved: 5, distanceKm: 1500, placeCount: 12, tripCount: 0 });
        const keys = badges.map((b) => b.key.split("-")[0]).sort();
        expect(keys).toEqual(["distance", "likes", "moved", "places", "posts"]);
    });

    it("英語ラベル", () => {
        const badges = earnedBadges({ ...empty, totalMoved: 5 }, "en");
        expect(badges[0].label).toContain("Moved 5 to travel");
    });
});
