import { describe, it, expect, vi } from "vitest";
import type { Spot } from "../../lib/data/spots";

/**
 * 🔴 **確かめた行しか無い県のページは「下書き」と名乗らない。**
 *
 * 県ページの題は「検索に出すか（公開済み2件以上）」の1本で分けていて、
 * 出さない側は一律「（下書き・N件）」「運営がまだ確認していない情報を含みます」
 * だった。下書きを建てなくなった（`BUILD_DRAFT_SPOTS = false`）ので、公開済み
 * 1件だけの県が全部この題になり、確かめた情報を「未確認」と名乗っていた。
 */
const ledger = vi.hoisted(() => ({ spots: [] as unknown[] }));
vi.mock("../../lib/data/spots", () => ({ get SPOTS() { return ledger.spots; } }));

import { generateMetadata } from "../spots/area/[area]/page";

function spot(slug: string, over: Partial<Spot> = {}): Spot {
    return {
        spotId: `sp_${slug.padEnd(12, "0").slice(0, 12)}`,
        slug,
        name: slug,
        summary: "あ".repeat(40),
        region: { country: "日本", prefecture: "香川県" },
        coords: { lat: 34, lng: 134 },
        highlights: ["見どころ"],
        officialWebsiteUrl: "https://example.example/",
        status: "published",
        verifiedBy: "運営",
        verifiedAt: "2026-09-25",
        createdAt: "2026-09-25T00:00:00.000Z",
        updatedAt: "2026-09-25T00:00:00.000Z",
        ...over,
    };
}

async function meta() {
    const { spotAreas } = await import("../../lib/data/spotLink");
    const area = spotAreas().find((a) => a.name === "香川県");
    expect(area, "香川県の県ページが無い").toBeTruthy();
    return generateMetadata({ params: Promise.resolve({ area: area!.slug }) });
}

describe("県ページの題と説明", () => {
    it("公開済み1件だけの県: 検索には出さないが、下書きとも名乗らない", async () => {
        ledger.spots = [spot("a")];
        const m = await meta();
        expect(m.title).toBe("香川県の撮影スポット（1件）");
        expect(String(m.description)).not.toContain("下書き");
        expect(String(m.description)).not.toContain("確認していない");
        expect(m.robots).toEqual({ index: false, follow: true });
    });

    it("公開済み2件の県: 「N選」で検索に出す", async () => {
        ledger.spots = [spot("a"), spot("b")];
        const m = await meta();
        expect(m.title).toBe("香川県の撮影スポット2選");
        expect(m.robots).toBeUndefined();
    });

    it("下書きは建てないので、下書きだけの県はページが無い", async () => {
        ledger.spots = [spot("a", { status: "review", verifiedBy: undefined, verifiedAt: undefined, draftedAt: "2026-09-24" })];
        const { spotAreas } = await import("../../lib/data/spotLink");
        expect(spotAreas().find((a) => a.name === "香川県")).toBeUndefined();
    });
});
