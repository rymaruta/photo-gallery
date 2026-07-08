// Journey Replay（足あと再生）用の純粋ロジック。
// 位置情報つき写真を撮影日順に並べ、再生用のポイント列を作る。

import type { Photo } from "@/lib/data/photos";

export type JourneyPoint = {
    photo: Photo;
    lat: number;
    lng: number;
    t: number;
};

/**
 * 再生対象のポイント列（撮影日 date 優先、なければ createdAt の昇順）。
 * - 位置情報なし / 非公開 / 日付不明の写真は除外
 * - max を超える長旅は、最初と最後を必ず残して等間隔に間引く
 *   （30秒BGMに合わせて既定は30地点）
 */
export function buildJourneyPoints(photos: Photo[], max = 30): JourneyPoint[] {
    const pts = photos
        .filter(
            (p) =>
                p.coords &&
                typeof p.coords.lat === "number" &&
                typeof p.coords.lng === "number" &&
                p.published !== false,
        )
        .map((p) => ({
            photo: p,
            lat: p.coords!.lat,
            lng: p.coords!.lng,
            t: Date.parse(String(p.date ?? p.createdAt ?? "")),
        }))
        .filter((x) => !isNaN(x.t))
        .sort((a, b) => a.t - b.t);

    if (pts.length <= max || max < 2) return pts;

    const out: JourneyPoint[] = [pts[0]];
    const step = (pts.length - 1) / (max - 1);
    for (let k = 1; k < max - 1; k++) {
        const idx = Math.round(k * step);
        const cand = pts[idx];
        if (out[out.length - 1] !== cand) out.push(cand);
    }
    if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
    return out;
}
