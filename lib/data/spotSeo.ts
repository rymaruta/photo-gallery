// lib/data/spotSeo.ts
//
// **公式撮影地ガイド（`/spots/<slug>`）を検索に読ませるための形。**
//
// - 構造化データ（JSON-LD）: 観光地（`TouristAttraction`）とパンくず（`BreadcrumbList`）
// - 同じ県のほかのスポット（ページどうしをつなぐ内部リンク）
//
// 台帳（`SPOTS`）を読むので**サーバー側だけで呼ぶ**（`spotLink.ts` の冒頭と同じ理由）。

import { SPOTS, type Spot } from "./spots";
import { spotAreaOf, sameAreaAs, type SpotAreaRef } from "./spotLink";
import { visibleSpots, isPublished } from "../utils/spotGuide";
import { siteConfig } from "../utils/seo";
import { ROUTES } from "../routes";

/** スポットのページの URL（canonical と同じ形） */
export function spotPageUrl(spot: Pick<Spot, "slug">): string {
    return `${siteConfig.url}/spots/${spot.slug}`;
}

/**
 * パンくず: ホーム ＞ 撮影スポット ＞ 県 ＞ スポット。
 * **区画が引けないときは県を飛ばす**（在らないページを指さない）
 */
export function spotBreadcrumb(spot: Spot, area: SpotAreaRef | null): Array<{ name: string; url: string }> {
    return [
        { name: "ホーム", url: siteConfig.url },
        { name: "撮影スポット", url: `${siteConfig.url}${ROUTES.SPOTS}` },
        ...(area ? [{ name: area.name, url: `${siteConfig.url}${ROUTES.SPOT_AREA(area.slug)}` }] : []),
        { name: spot.name, url: spotPageUrl(spot) },
    ];
}

/** 国名を住所の `addressCountry` に。**日本だけ ISO の JP**（ほかは台帳の表記のまま） */
function countryOf(spot: Spot): string | undefined {
    const c = spot.region?.country;
    if (!c) return undefined;
    return c === "日本" ? "JP" : c;
}

/**
 * 観光地の構造化データ。**台帳に在る項目だけ書く**（無い項目を空で出さない）。
 *
 * - 座標は台帳の値（約1km に丸めてある）。地点を名乗るのには足りる
 * - 画像は**表に出せる代表写真があるときだけ**（`generateMetadata` の OGP と同じ判断）
 */
export function spotStructuredData(spot: Spot, opts: { image?: string } = {}) {
    const region = spot.region;
    const address = (region?.prefecture || region?.city || region?.country)
        ? {
            "@type": "PostalAddress",
            ...(countryOf(spot) ? { addressCountry: countryOf(spot) } : {}),
            ...(region?.prefecture ? { addressRegion: region.prefecture } : {}),
            ...(region?.city ? { addressLocality: region.city } : {}),
        }
        : undefined;
    return {
        "@context": "https://schema.org",
        "@type": "TouristAttraction",
        name: spot.name,
        ...(spot.nameEn ? { alternateName: spot.nameEn } : {}),
        ...(spot.summary ? { description: spot.summary } : {}),
        url: spotPageUrl(spot),
        ...(opts.image ? { image: opts.image } : {}),
        ...(spot.coords
            ? { geo: { "@type": "GeoCoordinates", latitude: spot.coords.lat, longitude: spot.coords.lng } }
            : {}),
        ...(address ? { address } : {}),
    };
}

/** 2点間の距離（km）。並べる順に使うだけなので球面の近似で足りる */
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type SameAreaSpot = { slug: string; name: string; region?: string };

/**
 * **同じ県（海外は同じ国）のほかのスポット。** 近い順に `limit` 件。
 *
 * 「近くの撮影スポット」（手で選んだ `nearbySpotIds`）とは**別の節**で、関係があるとは
 * 名乗らない——見出しは「◯◯の撮影スポット」。座標が近い＝関係がある、とは限らない
 * （`SpotGuidePage` の注記）ので、手で選んだ節の代わりにはしない。
 *
 * - **人が確かめたもの（`published`）だけ**を指す（下書きへ検索の導線を張らない）
 * - 手で選んだ近くのスポットと重ねない
 * - 座標の無いものは最後に、名前の順で
 */
export function sameAreaSpots(spot: Spot, spots: readonly Spot[] = SPOTS, limit = 6): SameAreaSpot[] {
    const handPicked = new Set(spot.nearbySpotIds ?? []);
    const here = spot.coords;
    return visibleSpots(spots)
        .filter((s) => isPublished(s) && s.spotId !== spot.spotId && !handPicked.has(s.spotId)
            && sameAreaAs(spot, s))
        .map((s) => ({ s, d: here && s.coords ? distanceKm(here, s.coords) : Number.POSITIVE_INFINITY }))
        .sort((x, y) => x.d - y.d || x.s.name.localeCompare(y.s.name, "ja"))
        .slice(0, limit)
        .map(({ s }) => ({
            slug: s.slug,
            name: s.name,
            region: [s.region?.prefecture, s.region?.city].filter(Boolean).join(" ") || undefined,
        }));
}

/** 同じ県の節の見出しに使う名前。**海外は区画名（海外）ではなく国名** */
export function sameAreaLabel(spot: Spot, area: SpotAreaRef | null): string | null {
    if (!area) return null;
    return spot.region?.country && spot.region.country !== "日本" ? spot.region.country : area.name;
}

