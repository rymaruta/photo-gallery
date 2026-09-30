// lib/data/spotSearchFeed.ts（サーバー専用）
//
// **Web の「さがす」が読む、撮影スポットの名前だけの索引**（`/app/data/spot-search.json`）。
//
// 「銀山温泉」で探して写真が0枚でも、その撮影地ガイドへ案内するため（2026-09-30 のレビュー:
// 「探す」で「銀山温泉」を検索すると写真0件になり、ガイドは存在するのに案内されない）。
//
// ## なぜ別のファイルか
//
//   - アプリの索引（`/app/data/spots.json`）は季節の案内まで載っていて約 865KB。名前で探すだけに重い
//   - 「さがす」のページに埋め込むと、**探さない人まで**毎回 約 130KB（gzip 約 70KB）を受け取る
//     → 語を打ったときに初めて取りに行く（`app/search/SpotSearchResults.tsx`）
//
// 載せるのは名前・英語名・読み・別名・地域（県と市、海外は国）・綴りだけ。
// **母集合は `visibleSpots`**（画面・地図と同じ）。座標の無い行も載せる（名前で探すのに座標は要らない）。
//
// 🔴 台帳（`SPOTS`）を値で読む。**`"use client"` から import しない**。

import { SPOTS, type Spot } from "./spots";
import { visibleSpots } from "../utils/spotGuide";
import type { SpotSearchRow } from "../utils/spots";

export type { SpotSearchRow };

export function regionLabel(spot: Spot): string {
    const r = spot.region ?? {};
    const parts = r.country && r.country !== "日本"
        ? [r.country, r.prefecture, r.city]
        : [r.prefecture, r.city];
    return parts.filter((x): x is string => !!x && !!x.trim()).join(" ");
}

export function toSpotSearchRow(spot: Spot): SpotSearchRow {
    const row: SpotSearchRow = { s: spot.slug, n: spot.name };
    if (spot.nameEn?.trim()) row.e = spot.nameEn.trim();
    if (spot.reading?.trim()) row.r = spot.reading.trim();
    const aliases = (spot.aliases ?? []).filter((x) => x && x.trim());
    if (aliases.length > 0) row.a = aliases;
    const g = regionLabel(spot);
    if (g) row.g = g;
    return row;
}

/** 純関数。テストは固定の台帳を渡す */
export function buildSpotSearchRows(spots: readonly Spot[]): SpotSearchRow[] {
    return visibleSpots(spots).map(toSpotSearchRow);
}

export function spotSearchJson(): string {
    return JSON.stringify(buildSpotSearchRows(SPOTS));
}
