import type { Photo } from "../data/photos";
import { haversineKm } from "./journey";
import { compareOldest, photoTimeKey } from "./photoOrder";
import { countryIn } from "./visitedCountries";

// マイページの「旅の記録」（案 H1「星図」）に描く、**写真をつないだ線**の形と数。
//
// iOS の `Core/Text/TravelRoute.swift`（形）・`TravelDistance.swift`（距離）を移したもの。
// **距離と線は同じ写真・同じ古い順**でつなぐ——線の形と数字が食い違わないように、
// 選び方と並べ方はここ1か所（`routeCoordinates`）に置き、距離もそこから測る。
// 地図は描かず、正距円筒（経度＝横・緯度＝縦）で線の通る範囲だけを枠いっぱいに広げる。
//
// 距離は**実際に移動した距離ではない**（写真の座標を古い順に直線でつないだ合計）。
// だから画面では「写真をつないだ距離」と呼ぶ。

export type LatLng = { lat: number; lng: number };
export type Pt = { x: number; y: number };

/** 線を描くのに足りる点の数。これより少なければ線は出さない */
export const MINIMUM_POINTS = 2;
/** 点が多いときに間引く上限（形はほとんど変わらない） */
export const MAXIMUM_POINTS = 240;
/** 経度 30°・緯度 10° ごとに格子を引く */
export const MERIDIAN_STEP = 30;
export const PARALLEL_STEP = 10;
/** 範囲がこれより狭いときは、この幅があるものとして真ん中に置く（同じ町の中だけの線を大旅行に見せない） */
export const MINIMUM_SPAN_DEGREES = 2;
/** 枠の中でほとんど同じ所に続く点は1つにまとめる距離（0〜1 の枠の中で） */
export const MERGE_DISTANCE = 0.012;
/** ふくらみが最大になる区間の長さ（枠の幅に対する割合） */
export const ARC_FULL_LENGTH_RATIO = 0.6;

function hasCoords(p: Photo): p is Photo & { coords: LatLng } {
    return !!p.coords && typeof p.coords.lat === "number" && typeof p.coords.lng === "number"
        && Number.isFinite(p.coords.lat) && Number.isFinite(p.coords.lng);
}

/**
 * 距離と線に使う撮影地を、古い順に。
 *
 * **日時を読めない写真は入れない**（つなぐ順が決まらない写真を「いちばん古い場所」として
 * 数えると、そこから1脚ぶん距離が増える）。並びはサイト全体の `compareOldest`
 * ——`Date.parse` を通さないので、閲覧者のタイムゾーンで順（＝距離）が変わらない。
 */
export function routeCoordinates(photos: ReadonlyArray<Photo>): LatLng[] {
    return photos
        .filter((p) => hasCoords(p) && photoTimeKey(p) !== "")
        .sort(compareOldest)
        .map((p) => ({ lat: (p.coords as LatLng).lat, lng: (p.coords as LatLng).lng }));
}

/** 並べた順に座標をつないだ合計（km）。2点未満は 0 */
export function connectKm(points: ReadonlyArray<LatLng>): number {
    let total = 0;
    for (let i = 1; i < points.length; i++) total += haversineKm(points[i - 1], points[i]);
    return total;
}

/**
 * 経度を前の点から続くように直す（日付変更線をまたぐと 359° 飛んで見えるのを防ぐ）。
 * 東京→ホノルルは 139.76 → -157.86 ではなく 139.76 → 202.14 として描く
 */
export function unwrapped(points: ReadonlyArray<LatLng>): LatLng[] {
    const out: LatLng[] = [];
    for (const point of points) {
        const previous = out[out.length - 1];
        if (!previous) {
            out.push({ lat: point.lat, lng: point.lng });
            continue;
        }
        let lng = point.lng;
        while (lng - previous.lng > 180) lng -= 360;
        while (lng - previous.lng < -180) lng += 360;
        out.push({ lat: point.lat, lng });
    }
    return out;
}

/** 均等に間引く。**最初と最後の点は必ず残す**（一番古い・一番新しい写真） */
export function thinned<T>(points: ReadonlyArray<T>, limit = MAXIMUM_POINTS): T[] {
    if (points.length <= limit || limit < 2) return [...points];
    const step = (points.length - 1) / (limit - 1);
    return Array.from({ length: limit }, (_, i) => points[Math.round(i * step)]);
}

function padded(low: number, high: number): [number, number] {
    if (high - low >= MINIMUM_SPAN_DEGREES) return [low, high];
    const middle = (low + high) / 2;
    return [middle - MINIMUM_SPAN_DEGREES / 2, middle + MINIMUM_SPAN_DEGREES / 2];
}

/** 続けて同じ所の点は1つにまとめる。**一番新しい点は必ず残す** */
export function deduplicated(points: ReadonlyArray<Pt>): Pt[] {
    const out: Pt[] = [];
    points.forEach((point, index) => {
        const previous = out[out.length - 1];
        if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < MERGE_DISTANCE) {
            if (index === points.length - 1) out[out.length - 1] = point;
            return;
        }
        out.push(point);
    });
    return out;
}

/** 枠の中に収めた線の形 */
export type RouteShape = {
    /** 0〜1 に収めた点（x: 左→右、y: 上→下＝北が上）。古い順 */
    points: Pt[];
    /** 経度の格子（0〜1 の x）。30° ごと */
    meridians: number[];
    /** 緯度の格子（0〜1 の y）。10° ごと */
    parallels: number[];
};

function strideThrough(from: number, through: number, by: number): number[] {
    const out: number[] = [];
    for (let v = from; v <= through + 1e-9; v += by) out.push(v);
    return out;
}

/** 撮影地を枠に収める。点が足りない・まとめた結果1点（同じ町の中だけ）なら null */
export function routeShape(coordinates: ReadonlyArray<LatLng>): RouteShape | null {
    const points = thinned(unwrapped(coordinates));
    if (points.length < MINIMUM_POINTS) return null;
    const lngs = points.map((p) => p.lng);
    const lats = points.map((p) => p.lat);
    const [minLng, maxLng] = padded(Math.min(...lngs), Math.max(...lngs));
    const [minLat, maxLat] = padded(Math.min(...lats), Math.max(...lats));
    const spanLng = maxLng - minLng;
    const spanLat = maxLat - minLat;
    const fitted = deduplicated(points.map((p) => ({
        x: (p.lng - minLng) / spanLng,
        y: 1 - (p.lat - minLat) / spanLat,
    })));
    if (fitted.length < MINIMUM_POINTS) return null;
    const meridians = strideThrough(Math.ceil(minLng / MERIDIAN_STEP) * MERIDIAN_STEP, maxLng, MERIDIAN_STEP)
        .map((v) => (v - minLng) / spanLng);
    const parallels = strideThrough(Math.ceil(minLat / PARALLEL_STEP) * PARALLEL_STEP, maxLat, PARALLEL_STEP)
        .map((v) => 1 - (v - minLat) / spanLat);
    return { points: fitted, meridians, parallels };
}

/**
 * 2点を結ぶ弧の曲げの点（0〜1 の枠の中で）。
 *
 * - **行きは上へ・帰りは下へ**ふくらむ（東へ向かう区間は上、西へは下）。往復が目の形に開く
 * - **同じ2か所を何度も行き来したら、回ごとに大きく**（`occurrence`・70% → 100%）
 * - ふくらみは区間の長さに比例し、上下の余白（`band`）に収まる——曲線の頂点は曲げの点の
 *   半分の高さに来るので、上限は余白の2倍
 *
 * 曲げの点は**画面の点の単位で**決める（枠は横長なので、0〜1 のままだとふくらみが縦に潰れる）
 */
export function arcControl(a: Pt, b: Pt, size: { width: number; height: number }, band: number, occurrence = 0): Pt {
    const w = size.width;
    const h = size.height;
    if (!(w > 0) || !(h > 0)) return a;
    const ax = a.x * w, ay = a.y * h, bx = b.x * w, by = b.y * h;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const dx = bx - ax, dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (length === 0) return { x: mx / w, y: my / h };
    // 区間に直角な2つの向きのうち、画面の上（y が小さい側）を指す方
    let upX = dy / length;
    let upY = -dx / length;
    if (upY > 0 || (upY === 0 && upX > 0)) { upX = -upX; upY = -upY; }
    // 東へ進むなら上へ、西へなら下へ
    const sign = dx >= 0 ? 1 : -1;
    const base = Math.min(1, length / (w * ARC_FULL_LENGTH_RATIO));
    const spread = 0.7 + (0.3 * Math.min(occurrence, 3)) / 3;
    const lift = 2 * band * base * spread * sign;
    return { x: (mx + upX * lift) / w, y: (my + upY * lift) / h };
}

/** 区間ごとの曲げの点。同じ2か所（向きは問わない）を前に何回結んだかを数えて渡す */
export function arcControls(points: ReadonlyArray<Pt>, size: { width: number; height: number }, band: number): Pt[] {
    if (points.length < 2) return [];
    const near = MERGE_DISTANCE * 3;
    const close = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y) < near;
    const seen: Array<[Pt, Pt]> = [];
    const out: Pt[] = [];
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const occurrence = seen.filter(([p, q]) => (close(p, a) && close(q, b)) || (close(p, b) && close(q, a))).length;
        out.push(arcControl(a, b, size, band, occurrence));
        seen.push([a, b]);
    }
    return out;
}

/** 一番古い写真の年（「2024 年から」）。距離と同じ写真（日時の読める写真）から。読めなければ null */
export function firstYear(photos: ReadonlyArray<Photo>): number | null {
    const dated = photos.filter((p) => photoTimeKey(p) !== "").sort(compareOldest);
    const match = dated.length > 0 ? /^(\d{4})-/.exec(photoTimeKey(dated[0])) : null;
    return match ? Number(match[1]) : null;
}

/** 訪れた国・地域の名前を**初めて訪れた順**に（数は `visitedCountryCount` と同じ） */
export function countriesInOrder(photos: ReadonlyArray<Photo>): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of [...photos].sort(compareOldest)) {
        const name = countryIn(p.location);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        out.push(name);
    }
    return out;
}

/** 名前の並びを1行に。3つまで、あとは「ほか N」 */
export function countriesLine(names: ReadonlyArray<string>, isJa = true, limit = 3): string {
    const sep = isJa ? "・" : ", ";
    if (names.length <= limit) return names.join(sep);
    const rest = names.length - limit;
    return names.slice(0, limit).join(sep) + (isJa ? ` ほか${rest}` : ` +${rest}`);
}
