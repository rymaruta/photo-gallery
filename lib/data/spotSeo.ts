// lib/data/spotSeo.ts
//
// **公式撮影地ガイド（`/spots/<slug>`）を検索に読ませるための形。**
//
// - 構造化データ（JSON-LD）: 観光地（`TouristAttraction`）とパンくず（`BreadcrumbList`）
// - 同じ県のほかのスポット（ページどうしをつなぐ内部リンク）
//
// 台帳（`SPOTS`）を読むので**サーバー側だけで呼ぶ**（`spotLink.ts` の冒頭と同じ理由）。

import { SPOTS, type Spot } from "./spots";
import { sameAreaAs, type SpotAreaRef } from "./spotLink";
import { visibleSpots, isPublished } from "../utils/spotGuide";
import { siteConfig } from "../utils/seo";
import { ROUTES } from "../routes";
import { haversineKm, kmForLabel } from "../utils/journey";
import { sampleImageObject, type SpotSample } from "./spotSamples";

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

/**
 * 住所の `addressCountry`。schema.org は ISO の2文字を**勧める**（国名の文字列も受ける）。
 * 日本は JP、海外は台帳の国名（日本語表記）をそのまま——コードの対応表は持っていないが、
 * 書かないと「イル・ド・フランス」だけの、どの国か分からない住所になる
 * （国しか無い行では住所そのものが空になる: pompeii・matterhorn など）
 */
function countryOf(spot: Spot): string | undefined {
    const c = spot.region?.country;
    if (!c) return undefined;
    return c === "日本" ? "JP" : c;
}

/**
 * 観光地の構造化データ。**台帳に在る項目だけ書く**（無い項目を空で出さない）。
 *
 * - **座標（`geo`）は書かない。** 台帳の座標は約1km に丸めてあり、画面も「位置はおおよそ」と
 *   断っている。構造化データに書くと、ずれたピンを正確な地点として渡すことになる（住所で足りる）
 * - 画像は**表に出せる代表写真があるときだけ**（`generateMetadata` の OGP と同じ判断）
 * - **作例（Wikimedia Commons）があれば `ImageObject` で足す**（2026-10-03）。作者（`creator`）・
 *   ライセンス（`license`）・出典（`acquireLicensePage`）・表示の文字（`creditText`）を必ず書く。
 *   作例があるときだけ `image` が配列になる（代表写真の URL が先頭）
 */
export function spotStructuredData(spot: Spot, opts: { image?: string; samples?: SpotSample[] } = {}) {
    const samples = (opts.samples ?? []).map(sampleImageObject);
    const image = samples.length > 0 ? [...(opts.image ? [opts.image] : []), ...samples] : opts.image;
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
        ...(image ? { image } : {}),
        ...(address ? { address } : {}),
    };
}

/** `km` はこのスポットからの距離（両方に座標があるときだけ・画面の「約◯km」） */
export type SameAreaSpot = { slug: string; name: string; region?: string; km?: number };

/** 一覧の1行の形（同じ県の一覧と、手で選んだ近くのスポットで共用） */
function toRow(s: Spot, here: Spot["coords"]): SameAreaSpot {
    return {
        slug: s.slug,
        name: s.name,
        region: [s.region?.prefecture, s.region?.city].filter(Boolean).join(" ") || undefined,
        ...(here && s.coords ? { km: kmForLabel(haversineKm(here, s.coords)) } : {}),
    };
}

/**
 * **手で選んだ「近くの撮影スポット」**（`nearbySpotIds` の順のまま）。
 * 画面に出してよいもの（`visibleSpots`）だけ。距離は両方に座標があるときだけ付く
 */
export function handPickedNearby(spot: Spot, spots: readonly Spot[] = SPOTS): SameAreaSpot[] {
    const shown = visibleSpots(spots);
    return (spot.nearbySpotIds ?? [])
        .map((id) => shown.find((s) => s.spotId === id))
        .filter((s): s is Spot => Boolean(s))
        .map((s) => toRow(s, spot.coords));
}

/**
 * 母集合ごとの「ページを建てられて公開済み」の行（`visibleSpots` ＋ `isPublished`）。
 * **配列ごとに1回だけ数える。** `sameAreaSpots` はページごと（＝全スポットぶん）呼ばれ、
 * 毎回 `publishBlockers` を全行に掛け直すと件数の2乗で遅くなる（2026-10-08: 約 2,700 行の
 * 公開でテストが 5 秒を超えた）。台帳の配列は作り直さないので、同じ配列なら結果も同じ
 */
const publishedVisibleCache = new WeakMap<readonly Spot[], Spot[]>();
function publishedVisibleOf(spots: readonly Spot[]): Spot[] {
    let rows = publishedVisibleCache.get(spots);
    if (!rows) {
        rows = visibleSpots(spots).filter(isPublished);
        publishedVisibleCache.set(spots, rows);
    }
    return rows;
}

/**
 * **同じ県（海外は同じ国）のほかのスポット。** 近い順に `limit` 件。
 *
 * 「近くの撮影スポット」（手で選んだ `nearbySpotIds`）とは**別の節**で、関係があるとは
 * 名乗らない——見出しは「◯◯の撮影スポット」。近い順に並べるのは owner の判断
 * （2026-09-29「近くのスポットを座標から自動で出す」を了承）。手で選んだ節は残し、重ねない。
 *
 * - **人が確かめたもの（`published`）だけ**を指す（下書きへ検索の導線を張らない）
 * - 手で選んだ近くのスポットと重ねない
 * - 座標の無いものは最後に、名前の順で
 */
export function sameAreaSpots(spot: Spot, spots: readonly Spot[] = SPOTS, limit = 6): SameAreaSpot[] {
    const handPicked = new Set(spot.nearbySpotIds ?? []);
    const here = spot.coords;
    return publishedVisibleOf(spots)
        .filter((s) => s.spotId !== spot.spotId && !handPicked.has(s.spotId)
            && sameAreaAs(spot, s))
        .map((s) => ({ s, d: here && s.coords ? haversineKm(here, s.coords) : Number.POSITIVE_INFINITY }))
        .sort((x, y) => x.d - y.d || x.s.name.localeCompare(y.s.name, "ja"))
        .slice(0, limit)
        .map(({ s }) => toRow(s, here));
}

/** 同じ県の節の見出しに使う名前。**海外は区画名（海外）ではなく国名** */
export function sameAreaLabel(spot: Spot, area: SpotAreaRef | null): string | null {
    if (!area) return null;
    return spot.region?.country && spot.region.country !== "日本" ? spot.region.country : area.name;
}

