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
// ビルド時の写真の一覧（スポットに結ばれた利用者の公開写真・2026-10-31 #432）
const store = vi.hoisted(() => ({ photos: [] as unknown[] }));
vi.mock("../../lib/server/photos", async (orig) => ({
    ...(await orig<typeof import("../../lib/server/photos")>()),
    loadAllPhotos: async () => store.photos,
}));
// 一覧の画面は見ない（ここで見るのは構造化データだけ）
vi.mock("../components/SpotAreaIndexClient", () => ({ default: () => <div data-testid="area-index" /> }));

import SpotIndexPage from "../spots/page";
import { generateMetadata as spotMetadata } from "../spots/[slug]/page";
import { siteConfig, SHARE_IMAGE } from "../../lib/utils/seo";

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

beforeEach(() => { ledger.spots = []; store.photos = []; });

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

    /** 2026-10-11: 説明の後半に座標から計算した要約（日の入りの方角・天の川の月）。OGP も同じ文 */
    it("説明の後半に、座標から計算した日の入りの方角と天の川の月を足す", async () => {
        const summary = `${"い".repeat(40)}。`;
        ledger.spots = [spot("sky", { summary })];
        const m = await meta("sky");
        // 台帳の座標（北緯34°・東経134°・香川県）。2026-10-22: 押す理由（ページに在るもの・計算の要約）を頭に、
        // 紹介文（Wikipedia 由来）は最後（`spotPageDescription`）
        // 写真が1枚も無いスポットなので「写真」と名乗らない
        expect(m.description).toBe("skyの撮影地ガイド。月ごとの日の出・日の入り・ゴールデンアワー。"
            + `日の入りは6月が西北西寄り、12月が西南西寄り。天の川の中心は2〜10月の夜。${summary}`);
        expect((m.openGraph as { description?: string }).description).toBe(m.description);
    });

    // 2026-10-31（#432）: 落とし先は正方形のアイコン（`siteConfig.ogImage`）だった——検索結果・共有カードで
    // 「写真ではなくアイコン」に見える。サイトの固定の代表画像（1200×630・大きいカード）にする
    it("代表写真も結ばれた写真も無いスポットは、サイトの固定の代表画像に落とす（大きいカード）", async () => {
        ledger.spots = [spot("nophoto")];
        const m = await meta("nophoto");
        const fallback = `${siteConfig.url}${SHARE_IMAGE.path}`;
        const og = m.openGraph as { images?: Array<{ url: string; width?: number; height?: number }> };
        expect(og.images?.map((i) => i.url), "OGP の画像が無い・アイコンのまま").toEqual([fallback]);
        expect([og.images?.[0].width, og.images?.[0].height]).toEqual([1200, 630]);
        const tw = m.twitter as { card?: string; images?: string[] };
        expect(tw.images).toEqual([fallback]);
        expect(tw.card).toBe("summary_large_image");
        expect(og.images?.map((i) => i.url)).not.toContain(`${siteConfig.url}${siteConfig.ogImage}`);
    });

    it("代表写真が無く、スポットに結ばれた公開写真があれば、その写真（新しい順の先頭）", async () => {
        ledger.spots = [spot("linked")];
        const id = spot("linked").spotId;
        store.photos = [
            { id: "a", src: "https://journey-photo.com/uploads/u1/a.jpg", published: true, spotId: id, createdAt: "2026-01-01T00:00:00Z", date: "2026-01-01" },
            { id: "b", src: "https://journey-photo.com/uploads/u1/b.jpg", published: true, spotId: id, createdAt: "2026-05-01T00:00:00Z", date: "2026-05-01", width: 1600, height: 1200 },
            // 別のスポットの写真は拾わない
            { id: "c", src: "https://journey-photo.com/uploads/u1/c.jpg", published: true, spotId: "sp_other000000", createdAt: "2026-10-01T00:00:00Z", date: "2026-10-01" },
        ];
        const m = await meta("linked");
        const og = m.openGraph as { images?: Array<{ url: string; width?: number }> };
        expect(og.images?.map((i) => i.url)).toEqual(["https://journey-photo.com/uploads/u1/b.jpg"]);
        expect(og.images?.[0].width).toBe(1600);
        expect((m.twitter as { images?: string[] }).images).toEqual(["https://journey-photo.com/uploads/u1/b.jpg"]);
    });

    it("非公開・公開範囲を絞った写真は、結ばれていても出さない", async () => {
        ledger.spots = [spot("private")];
        const id = spot("private").spotId;
        store.photos = [
            { id: "p", src: "https://journey-photo.com/uploads/u1/p.jpg", published: false, spotId: id, createdAt: "2026-05-01T00:00:00Z" },
            { id: "f", src: "https://journey-photo.com/uploads/u1/f.jpg", published: true, audience: "followers", spotId: id, createdAt: "2026-06-01T00:00:00Z" },
        ];
        const m = await meta("private");
        const og = m.openGraph as { images?: Array<{ url: string }> };
        expect(og.images?.map((i) => i.url)).toEqual([`${siteConfig.url}${SHARE_IMAGE.path}`]);
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
