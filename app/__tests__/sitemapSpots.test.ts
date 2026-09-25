import { describe, it, expect, vi } from "vitest";
import sitemap from "../sitemap";
import { siteConfig } from "../../lib/utils/seo";
import { prefectureByName } from "../../lib/data/prefectures";
import type { Spot } from "../../lib/data/spots";

/**
 * 🔴 **運営未確認の下書き（`review`）をサイトマップに載せない。**
 *
 * 2026-09-24 の台帳は 1,417件が全部「確認済み」を名乗っていて、サイトマップ
 * 1,522本の 96% が誰も確かめていない AI の文章になるところだった。
 * 検索に載せるのは**人が確かめた行だけ**——個別ページも、県の一覧も、索引も。
 *
 * `sitemapIndexPages.test.ts` は実際の `photos.json` で「空回り」を見張って
 * いるので、台帳の差し替えはこのファイルに分ける（`vi.mock` はファイル全体に効く）。
 */
const ledger = vi.hoisted(() => ({ spots: [] as unknown[] }));
vi.mock("../../lib/data/spots", () => ({ get SPOTS() { return ledger.spots; } }));

/** 建てる条件を満たす1件。`status` と確認者だけを変えて使う */
function spot(slug: string, prefecture: string, over: Partial<Spot> = {}): Spot {
    return {
        spotId: `sp_${slug.padEnd(12, "0").slice(0, 12)}`,
        slug,
        name: slug,
        summary: "あ".repeat(40),
        region: { country: "日本", prefecture },
        coords: { lat: 35, lng: 135 },
        highlights: ["見どころ"],
        officialWebsiteUrl: "https://example.example/",
        status: "review",
        draftedAt: "2026-09-24",
        createdAt: "2026-09-24T00:00:00.000Z",
        updatedAt: "2026-09-24T00:00:00.000Z",
        ...over,
    };
}

const verified = { status: "published" as const, verifiedBy: "運営", verifiedAt: "2026-09-25" };

describe("サイトマップ: 撮影スポットは人が確かめた行だけ", () => {
    it("下書きの個別ページ・下書きしか無い県・確認1件の県は載らない", async () => {
        ledger.spots = [
            spot("kagawa-a", "香川県"),
            spot("kagawa-b", "香川県"),
            spot("kagawa-c", "香川県"),
            spot("hokkaido-a", "北海道", verified),
            spot("hokkaido-b", "北海道", verified),
            spot("tokyo-a", "東京都", verified),
            spot("tokyo-b", "東京都"),
        ];
        const urls = new Set((await sitemap()).map((e) => e.url));
        const base = siteConfig.url;

        const spotUrls = [...urls].filter((u) => u.startsWith(`${base}/spots/`) && !u.includes("/spots/area/"));
        expect(spotUrls.sort()).toEqual([
            `${base}/spots/hokkaido-a`, `${base}/spots/hokkaido-b`, `${base}/spots/tokyo-a`,
        ]);

        const area = (name: string) => `${base}/spots/area/${prefectureByName(name)?.slug}`;
        expect(urls.has(area("北海道")), "確認2件の県は載る").toBe(true);
        expect(urls.has(area("香川県")), "下書き3件だけの県が載っている").toBe(false);
        expect(urls.has(area("東京都")), "確認1件（＋下書き1件）の県が載っている").toBe(false);
        // 索引は確認済みが3件以上あるので載る
        expect(urls.has(`${base}/spots`)).toBe(true);
    });

    it("全件が下書きなら、/spots も県の一覧も個別ページも1本も載らない", async () => {
        ledger.spots = [spot("a", "香川県"), spot("b", "香川県"), spot("c", "北海道")];
        const urls = [...new Set((await sitemap()).map((e) => e.url))];
        expect(urls.filter((u) => u.includes("/spots"))).toEqual([]);
    });
});
