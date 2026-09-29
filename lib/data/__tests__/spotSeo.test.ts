import { describe, it, expect } from "vitest";
import { SPOTS, type Spot } from "../spots";
import { spotAreaOf } from "../spotLink";
import { spotBreadcrumb, spotStructuredData, sameAreaSpots, sameAreaLabel, spotPageUrl } from "../spotSeo";
import { isPublished } from "../../utils/spotGuide";
import { siteConfig } from "../../utils/seo";

/**
 * 公式撮影地ガイドを検索に読ませる形（構造化データ・パンくず・同じ県の導線）。
 * 本物の台帳（`content/spots.json`）で確かめる——作り物だと、公開の門
 * （`publishBlockers`）を通る行を作る手間で肝心の判断がぼやける。
 */

const bySlug = (slug: string): Spot => {
    const s = SPOTS.find((x) => x.slug === slug);
    if (!s) throw new Error(`台帳に ${slug} が無い（テストの前提が崩れた）`);
    return s;
};

const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const rad = Math.PI / 180;
    const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2
        + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
};

describe("spotStructuredData", () => {
    it("観光地として名前・URL・画像・住所を書く（座標は書かない）", () => {
        const ginzan = bySlug("ginzan-onsen");
        const data = spotStructuredData(ginzan, { image: "https://example.com/a.jpg" });
        expect(data["@type"]).toBe("TouristAttraction");
        expect(data.name).toBe(ginzan.name);
        expect(data.url).toBe(`${siteConfig.url}/spots/ginzan-onsen`);
        expect(data.image).toBe("https://example.com/a.jpg");
        // 座標は約1km に丸めてあるので書かない（画面も「位置はおおよそ」と断っている）
        expect(data).not.toHaveProperty("geo");
        expect(data.address).toMatchObject({ "@type": "PostalAddress", addressCountry: "JP", addressRegion: "山形県" });
    });

    it("台帳に無い項目は書かない（空で出さない）", () => {
        const bare = { ...bySlug("ginzan-onsen"), summary: undefined, nameEn: undefined, coords: undefined, region: undefined };
        const data = spotStructuredData(bare);
        for (const key of ["description", "alternateName", "image", "address"]) {
            expect(data, key).not.toHaveProperty(key);
        }
    });

    it("海外は国名を書く（国しか無い行でも住所が空にならない）", () => {
        const v = bySlug("chateau-de-versailles");
        expect(spotStructuredData(v).address).toMatchObject({ addressCountry: v.region!.country });
        const countryOnly = { ...v, region: { country: v.region!.country } };
        expect(spotStructuredData(countryOnly).address).toEqual({ "@type": "PostalAddress", addressCountry: v.region!.country });
    });
});

describe("spotBreadcrumb", () => {
    it("ホーム ＞ 撮影スポット ＞ 県 ＞ スポット", () => {
        const ginzan = bySlug("ginzan-onsen");
        const crumbs = spotBreadcrumb(ginzan, spotAreaOf(ginzan));
        expect(crumbs.map((c) => c.name)).toEqual(["ホーム", "撮影スポット", "山形県", ginzan.name]);
        expect(crumbs[2].url).toBe(`${siteConfig.url}/spots/area/yamagata`);
        expect(crumbs[3].url).toBe(spotPageUrl(ginzan));
    });

    it("県が引けなければ県の段を飛ばす（在らないページを指さない）", () => {
        const ginzan = bySlug("ginzan-onsen");
        expect(spotBreadcrumb(ginzan, null).map((c) => c.name)).toEqual(["ホーム", "撮影スポット", ginzan.name]);
    });
});

describe("sameAreaSpots", () => {
    it("同じ県の、人が確かめたほかのスポットを近い順に6件まで", () => {
        const ginzan = bySlug("ginzan-onsen");
        const list = sameAreaSpots(ginzan);
        expect(list.length).toBeGreaterThan(0);
        expect(list.length).toBeLessThanOrEqual(6);
        const spots = list.map((x) => bySlug(x.slug));
        expect(spots.every((s) => s.region?.prefecture === "山形県")).toBe(true);
        expect(spots.every(isPublished)).toBe(true);
        expect(spots.some((s) => s.spotId === ginzan.spotId)).toBe(false);
        const d = spots.map((s) => km(ginzan.coords!, s.coords!));
        expect(d).toEqual([...d].sort((a, b) => a - b));
        // 画面の「約◯km」に使う距離を一緒に返す（並べた距離と同じ値）
        list.forEach((x, i) => expect(x.km, x.slug).toBeCloseTo(d[i], 6));
    });

    it("近い順に選ぶ（名前の順ではない）: 選ばれなかった同じ県のスポットは、選んだどれより遠い", () => {
        const ginzan = bySlug("ginzan-onsen");
        const chosen = new Set(sameAreaSpots(ginzan).map((x) => x.slug));
        const farthest = Math.max(...[...chosen].map((slug) => km(ginzan.coords!, bySlug(slug).coords!)));
        const picked = new Set(ginzan.nearbySpotIds ?? []);
        const rest = SPOTS.filter((s) => isPublished(s) && s.region?.prefecture === "山形県"
            && s.spotId !== ginzan.spotId && !picked.has(s.spotId) && !chosen.has(s.slug) && s.coords);
        for (const s of rest) expect(km(ginzan.coords!, s.coords!)).toBeGreaterThanOrEqual(farthest);
    });

    it("手で選んだ近くのスポットとは重ねない", () => {
        const ginzan = bySlug("ginzan-onsen");
        const first = sameAreaSpots(ginzan)[0];
        const withPick = { ...ginzan, nearbySpotIds: [bySlug(first.slug).spotId] };
        expect(sameAreaSpots(withPick).map((x) => x.slug)).not.toContain(first.slug);
    });

    it("海外は同じ国だけ（海外の区画は1つにまとまっているため）", () => {
        const v = bySlug("chateau-de-versailles");
        const spots = sameAreaSpots(v, SPOTS, 1000).map((x) => bySlug(x.slug));
        expect(spots.length).toBeGreaterThan(0);
        expect(spots.every((s) => s.region?.country === v.region!.country)).toBe(true);
    });
});

describe("sameAreaLabel", () => {
    it("国内は県名・海外は国名", () => {
        const ginzan = bySlug("ginzan-onsen");
        const v = bySlug("chateau-de-versailles");
        expect(sameAreaLabel(ginzan, spotAreaOf(ginzan))).toBe("山形県");
        expect(sameAreaLabel(v, spotAreaOf(v))).toBe(v.region!.country);
        expect(spotAreaOf(v)?.slug).toBe("overseas");
    });
});
