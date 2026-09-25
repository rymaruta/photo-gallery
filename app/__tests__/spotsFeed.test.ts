import { describe, it, expect, vi } from "vitest";
import rawLedger from "../../content/spots.json";
import type { Spot } from "../../lib/data/spots";
import { buildSpotFeed, spotIndexFeed, spotIndexFeedJson, toSpotFeedItem } from "../../lib/data/spotFeed";
import * as route from "../app/data/spots.json/route";

/**
 * **アプリが読む索引（`/app/data/spots.json`）の形を固定する。**
 *
 * iOS は鍵の集合を前提に読む（知らない鍵は無視・壊れた行は落とす）。
 * ここで固定するのは:
 *   1. 鍵の集合（重い項目・製品名・確認者を運ばない）
 *   2. `stage` と `draftedAt` が必ずある。`verifiedAt` は人が確かめた行だけ
 *   3. 実際の台帳で作った索引の大きさと、`**` が無いこと
 *   4. route が force-static で、CLI と同じ文字列を返す
 */
const ledger = vi.hoisted(() => ({ spots: [] as unknown[] }));
vi.mock("../../lib/data/spots", () => ({ get SPOTS() { return ledger.spots; } }));

function spot(slug: string, over: Partial<Spot> = {}): Spot {
    return {
        spotId: `sp_${slug.padEnd(12, "0").slice(0, 12)}`,
        slug,
        name: slug,
        nameEn: `${slug} en`,
        reading: "よみ",
        aliases: ["別名"],
        address: "住所",
        summary: "あ".repeat(40),
        description: "長い説明",
        highlights: ["見どころ"],
        seasonalGuide: [{ season: "spring", text: "春" }],
        compositionTips: ["構図"],
        region: { country: "日本", prefecture: "香川県", city: "観音寺市" },
        coords: { lat: 34.1, lng: 133.6 },
        category: "寺社",
        officialWebsiteUrl: "https://example.example/",
        status: "review",
        draftedAt: "2026-09-24",
        draftedBy: "claude",
        sources: [{ field: "access", url: "https://example.example/a", checkedAt: "2026-09-24" }],
        createdAt: "2026-09-24T00:00:00.000Z",
        updatedAt: "2026-09-24T00:00:00.000Z",
        ...over,
    };
}

const ALLOWED = ["spotId", "slug", "name", "nameEn", "reading", "region", "coords", "category", "summary", "stage", "draftedAt", "verifiedAt"];

describe("アプリ向けの索引", () => {
    it("鍵の集合が固定されている（重い項目・製品名・確認者を運ばない）", () => {
        ledger.spots = [
            spot("draft"),
            spot("verified", { status: "published", verifiedBy: "運営", verifiedAt: "2026-09-25", draftedAt: undefined }),
            spot("hidden", { status: "draft" }),
        ];
        const items = spotIndexFeed();
        expect(items.map((s) => s.slug)).toEqual(["draft", "verified"]);
        for (const item of items) {
            const extra = Object.keys(item).filter((k) => !ALLOWED.includes(k));
            expect(extra, `${item.slug} に余計な鍵`).toEqual([]);
        }
        const json = spotIndexFeedJson();
        for (const banned of ["draftedBy", "verifiedBy", "sources", "description", "highlights", "claude", "aliases", "address"]) {
            expect(json, `${banned} が索引に乗っている`).not.toContain(banned);
        }
    });

    it("stage と draftedAt は必ず、verifiedAt は人が確かめた行だけ", () => {
        ledger.spots = [
            spot("draft", { verifiedAt: "2026-09-24" }),
            spot("verified", { status: "published", verifiedBy: "運営", verifiedAt: "2026-09-25" }),
        ];
        const [draft, verified] = spotIndexFeed();
        expect(draft.stage).toBe("review");
        expect(draft.draftedAt).toBe("2026-09-24");
        expect("verifiedAt" in draft, "確認者の無い行の日付を運んでいる").toBe(false);
        expect(verified.stage).toBe("published");
        expect(verified.verifiedAt).toBe("2026-09-25");
        expect(verified.region).toEqual({ prefecture: "香川県", city: "観音寺市" });
    });

    it("undefined の鍵は出さない（`\"x\": null` を作らない）", () => {
        const item = toSpotFeedItem(spot("bare", { nameEn: undefined, reading: undefined, category: undefined, coords: undefined }));
        expect(Object.keys(item).sort()).toEqual(["draftedAt", "name", "region", "slug", "spotId", "stage", "summary"]);
    });

    it("route は force-static で、GET は同じ文字列を JSON として返す", async () => {
        ledger.spots = [spot("a"), spot("b")];
        expect(route.dynamic).toBe("force-static");
        const res = route.GET();
        expect(res.headers.get("Content-Type")).toContain("application/json");
        expect(await res.text()).toBe(spotIndexFeedJson());
        expect(JSON.parse(await route.GET().text())).toHaveLength(2);
    });
});

describe("実際の台帳で作った索引", () => {
    const items = buildSpotFeed(rawLedger as unknown as Spot[]);
    const json = JSON.stringify(items);

    it("全件が載り、stage と draftedAt を持つ", () => {
        expect(items.length).toBe((rawLedger as unknown[]).length);
        expect(items.every((s) => s.stage === "review" || s.stage === "published")).toBe(true);
        expect(items.every((s) => Boolean(s.draftedAt) || s.stage === "published")).toBe(true);
    });

    /** 目安は 850KB（minify・gzip 前）。超えたら項目か件数を見直す */
    it("大きさが目安に収まり、`**` が無い", () => {
        expect(json.length, `索引が ${json.length} バイト`).toBeLessThan(850_000);
        expect(json).not.toContain("**");
        expect(json).not.toContain("claude");
    });
});
