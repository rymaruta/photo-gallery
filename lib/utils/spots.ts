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
 * 🔴 **名前が一致しただけでは「決まり」にしない。** 以前はここが
 * `confirmed`（＝書き込んでよい）を返していて、`--apply` がそのまま
 * 本番の写真に `spotId` を書いていた。名前の一致は撮影の証拠にならない:
 *
 *   - 富士山は**20km 先からでも撮れる**（被写体の地点＝撮影の地点ではない）
 *   - 同じ名前の神社・公園・駅が各地にある（台帳に1件しか無くても、
 *     **台帳が未完成なだけ**かもしれない）
 *   - 「京都」「北海道」のような**広い地域名**が撮影地に入っている
 *
 * だから機械が出すのは**候補まで**で、確定は人の仕事。
 *
 *     unmatched … 台帳に同じ名前が無い（何もしない）
 *     ambiguous … 同名が複数、または座標が大きく離れる（人が調べる）
 *     review    … 名前が1件だけ一致した。**人が見て決める候補**
 *
 * **`confirmed` はこの関数からは返らない。** 確定は
 * `content/spot-links.json`（人が承認した紐付けの台帳）にしか存在せず、
 * `--apply` はそこに載っているものだけを書く。
 */
export type LinkSuggestion = {
    photoId: string;
    location: string;
    spotId?: string;
    spotName?: string;
    verdict: "review" | "ambiguous" | "unmatched";
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
            verdict: "review", reason: "名前が1件だけ一致（人の確認が要る）",
        });
    }
    return out;
}

/**
 * **人が確認した紐付け。** `content/spot-links.json` の1行ぶん。
 *
 * 機械の候補（`suggestSpotLinks`）は書き込みの根拠にならない。
 * 書いてよいのは、人がその写真を実際に見て「この地点で撮った」と
 * 判断したものだけ。**誰がいつ何を根拠に決めたかを残す**——あとから
 * 「なぜこの写真にこのスポットが付いているのか」を辿れないと、
 * 間違いを見つけても直す手がかりが無い。
 */
export type ConfirmedSpotLink = {
    photoId: string;
    spotId: string;
    /** 確認した人（GitHub のユーザー名など、後から本人に辿れる名前） */
    confirmedBy: string;
    /** ISO8601 */
    confirmedAt: string;
    /** 何を見て決めたか（「写真に社殿が写っている」「撮影者に確認」など） */
    evidence: string;
};

/** 書き込みを断る理由。**通す理由は1つだけで、断る理由は数え上げる** */
export type ApplyRejection = {
    photoId: string;
    spotId?: string;
    reason: string;
};

/**
 * **書き込んでよい紐付けだけを選ぶ。**
 *
 * 人の承認（`confirmed`）を入口にして、そのうえで写真・スポット・候補の
 * 三方が食い違っていないものだけを通す。片方向の確認（承認さえあれば書く）
 * にしないのは、承認した後に写真の撮影地が書き換わったり、スポットが
 * 台帳から消えたりしうるため——**承認は「あの時点の判断」**でしかない。
 */
export function selectApplicableLinks(
    photos: Photo[],
    spots: Spot[],
    confirmed: ConfirmedSpotLink[],
): { apply: ConfirmedSpotLink[]; rejected: ApplyRejection[] } {
    const byId = new Map(photos.map((p) => [p.id, p]));
    const spotIds = new Set(spots.map((s) => s.spotId));
    // 候補は「いま同じ判断になるか」を照らすためだけに使う
    const candidates = new Map(suggestSpotLinks(photos, spots).map((s) => [s.photoId, s]));

    const apply: ConfirmedSpotLink[] = [];
    const rejected: ApplyRejection[] = [];
    const seen = new Set<string>();

    for (const c of confirmed) {
        const push = (reason: string) => rejected.push({ photoId: c.photoId, spotId: c.spotId, reason });

        if (!c.photoId || !c.spotId) { push("photoId か spotId が空"); continue; }
        if (!c.confirmedBy?.trim()) { push("確認した人が書かれていない"); continue; }
        if (!c.confirmedAt?.trim()) { push("確認した日時が書かれていない"); continue; }
        if (!c.evidence?.trim()) { push("判定の根拠が書かれていない"); continue; }
        if (seen.has(c.photoId)) { push("同じ写真が2回書かれている"); continue; }
        seen.add(c.photoId);

        const photo = byId.get(c.photoId);
        if (!photo) { push("その写真が無い（消された・IDの打ち間違い）"); continue; }
        if (photo.spotId) {
            // 同じ先に付いているなら何もしない（冪等）。違う先なら人の判断がいる
            push(photo.spotId === c.spotId ? "既に同じ spotId が付いている" : `既に別の spotId（${photo.spotId}）が付いている`);
            continue;
        }
        if (!spotIds.has(c.spotId)) { push("その spotId が台帳に無い"); continue; }

        // **いまの候補と食い違っていたら書かない。** 承認したあとに撮影地が
        // 書き換わっていれば、その承認はもう別の写真についての判断になっている
        const s = candidates.get(c.photoId);
        if (!s) { push("いまは候補に挙がらない（撮影地が空・既に紐付け済みなど）"); continue; }
        if (s.verdict === "ambiguous") { push(`いまは曖昧な候補（${s.reason}）`); continue; }
        if (s.spotId !== c.spotId) { push(`承認した先（${c.spotId}）と、いまの候補（${s.spotId ?? "無し"}）が違う`); continue; }

        apply.push(c);
    }
    return { apply, rejected };
}
