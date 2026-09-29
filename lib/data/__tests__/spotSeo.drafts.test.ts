import { describe, it, expect, vi } from "vitest";

/**
 * 🔴 **下書きを建てる設定（`BUILD_DRAFT_SPOTS = true`）に戻しても、同じ県の導線は
 * 下書きを指さない。** いまの設定では下書きが手前（`visibleSpots`）で落ちるので、
 * `spotSeo.test.ts` だけでは `isPublished` の門を通らない——ここで設定を切り替えて見る
 */
vi.mock("../../utils/spotGuide", async (importOriginal) => {
    const real = await importOriginal<typeof import("../../utils/spotGuide")>();
    return {
        ...real,
        visibleSpots: (spots: Parameters<typeof real.visibleSpots>[0]) =>
            real.visibleSpots(spots, { includeDrafts: true }),
    };
});

const { SPOTS } = await import("../spots");
const { sameAreaSpots } = await import("../spotSeo");

describe("sameAreaSpots（下書きを建てる設定）", () => {
    it("下書き（review）は指さない", async () => {
        const { visibleSpots } = await import("../../utils/spotGuide");
        const lake = SPOTS.find((s) => s.slug === "lake-yamanaka")!;
        // 前提: この設定では山梨県の下書きが見える側にいる（いなければ試験が何も見ていない）
        const visibleDrafts = visibleSpots(SPOTS).filter((s) => s.status === "review" && s.region?.prefecture === "山梨県");
        expect(visibleDrafts.length).toBeGreaterThan(0);
        const slugs = new Set(sameAreaSpots(lake, SPOTS, 1000).map((x) => x.slug));
        for (const d of visibleDrafts) expect(slugs.has(d.slug), d.slug).toBe(false);
    });
});
