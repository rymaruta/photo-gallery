import { describe, it, expect, vi } from "vitest";
import rawLedger from "../../content/spots.json";
import type { Spot } from "../../lib/data/spots";
import { buildSpotBodies, spotBodyJson, toSpotBody } from "../../lib/data/spotBody";
import * as route from "../app/data/spots/[file]/route";

/**
 * **アプリが撮影スポットの画面で読む本文（`/app/data/spots/<slug>.json`）の形を固定する。**
 *
 *   1. 下書きは作らない（確かめていない文をアプリに出さない）
 *   2. 確かめた印を必ず運ぶ——人の確認か、AI 照合の出典と日付（Web の出し分けと同じ）
 *   3. 運ぶ鍵を固定する（人名・製品名・確認者の要る項目を運ばない）
 *   4. 実際の台帳で、公開済みの全件にファイルができる
 */
const ledger = vi.hoisted(() => ({ spots: [] as unknown[] }));
vi.mock("../../lib/data/spots", () => ({ get SPOTS() { return ledger.spots; } }));

function spot(slug: string, over: Partial<Spot> = {}): Spot {
    return {
        spotId: `sp_${slug.padEnd(12, "0").slice(0, 12)}`,
        slug, name: slug, summary: "あ".repeat(40),
        description: "長い説明", highlights: ["見どころ"],
        seasonalGuide: [{ season: "autumn", text: "秋" }],
        timeOfDayGuide: [{ time: "night", text: "夜" }],
        compositionTips: ["構図"],
        region: { country: "日本", prefecture: "京都府", city: "京都市" },
        coords: { lat: 35.03, lng: 135.72 },
        officialWebsiteUrl: "https://example.example/",
        status: "review", draftedAt: "2026-09-24", draftedBy: "claude",
        sources: [{ field: "access", url: "https://example.example/a", checkedAt: "2026-09-24" }],
        createdAt: "2026-09-24T00:00:00.000Z", updatedAt: "2026-09-24T00:00:00.000Z",
        ...over,
    } as Spot;
}

const HUMAN = { status: "published" as const, verifiedBy: "運営", verifiedAt: "2026-09-25" };
const AI = {
    status: "published" as const,
    aiCheck: { checkedAt: "2026-09-26", delegatedBy: "rymaruta", sources: [{ url: "https://ja.wikipedia.org/wiki/x", title: "Wikipedia「x」" }] },
};
const ALLOWED = ["spotId", "slug", "description", "highlights", "seasonalGuide", "timeOfDayGuide",
    "compositionTips", "officialWebsiteUrl", "check"];

describe("アプリ向けの本文", () => {
    it("下書きは作らない・公開の条件を満たさない行も作らない", () => {
        expect(toSpotBody(spot("draft"))).toBeUndefined();
        // published と書いてあっても、確かめた印が無ければ作らない（出典の無い本文を配らない）
        expect(toSpotBody(spot("nomark", { status: "published" }))).toBeUndefined();
        // 印はあっても、公開の条件（座標など）を満たさない行は作らない（画面にも出ない行）
        expect(toSpotBody(spot("nocoords", { ...HUMAN, coords: undefined }))).toBeUndefined();
    });

    it("人が確かめた行は確認日を、AI 照合の行は出典と日付を運ぶ", () => {
        expect(toSpotBody(spot("h", HUMAN))?.check).toEqual({ kind: "human", verifiedAt: "2026-09-25" });
        expect(toSpotBody(spot("a", AI))?.check).toEqual({
            kind: "ai", checkedAt: "2026-09-26", sources: [{ url: "https://ja.wikipedia.org/wiki/x", title: "Wikipedia「x」" }],
        });
    });

    it("運ぶ鍵が固定されている（人名・製品名・確認者の要る項目を運ばない）", () => {
        for (const body of [toSpotBody(spot("h", HUMAN))!, toSpotBody(spot("a", AI))!]) {
            expect(Object.keys(body).filter((k) => !ALLOWED.includes(k)), body.slug).toEqual([]);
            const json = JSON.stringify(body);
            for (const banned of ["draftedBy", "verifiedBy", "delegatedBy", "claude", "rymaruta", "access", "parking", "運営"]) {
                expect(json, `${banned} を運んでいる`).not.toContain(banned);
            }
        }
    });

    it("空の項目は鍵ごと出さない", () => {
        const body = toSpotBody(spot("e", { ...HUMAN, timeOfDayGuide: [], description: "  ",
            compositionTips: undefined }))!;
        expect(Object.keys(body).sort()).toEqual(["check", "highlights", "officialWebsiteUrl", "seasonalGuide", "slug", "spotId"]);
    });

    it("route は force-static・知らない名前は出さない・同じ文字列を JSON で返す", async () => {
        ledger.spots = [spot("h", HUMAN), spot("a", AI), spot("d")];
        expect(route.dynamic).toBe("force-static");
        expect(route.dynamicParams).toBe(false);
        expect(route.generateStaticParams()).toEqual([{ file: "h.json" }, { file: "a.json" }]);
        const res = await route.GET(new Request("https://x/"), { params: Promise.resolve({ file: "a.json" }) });
        expect(res.headers.get("Content-Type")).toContain("application/json");
        expect(await res.text()).toBe(spotBodyJson("a.json"));
        const draft = await route.GET(new Request("https://x/"), { params: Promise.resolve({ file: "d.json" }) });
        expect(draft.status).toBe(404);
        expect(spotBodyJson("a")).toBeUndefined();
    });
});

describe("実際の台帳で作った本文", () => {
    const ledgerSpots = rawLedger as unknown as Spot[];
    const bodies = buildSpotBodies(ledgerSpots);

    it("公開済みの全件にでき、どれも印を持つ", () => {
        const published = ledgerSpots.filter((s) => s.status === "published").map((s) => s.slug).sort();
        expect(bodies.map((b) => b.slug).sort()).toEqual(published);
        for (const b of bodies) {
            expect(["human", "ai"], b.slug).toContain(b.check.kind);
            if (b.check.kind === "ai") expect(b.check.sources.length, b.slug).toBeGreaterThan(0);
        }
    });

    it("1件の大きさが目安に収まり、`**` や製品名が無い", () => {
        for (const b of bodies) {
            const json = JSON.stringify(b);
            expect(Buffer.byteLength(json, "utf8"), b.slug).toBeLessThan(12_000);
            expect(json, b.slug).not.toContain("**");
            expect(json, b.slug).not.toContain("claude");
        }
    });
});
