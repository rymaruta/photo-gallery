// lib/utils/spots.ts
// 撮影スポット台帳の純関数（fs も JSX も持たない。サーバー・画面・テストから読める）。

import type { Photo } from "../data/photos";
import type { Spot } from "../data/spots";
import { haversineKm } from "./journey";

/** 名前の突き合わせ用。全角空白・記号の揺れを落とす（**判定にしか使わない**） */
export function normalizeSpotName(value?: string): string {
    return (value ?? "")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\s　]+/g, "")
        // 括弧・読点・中黒は打ち方の揺れ。「オペラ・ガルニエ（パリ）」と
        // 「オペラガルニエ (パリ)」を同じ綴りとして見る
        .replace(/[()（）「」『』,、，]/g, "");
}

/** ID 一発引き（台帳が小さいうちは線形で十分——実データは0件、想定は数十件） */
export function spotById(spots: Spot[], spotId?: string): Spot | undefined {
    if (!spotId) return undefined;
    return spots.find((s) => s.spotId === spotId);
}

export function spotBySlug(spots: Spot[], slug?: string): Spot | undefined {
    if (!slug) return undefined;
    return spots.find((s) => s.slug === slug);
}

/** 公開してよい台帳だけ（下書きは画面にもサイトマップにも出さない） */
export function publishedSpots(spots: Spot[]): Spot[] {
    return spots.filter((s) => s.status !== "draft");
}

/**
 * 名前で探す。正式名と別名の**両方**を見る。
 *
 * 前方一致を先に、部分一致を後に出す（「たか」で「高屋神社」が先頭に来る）。
 */
export function searchSpotsByName(spots: Spot[], query: string, limit = 20): Spot[] {
    const q = normalizeSpotName(query);
    if (q.length < 1) return [];
    const scored: Array<{ spot: Spot; rank: number }> = [];
    for (const spot of spots) {
        const names = [spot.name, ...(spot.aliases ?? [])].map(normalizeSpotName);
        let rank = -1;
        for (const name of names) {
            if (name === q) { rank = 0; break; }
            if (name.startsWith(q)) { rank = Math.min(rank < 0 ? 1 : rank, 1); continue; }
            if (name.includes(q)) rank = rank < 0 ? 2 : rank;
        }
        if (rank >= 0) scored.push({ spot, rank });
    }
    return scored
        .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.spot.name.localeCompare(b.spot.name)))
        .slice(0, limit)
        .map((s) => s.spot);
}

/**
 * 地域で並べる。**指定した階層だけを見る**
 * （`{ country: "日本" }` なら都道府県の指定は要らない）。
 */
export function spotsInRegion(spots: Spot[], region: { country?: string; prefecture?: string; city?: string }): Spot[] {
    const want = {
        country: normalizeSpotName(region.country),
        prefecture: normalizeSpotName(region.prefecture),
        city: normalizeSpotName(region.city),
    };
    return spots.filter((s) => {
        const have = s.region ?? {};
        if (want.country && normalizeSpotName(have.country) !== want.country) return false;
        if (want.prefecture && normalizeSpotName(have.prefecture) !== want.prefecture) return false;
        if (want.city && normalizeSpotName(have.city) !== want.city) return false;
        return true;
    }).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 近くのスポット（近い順）。
 *
 * **座標は約1km に丸めてある**ので、半径を1km以下にしても意味は増えない
 * （丸めの粒より細かい問いには答えられない）。既定は5km。
 */
export function nearbySpots(spots: Spot[], point: { lat: number; lng: number }, radiusKm = 5, limit = 20): Spot[] {
    return spots
        .filter((s) => !!s.coords)
        .map((s) => ({ spot: s, km: haversineKm(point, s.coords!) }))
        .filter((x) => x.km <= radiusKm)
        .sort((a, b) => a.km - b.km)
        .slice(0, limit)
        .map((x) => x.spot);
}

/**
 * そのスポットの公開写真（新しい順）。
 *
 * **`spotId` でしか数えない。** 撮影地の文字列が似ているというだけの写真を
 * 混ぜると、スポットページの枚数が「実際に紐づけた数」より多く見える
 * ——`/location/*` が緩い一致で水増ししていた穴と同じ轍を踏まない。
 */
export function photosForSpot(photos: Photo[], spotId: string): Photo[] {
    return photos
        .filter((p) => p.spotId === spotId && p.published !== false && !!p.src)
        .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}

/**
 * 写真とスポットの結び付け候補。**自動で書き込むためではなく、
 * 人が見て決めるための下書き**。
 *
 * 判定の順番（厳しい方から）:
 *
 *  1. **名前が一致しない写真は候補にしない。** 座標だけで同じ地点と
 *     決めない——本番の写真は座標を1枚も持っておらず、あっても1km丸め、
 *     さらに**被写体と撮影位置は別**（富士山は20km先からでも撮れる）
 *  2. 名前が一致するスポットが**2つ以上**なら `ambiguous`。同名異所
 *     （「大手町」「清水寺」…）を機械が選ばない
 *  3. 両方が座標を持ち、**200km 以上離れていれば** `ambiguous` に落とす。
 *     被写体と撮影位置の差では説明できない距離＝同名異所の疑い。
 *     近いことを根拠に `confirmed` へ**格上げはしない**（1 の理由）
 *
 * `confirmed` だけが書き込んでよい候補。それ以外は**未設定のまま残す**。
 */
export type LinkSuggestion = {
    photoId: string;
    location: string;
    spotId?: string;
    spotName?: string;
    verdict: "confirmed" | "ambiguous" | "unmatched";
    reason: string;
};

/** 同名異所とみなす距離（km）。これ以上離れていたら機械は決めない */
export const LINK_CONFLICT_KM = 200;

export function suggestSpotLinks(photos: Photo[], spots: Spot[]): LinkSuggestion[] {
    const out: LinkSuggestion[] = [];
    for (const photo of photos) {
        if (photo.spotId) continue; // 既に紐づいている写真は触らない
        const location = (photo.location ?? "").trim();
        if (!location) continue;
        const key = normalizeSpotName(location);
        const matched = spots.filter((s) =>
            [s.name, ...(s.aliases ?? [])].some((n) => normalizeSpotName(n) === key));

        if (matched.length === 0) {
            out.push({ photoId: photo.id, location, verdict: "unmatched", reason: "台帳に同じ名前が無い" });
            continue;
        }
        if (matched.length > 1) {
            out.push({
                photoId: photo.id, location, verdict: "ambiguous",
                reason: `同じ名前のスポットが${matched.length}件ある（同名異所の可能性）`,
            });
            continue;
        }
        const spot = matched[0];
        if (photo.coords && spot.coords) {
            const km = haversineKm(photo.coords, spot.coords);
            if (km >= LINK_CONFLICT_KM) {
                out.push({
                    photoId: photo.id, location, spotId: spot.spotId, spotName: spot.name,
                    verdict: "ambiguous",
                    reason: `名前は一致するが座標が ${Math.round(km)}km 離れている`,
                });
                continue;
            }
        }
        out.push({
            photoId: photo.id, location, spotId: spot.spotId, spotName: spot.name,
            verdict: "confirmed", reason: "名前が1件だけ一致",
        });
    }
    return out;
}
