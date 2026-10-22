import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SPOTS, type Spot } from "../spots";
import { visibleSpots, isPublished } from "../../utils/spotGuide";
import { nearbySpotsForPhoto, PHOTO_NEARBY_SPOTS, PHOTO_NEARBY_SPOTS_KM } from "../spotSeo";
import { haversineKm } from "../../utils/journey";

/**
 * 写真ページの「近くの撮影スポット」（2026-10-22）。公開済みの撮影地ガイドを近い順に数件。
 * 🔴 距離は出さない（写真の座標から数件の距離を並べると、写真の場所を割り出せる）。
 */
const published = visibleSpots(SPOTS).filter(isPublished).filter((s) => s.coords);
// 近くに公開のスポットが多い1件（京都など）を基準にする
const himeji = published
    .map((s) => ({ s, n: published.filter((o) => haversineKm(s.coords!, o.coords!) <= 10).length }))
    .sort((a, b) => b.n - a.n)[0].s;

describe("nearbySpotsForPhoto", () => {
    it("写真の座標から近い順・公開済みだけ・件数と距離の上限を守る・距離は持たない", () => {
        const rows = nearbySpotsForPhoto({ coords: himeji.coords });
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.length).toBeLessThanOrEqual(PHOTO_NEARBY_SPOTS);
        const bySlug = new Map(published.map((s) => [s.slug, s] as const));
        const d = rows.map((r) => haversineKm(himeji.coords!, bySlug.get(r.slug)!.coords!));
        expect([...d].sort((a, b) => a - b)).toEqual(d);
        for (const x of d) expect(x).toBeLessThanOrEqual(PHOTO_NEARBY_SPOTS_KM);
        for (const r of rows) {
            expect(bySlug.has(r.slug), r.slug).toBe(true);
            expect("km" in r, `${r.slug} に距離が入っている`).toBe(false);
        }
    });

    it("写真が指すスポットはその座標を使い、自分は除く", () => {
        const rows = nearbySpotsForPhoto({ spotId: himeji.spotId, coords: { lat: 0, lng: 0 } });
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.map((r) => r.slug)).not.toContain(himeji.slug);
    });

    it("場所が分からない写真・遠すぎる写真には出さない", () => {
        expect(nearbySpotsForPhoto({})).toEqual([]);
        expect(nearbySpotsForPhoto({ coords: { lat: NaN, lng: 1 } })).toEqual([]);
        // 南極点（どのスポットからも 30km より遠い）
        expect(nearbySpotsForPhoto({ coords: { lat: -90, lng: 0 } })).toEqual([]);
    });

    it("下書きは出さない", () => {
        const draft: Spot = { ...himeji, spotId: "sp_draft000000", slug: "draft-x", status: "review", verifiedBy: undefined, aiCheck: undefined };
        const rows = nearbySpotsForPhoto({ coords: himeji.coords }, [...SPOTS, draft]);
        expect(rows.map((r) => r.slug)).not.toContain("draft-x");
    });

    it("写真ページは静的HTMLに焼くため、ページ（サーバー）で解いて渡す", () => {
        const src = readFileSync(join(__dirname, "../../../app/photo/[id]/page.tsx"), "utf8");
        expect(src).toMatch(/nearbySpots=\{photo \? nearbySpotsForPhoto\(photo\) : \[\]\}/);
        const client = readFileSync(join(__dirname, "../../../app/photo/[id]/PhotoPageClient.tsx"), "utf8");
        expect(client).toContain("<SpotRows rows={nearbySpots}");
    });
});
