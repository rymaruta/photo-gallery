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
 * 写真とスポットの紐付けの**候補**を出す。
 *
 * 🔴 **名称一致は証拠ではない**（owner の指示書 6・最重要）。
 *
 * > 撮影地名が一致するだけでは、その写真が実際にそのスポットで撮影された
 * > 証拠としては不十分です。例えば、富士山を離れた場所から撮影した写真と
 * > 富士山そのものの地点。同じ名称の神社や公園。撮影地として入力された
 * > 広い地域名。これらを名称だけで同一視しないでください。
 *
 * だからこの関数は **`confirmed` を返さない**。返せるのは「候補」までで、
 * `confirmed` になるのは**人が確認した記録**（`content/spot-links.json`）が
 * あるときだけ（`linkStates`）。
 *
 * ⚠️ 以前の実装は `verdict: "confirmed", reason: "名前が1件だけ一致"` を
 * 返していた。`--apply` はそれを書き込む作りだったので、**名前が一致した
 * だけの写真に `spotId` が入る**形だった。
 */
export type LinkVerdict =
    /** 未紐付け（台帳に同じ名前が無い） */
    | "unlinked"
    /** 候補あり・**人の確認待ち**。名称は一致したが、それだけでは証拠にならない */
    | "candidate"
    /** 同名異所・座標の食い違いなどで**機械が決められない** */
    | "ambiguous"
    /** **人が確認して承認した**紐付け（記録がある） */
    | "confirmed";

export type LinkSuggestion = {
    photoId: string;
    location: string;
    spotId?: string;
    spotName?: string;
    verdict: LinkVerdict;
    /** なぜその判定になったか。**人が読んで確かめるための根拠** */
    reason: string;
};

/**
 * 人が確認した紐付けの記録（`content/spot-links.json`）。
 *
 * **誰が・いつ・何を根拠に**確認したかまで残す（指示書 6）。
 * これが無い紐付けは、何があっても書き込まない。
 */
export type SpotLinkConfirmation = {
    photoId: string;
    spotId: string;
    /** 確認した人 */
    confirmedBy: string;
    /** 確認した日時（ISO8601） */
    confirmedAt: string;
    /** 判定根拠（「現地で撮影」「Exif の座標と一致」など、人が書く） */
    evidence: string;
};

/** 同名異所とみなす距離（km）。これ以上離れていたら機械は決めない */
export const LINK_CONFLICT_KM = 200;

/** 記録の形が揃っているか。**1つでも欠けていたら確認済みとして扱わない** */
export function isUsableConfirmation(value: unknown): value is SpotLinkConfirmation {
    if (!value || typeof value !== "object") return false;
    const c = value as Record<string, unknown>;
    return ["photoId", "spotId", "confirmedBy", "confirmedAt", "evidence"]
        .every((k) => typeof c[k] === "string" && (c[k] as string).trim().length > 0);
}

/**
 * 写真ごとの状態。**書き込んでよいのは `confirmed` だけ。**
 *
 * @param confirmations 人が確認した記録。**形の壊れた行は無いものとして扱う**
 *   ——確認者や根拠が空の行を「確認済み」と読むと、記録の意味が消える
 */
export function linkStates(
    photos: Photo[],
    spots: Spot[],
    confirmations: unknown[] = [],
): LinkSuggestion[] {
    const usable = confirmations.filter(isUsableConfirmation);
    const byPhoto = new Map(usable.map((c) => [c.photoId, c]));
    const out: LinkSuggestion[] = [];

    for (const photo of photos) {
        const location = (photo.location ?? "").trim();
        const confirmation = byPhoto.get(photo.id);

        // **確認済みの記録があるときだけ `confirmed`。**
        // ただし記録が指す先が生きていることまで見る——消えたスポットや
        // 非公開の写真に、記録があるからといって書き込まない
        if (confirmation) {
            const spot = spots.find((s) => s.spotId === confirmation.spotId);
            if (!spot) {
                out.push({ photoId: photo.id, location, spotId: confirmation.spotId,
                    verdict: "ambiguous", reason: "確認済みの記録があるが、その spotId が台帳に無い" });
                continue;
            }
            if (photo.published === false) {
                out.push({ photoId: photo.id, location, spotId: spot.spotId, spotName: spot.name,
                    verdict: "ambiguous", reason: "確認済みの記録があるが、写真が非公開" });
                continue;
            }
            out.push({ photoId: photo.id, location, spotId: spot.spotId, spotName: spot.name,
                verdict: "confirmed",
                reason: `${confirmation.confirmedBy} が ${confirmation.confirmedAt} に確認（${confirmation.evidence}）` });
            continue;
        }

        // ここから先は**どれも書き込めない**。人が見るための下書き
        if (photo.spotId) {
            out.push({ photoId: photo.id, location, spotId: photo.spotId,
                verdict: "confirmed", reason: "既に紐づいている（触らない）" });
            continue;
        }
        if (!location) {
            out.push({ photoId: photo.id, location, verdict: "unlinked", reason: "撮影地が空" });
            continue;
        }

        const key = normalizeSpotName(location);
        const matched = spots.filter((s) =>
            [s.name, ...(s.aliases ?? [])].some((n) => normalizeSpotName(n) === key));

        if (matched.length === 0) {
            out.push({ photoId: photo.id, location, verdict: "unlinked", reason: "台帳に同じ名前が無い" });
            continue;
        }
        if (matched.length > 1) {
            out.push({ photoId: photo.id, location, verdict: "ambiguous",
                reason: `同じ名前のスポットが${matched.length}件ある（同名異所の可能性）` });
            continue;
        }

        const spot = matched[0];
        if (photo.coords && spot.coords) {
            const km = haversineKm(photo.coords, spot.coords);
            if (km >= LINK_CONFLICT_KM) {
                out.push({ photoId: photo.id, location, spotId: spot.spotId, spotName: spot.name,
                    verdict: "ambiguous",
                    reason: `名前は一致するが座標が ${Math.round(km)}km 離れている` });
                continue;
            }
        }

        // 🔴 **ここが `confirmed` だった。** 名称一致は候補まで。
        // 被写体と撮影位置は別（富士山は20km先からでも撮れる）で、
        // 座標が近いことも**格上げの根拠にしない**
        out.push({ photoId: photo.id, location, spotId: spot.spotId, spotName: spot.name,
            verdict: "candidate",
            reason: photo.coords && spot.coords
                ? "名前が1件だけ一致（座標も近いが、それだけでは証拠にならない）"
                : "名前が1件だけ一致（座標が無いので突き合わせられない）" });
    }
    return out;
}

/**
 * @deprecated 名前が判定の意味とずれるので `linkStates` を使う。
 * 残してあるのは、外から呼んでいる箇所を1つずつ移すため。
 */
export function suggestSpotLinks(photos: Photo[], spots: Spot[]): LinkSuggestion[] {
    // **確認の記録を渡さない＝`confirmed` は出ない**
    return linkStates(photos, spots, []);
}
