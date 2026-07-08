// 旅アルバム: 写真を撮影日の間隔で「旅」単位に自動グルーピングする純粋ロジック。
// 例: 5/3〜5/6 に撮った写真の塊 → 1つの旅。3日以上空いたら次の旅。

import type { Photo } from "@/lib/data/photos";
import { haversineKm } from "./journey";

export type Trip = {
    id: string;
    /** 旅の開始・終了（epoch ms） */
    start: number;
    end: number;
    /** 撮影日昇順の写真 */
    photos: Photo[];
    /** 訪れた場所（登場頻度順） */
    places: string[];
    /** 旅の中での移動距離（GPSつき写真から積算。無ければ 0） */
    distanceKm: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 写真を旅ごとにまとめる。呼び出し側で可視性（公開/非公開）は絞っておくこと。
 * 撮影日（date 優先、なければ createdAt）が無い写真は対象外。
 * 戻り値は新しい旅から順。
 */
export function buildTrips(photos: Photo[], gapDays = 3): Trip[] {
    const dated = photos
        .map((p) => ({ p, t: Date.parse(String(p.date ?? p.createdAt ?? "")) }))
        .filter((x) => !isNaN(x.t))
        .sort((a, b) => a.t - b.t);

    const groups: { p: Photo; t: number }[][] = [];
    for (const item of dated) {
        const cur = groups[groups.length - 1];
        if (!cur || item.t - cur[cur.length - 1].t > gapDays * DAY_MS) {
            groups.push([item]);
        } else {
            cur.push(item);
        }
    }

    return groups
        .map((g): Trip => {
            const placeCount = new Map<string, number>();
            for (const { p } of g) {
                const loc = (p.location ?? "").trim();
                if (loc) placeCount.set(loc, (placeCount.get(loc) ?? 0) + 1);
            }
            const places = [...placeCount.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([name]) => name);

            let distanceKm = 0;
            let prev: { lat: number; lng: number } | null = null;
            for (const { p } of g) {
                if (p.coords) {
                    if (prev) distanceKm += haversineKm(prev, p.coords);
                    prev = p.coords;
                }
            }

            return {
                id: `trip-${g[0].t}`,
                start: g[0].t,
                end: g[g.length - 1].t,
                photos: g.map((x) => x.p),
                places,
                distanceKm,
            };
        })
        .reverse();
}
