// lib/data/spotSeo.ts
//
// **公式撮影地ガイド（`/spots/<slug>`）を検索に読ませるための形。**
//
// - 構造化データ（JSON-LD）: 観光地（`TouristAttraction`）とパンくず（`BreadcrumbList`）
// - 同じ県のほかのスポット（ページどうしをつなぐ内部リンク）
//
// 台帳（`SPOTS`）を読むので**サーバー側だけで呼ぶ**（`spotLink.ts` の冒頭と同じ理由）。

import { SPOTS, type Spot } from "./spots";
import { sameAreaAs, type SpotAreaRef, type SpotArea } from "./spotLink";
import { visibleSpots, isPublished } from "../utils/spotGuide";
import { siteConfig, generateItemListStructuredData } from "../utils/seo";
import { ROUTES } from "../routes";
import { haversineKm, kmForLabel } from "../utils/journey";
import { sampleImageObject, type SpotSample, type coverImageObject } from "./spotSamples";

/**
 * `/spots`（地域の索引）の一覧の構造化データ（ItemList）。
 *
 * 画面に並べている**地域のリンク**（`/spots/area/<slug>`）と同じものを渡す——
 * 個々のスポットは画面に無いので載せない。並びは `spotAreas()` のまま
 * （県の順・海外が最後。画面の地方ごとのまとめと同じ順になる）。
 */
export function spotAreaItemList(areas: readonly Pick<SpotArea, "slug" | "name">[]) {
    return generateItemListStructuredData(
        "撮影スポットの地域",
        areas.map((a) => ({ name: `${a.name}の撮影スポット`, url: `${siteConfig.url}${ROUTES.SPOT_AREA(a.slug)}` })),
    );
}

/** スポットのページの URL（canonical と同じ形） */
export function spotPageUrl(spot: Pick<Spot, "slug">): string {
    return `${siteConfig.url}/spots/${spot.slug}`;
}

/**
 * パンくず: ホーム ＞ 撮影スポット ＞ 県 ＞ スポット。
 * **区画が引けないときは県を飛ばす**（在らないページを指さない）
 */
export function spotBreadcrumb(
    spot: Spot, area: SpotAreaRef | null, country: { name: string; href: string } | null = null,
): Array<{ name: string; url: string }> {
    return [
        { name: "ホーム", url: siteConfig.url },
        { name: "撮影スポット", url: `${siteConfig.url}${ROUTES.SPOTS}` },
        ...(area ? [{ name: area.name, url: `${siteConfig.url}${ROUTES.SPOT_AREA(area.slug)}` }] : []),
        // 海外は国の頁を間に入れる（`/spots/area/overseas` は国の一覧で、スポットは国の頁にある・2026-10-11）
        ...(country ? [{ name: country.name, url: `${siteConfig.url}${country.href}` }] : []),
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
export function spotStructuredData(
    spot: Spot,
    // 2026-10-11: 代表写真は作者・ライセンスつきの `ImageObject` でも渡せる（`coverImageObject`）
    // 2026-10-22: `lead` は検索に代表として渡す作例（`spotSeoImage` が作例を選んだとき）。代表写真より前に置く
    // ——代表写真が横 1,200px に届かず、届く作例があるとき、その1枚を先頭にする
    opts: { image?: string | ReturnType<typeof coverImageObject>; samples?: SpotSample[]; lead?: SpotSample } = {},
) {
    const all = opts.samples ?? [];
    const lead = opts.lead && all.includes(opts.lead) ? opts.lead : undefined;
    const samples = all.filter((s) => s !== lead).map(sampleImageObject);
    const cover = opts.image ? [opts.image] : [];
    const image = lead
        ? [sampleImageObject(lead), ...cover, ...samples]
        : samples.length > 0 ? [...cover, ...samples] : opts.image;
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

/** 写真ページの「近くの撮影スポット」に出す件数と、近いと呼ぶ距離（km） */
export const PHOTO_NEARBY_SPOTS = 4;
export const PHOTO_NEARBY_SPOTS_KM = 30;

/**
 * **写真ページの「近くの撮影スポット」**（2026-10-22）。写真の場所から近い順に、公開済みの撮影地ガイドを数件。
 *
 * - 基準の場所: 写真が撮影スポット（`spotId`）を指していればその座標、無ければ写真の座標
 *   （約1km に丸めた公開の値・地名から引いた推定 `geoApprox` を含む）。どちらも無ければ出さない
 * - **人が確かめたか AI 照合で公開したものだけ**（`publishedVisibleOf`）。写真が指すスポット自身は除く
 *   （そちらは写真の下の札で出ている）
 * - 🔴 **距離は出さない。** 写真の座標からの距離を並べると、数件の距離から写真の場所を細かく割り出せる。
 *   並びが近い順なだけで、行には名前と地域だけを出す
 */
export function nearbySpotsForPhoto(
    photo: { spotId?: string | null; coords?: { lat: number; lng: number } | null },
    spots: readonly Spot[] = SPOTS,
    limit = PHOTO_NEARBY_SPOTS,
    maxKm = PHOTO_NEARBY_SPOTS_KM,
): SameAreaSpot[] {
    const shown = publishedVisibleOf(spots);
    const own = photo.spotId ? visibleSpots(spots).find((s) => s.spotId === photo.spotId) : undefined;
    const here = own?.coords ?? photo.coords ?? null;
    if (!here || !Number.isFinite(here.lat) || !Number.isFinite(here.lng)) return [];
    return shown
        .filter((s) => s.coords && s.spotId !== photo.spotId)
        .map((s) => ({ s, d: haversineKm(here, s.coords!) }))
        .filter((x) => x.d <= maxKm)
        .sort((x, y) => x.d - y.d || x.s.name.localeCompare(y.s.name, "ja"))
        .slice(0, limit)
        .map(({ s }) => toRow(s, undefined));
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

