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

/**
 * **県の頁にもパンくずと ItemList**（2026-10-16・SEO）。切り口の頁（国・テーマ・季節）は持っていたのに、
 * 一番数の多い入口の県の頁（47頁）だけ構造化データが1つも無かった（実ビルドで数えた）。
 */
describe("県の頁の構造化データ", () => {
    it("パンくず（ホーム › 撮影スポット › 県）と、画面と同じ順のスポットの ItemList を埋める", async () => {
        ledger.spots = [spot("ritsurin-garden", { name: "栗林公園" }), spot("takaya-shrine", { name: "高屋神社" })];
        const { spotAreas } = await import("../../lib/data/spotLink");
        const area = spotAreas().find((a) => a.name === "香川県")!;
        const { default: SpotAreaPage } = await import("../spots/area/[area]/page");
        const el = await SpotAreaPage({ params: Promise.resolve({ area: area.slug }) });
        const kids = (el as { props: { children: unknown[] } }).props.children as Array<{ type?: unknown; props?: Record<string, unknown> }>;
        const scripts = kids.filter((k) => k && k.type === "script").map((k) =>
            JSON.parse(String((k.props!.dangerouslySetInnerHTML as { __html: string }).__html)));
        const crumb = scripts.find((d) => d["@type"] === "BreadcrumbList");
        const list = scripts.find((d) => d["@type"] === "ItemList");
        expect(crumb, "パンくずが無い").toBeTruthy();
        expect(crumb.itemListElement.map((x: { name: string }) => x.name)).toEqual(["ホーム", "撮影スポット", "香川県"]);
        expect(crumb.itemListElement.at(-1).item).toBe(`https://journey-photo.com/spots/area/${area.slug}`);
        expect(list, "ItemList が無い").toBeTruthy();
        expect(list.itemListElement.map((x: { name: string }) => x.name)).toEqual(["栗林公園", "高屋神社"]);
        expect(list.itemListElement[0].url).toBe("https://journey-photo.com/spots/ritsurin-garden");
        expect(list.numberOfItems).toBe(2);
    });
});

// 共有したときに県の頁・撮影スポットの入口だけ絵が無かった（子の openGraph が親の画像を消す・2026-10-16）
describe("県の頁と撮影スポットの入口の OGP の画像", () => {
    const cover: Spot["coverImage"] = {
        src: "/spots/ritsurin.jpg", alt: "栗林公園", credit: "運営", license: "owner", checkedAt: "2026-10-01", verifiedPlace: true,
    };

    it("県の頁: 代表写真を持つ先頭の行の写真を渡す", async () => {
        ledger.spots = [spot("takaya-shrine", { name: "高屋神社" }), spot("ritsurin-garden", { name: "栗林公園", coverImage: cover })];
        const m = await meta();
        const images = (m.openGraph as { images?: Array<{ url: string }> }).images;
        expect(images?.[0]?.url).toBe("https://journey-photo.com/spots/ritsurin.jpg");
    });

    it("撮影スポットの入口（/spots）も絵を渡す", async () => {
        ledger.spots = [spot("ritsurin-garden", { name: "栗林公園", coverImage: cover }), spot("takaya-shrine", { name: "高屋神社" })];
        const { generateMetadata: spotsMeta } = await import("../spots/page");
        const m = await spotsMeta();
        const images = (m.openGraph as { images?: Array<{ url: string }> }).images;
        expect(images?.[0]?.url).toBe("https://journey-photo.com/spots/ritsurin.jpg");
    });
});
