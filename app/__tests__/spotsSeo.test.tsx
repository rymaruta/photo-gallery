import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { Spot } from "../../lib/data/spots";

/**
 * 撮影スポットの検索・共有まわり（2026-10-09）。
 *
 * 1. `/spots`（地域の索引）に一覧の構造化データ（ItemList）が無かった。
 *    画面に並ぶ地域のリンクと同じものを同じ順で載せる
 * 2. 代表写真の無いスポットのページは OGP の画像を1枚も申告せず、
 *    共有すると画像の無いプレビューになっていた。サイトの既定の画像に落とす
 */
const ledger = vi.hoisted(() => ({ spots: [] as unknown[] }));
vi.mock("../../lib/data/spots", () => ({ get SPOTS() { return ledger.spots; } }));
// 一覧の画面は見ない（ここで見るのは構造化データだけ）
vi.mock("../components/SpotAreaIndexClient", () => ({ default: () => <div data-testid="area-index" /> }));

import SpotIndexPage from "../spots/page";
import { generateMetadata as spotMetadata } from "../spots/[slug]/page";
import { siteConfig } from "../../lib/utils/seo";

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

function itemListOf(container: HTMLElement) {
    const blocks = [...container.querySelectorAll('script[type="application/ld+json"]')]
        .map((s) => JSON.parse(s.textContent ?? "{}"));
    return blocks.filter((b) => b["@type"] === "ItemList");
}

beforeEach(() => { ledger.spots = []; });

describe("/spots の一覧の構造化データ（ItemList）", () => {
    it("画面に並ぶ地域のリンクを、同じ順で1つの ItemList に載せる", async () => {
        ledger.spots = [
            spot("a"),
            spot("b", { region: { country: "日本", prefecture: "北海道" } }),
            spot("c", { region: { country: "フランス" } }),
        ];
        const { spotAreas } = await import("../../lib/data/spotLink");
        const areas = spotAreas();
        expect(areas.length).toBe(3);

        const { container } = render(SpotIndexPage());
        const lists = itemListOf(container);
        expect(lists, "ItemList が1つではない").toHaveLength(1);
        const list = lists[0];
        expect(list["@context"]).toBe("https://schema.org");
        expect(list.numberOfItems).toBe(3);
        expect(list.itemListElement.map((i: { position: number }) => i.position)).toEqual([1, 2, 3]);
        expect(list.itemListElement.map((i: { url: string }) => i.url))
            .toEqual(areas.map((a) => `${siteConfig.url}/spots/area/${encodeURIComponent(a.slug)}`));
        // 並びは画面と同じ（北海道 → 香川県 → 海外）
        expect(list.itemListElement.map((i: { name: string }) => i.name))
            .toEqual(["北海道の撮影スポット", "香川県の撮影スポット", `${areas[2].name}の撮影スポット`]);
        // 画面の本体も消えていない
        expect(container.querySelector('[data-testid="area-index"]')).toBeTruthy();
    });

    it("地域が0件なら ItemList を出さない（空の一覧を申告しない）", () => {
        const { container } = render(SpotIndexPage());
        expect(itemListOf(container)).toHaveLength(0);
    });

    it("`</script>` で閉じられない形で埋める", () => {
        ledger.spots = [spot("a")];
        const { container } = render(SpotIndexPage());
        const raw = container.querySelector('script[type="application/ld+json"]')!.innerHTML;
        expect(raw).not.toMatch(/[<>]/);
    });
});

describe("スポットのページの OGP 画像", () => {
    const meta = (slug: string) => spotMetadata({ params: Promise.resolve({ slug }) });

    it("代表写真が無いスポットは、サイトの既定の画像に落とす（小さいカード）", async () => {
        ledger.spots = [spot("nophoto")];
        const m = await meta("nophoto");
        const fallback = `${siteConfig.url}${siteConfig.ogImage}`;
        const og = m.openGraph as { images?: Array<{ url: string }> };
        expect(og.images?.map((i) => i.url), "OGP の画像が無い").toEqual([fallback]);
        const tw = m.twitter as { card?: string; images?: string[] };
        expect(tw.images).toEqual([fallback]);
        expect(tw.card).toBe("summary");
    });

    it("代表写真があるスポットは、今までどおりその写真（大きいカード）", async () => {
        ledger.spots = [spot("withphoto", {
            coverImage: {
                src: "/images/spots/withphoto.jpg", alt: "withphoto", credit: "運営", license: "owner",
                checkedAt: "2026-09-25", verifiedPlace: true,
            },
        })];
        const m = await meta("withphoto");
        const url = `${siteConfig.url}/images/spots/withphoto.jpg`;
        const og = m.openGraph as { images?: Array<{ url: string }> };
        expect(og.images?.map((i) => i.url)).toEqual([url]);
        const tw = m.twitter as { card?: string; images?: string[] };
        expect(tw.images).toEqual([url]);
        expect(tw.card).toBe("summary_large_image");
    });
});
