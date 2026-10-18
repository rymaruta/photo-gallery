import { describe, it, expect } from "vitest";
import { coverCandidates, isCoverCandidate } from "../coverCandidates";

// カバーの候補（#304・板 50）。全体に公開している自分の写真だけ・いいねの多い順／最近・4枚
const row = (id: string, likes: number, createdAt: string, extra: Record<string, unknown> = {}) =>
    ({ id, src: `https://cdn.test/uploads/${id}.webp`, likes, createdAt, ...extra });

describe("coverCandidates", () => {
    const photos = [
        row("a", 3, "2026-10-01T00:00:00Z"),
        row("b", 10, "2026-09-01T00:00:00Z"),
        row("c", 10, "2026-10-05T00:00:00Z"),
        row("d", 0, "2026-10-10T00:00:00Z"),
        row("e", 1, "2026-10-12T00:00:00Z"),
        row("f", 50, "2026-10-13T00:00:00Z", { published: false }),
        row("g", 50, "2026-10-14T00:00:00Z", { audience: "followers" }),
        row("h", 50, "2026-10-15T00:00:00Z", { story: true }),
        { id: "i", likes: 99, createdAt: "2026-10-16T00:00:00Z" },
    ];

    it("いいねの多い順（同じ数なら新しい順）に4枚", () => {
        expect(coverCandidates(photos, "likes").map((p) => p.id)).toEqual(["c", "b", "a", "e"]);
    });

    it("最近（投稿の新しい順）に4枚", () => {
        expect(coverCandidates(photos, "recent").map((p) => p.id)).toEqual(["e", "d", "c", "a"]);
    });

    it("下書き・公開範囲を絞った写真・ストーリー・画像の無い行は出さない", () => {
        for (const id of ["f", "g", "h", "i"]) {
            expect(isCoverCandidate(photos.find((p) => p.id === id)!)).toBe(false);
        }
        expect(isCoverCandidate(row("x", 0, "", { audience: "" }))).toBe(true);
        expect(isCoverCandidate(row("y", 0, "", { audience: null }))).toBe(true);
    });

    it("元の並びを書き換えない", () => {
        const before = photos.map((p) => p.id);
        coverCandidates(photos, "likes");
        expect(photos.map((p) => p.id)).toEqual(before);
    });
});
