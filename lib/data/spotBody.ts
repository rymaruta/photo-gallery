// lib/data/spotBody.ts（サーバー専用）
//
// **アプリ（iOS）が撮影スポットの画面で読む本文。** 場所ごとに1ファイル
// （`out/app/data/spots/<slug>.json`・`app/app/data/spots/[file]/route.ts`）。
// 索引（`spotFeed.ts`）に全部の本文を入れると約 700KB になるので、開いた場所の
// 分だけ取りに行く形にした（1件 約 2KB）。
//
// ## 載せるもの（2026-09-27）
//
//   name・coords（2026-09-30・Web の投稿画面がスポットを引き継ぐため）・
//   description・highlights・seasonalGuide・timeOfDayGuide・compositionTips・
//   officialWebsiteUrl と、**確かめた印**（`check`）:
//     - 人が確かめた行   → { kind: "human", verifiedAt }（画面は「情報の最終確認（運営）」）
//     - AI 照合の行      → { kind: "ai", checkedAt, sources }（画面は「出典: …（AI 照合 日付）」）
//   Web の `SpotGuideClient` と同じ出し分け。**出典の無い本文は配らない。**
//
// ## 載せないもの
//
//   下書き（`isPublished` でない行）はファイルごと作らない——確かめていない文を
//   アプリに出さない。アクセス・駐車場・注意点（確認者つきの出典が要る項目）、
//   draftedBy（製品名）、verifiedBy（人名）も運ばない。
//
// 🔴 このモジュールは台帳（`SPOTS`）を値で読む。**`"use client"` から import しない**。

import { SPOTS, type Spot } from "./spots";
import { visibleSpots, isVerified, isPublished, hasAiCheck } from "../utils/spotGuide";

export type SpotBodyCheck =
    | { kind: "human"; verifiedAt: string }
    | { kind: "ai"; checkedAt: string; sources: { url: string; title: string }[] };

export type SpotBody = {
    spotId: string;
    slug: string;
    /**
     * 名前と座標（約1km精度・台帳のまま）。**Web の投稿画面が読む**——スポットの画面から
     * 投稿するとき、画面に出す名前と送る `spotId` を同じ1本から取り、写真がその近くで
     * 撮られたかを確かめる（`lib/utils/spotUpload.ts`）。索引（約 865KB）は重いので読まない
     */
    name: string;
    coords?: { lat: number; lng: number };
    description?: string;
    highlights?: string[];
    seasonalGuide?: { season: string; text: string }[];
    timeOfDayGuide?: { time: string; text: string }[];
    compositionTips?: string[];
    officialWebsiteUrl?: string;
    check: SpotBodyCheck;
};

function compact<T extends object>(obj: T): T {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

function nonEmpty<T>(list: T[] | undefined): T[] | undefined {
    return list && list.length > 0 ? list : undefined;
}

/** 台帳の1件を本文の形へ。**公開済みでなければ undefined**（下書きは配らない） */
export function toSpotBody(spot: Spot): SpotBody | undefined {
    if (!isPublished(spot)) return undefined;
    let check: SpotBodyCheck;
    if (isVerified(spot) && spot.verifiedAt) {
        check = { kind: "human", verifiedAt: spot.verifiedAt };
    } else if (hasAiCheck(spot) && spot.aiCheck) {
        check = {
            kind: "ai",
            checkedAt: spot.aiCheck.checkedAt,
            sources: spot.aiCheck.sources.map((s) => ({ url: s.url, title: s.title })),
        };
    } else {
        // 公開済みなのに印が無い行は作らない（出典の無い本文を配らない）
        return undefined;
    }
    return compact({
        spotId: spot.spotId,
        slug: spot.slug,
        name: spot.name,
        coords: spot.coords ? { lat: spot.coords.lat, lng: spot.coords.lng } : undefined,
        description: spot.description?.trim() ? spot.description : undefined,
        highlights: nonEmpty(spot.highlights),
        seasonalGuide: nonEmpty(spot.seasonalGuide)?.map((g) => ({ season: g.season, text: g.text })),
        timeOfDayGuide: nonEmpty(spot.timeOfDayGuide)?.map((g) => ({ time: g.time, text: g.text })),
        compositionTips: nonEmpty(spot.compositionTips),
        officialWebsiteUrl: spot.officialWebsiteUrl || undefined,
        check,
    });
}

/** 純関数。テストは固定の台帳を渡す。**母集合は `visibleSpots`**（画面と同じ） */
export function buildSpotBodies(spots: readonly Spot[]): SpotBody[] {
    return visibleSpots(spots).flatMap((s) => {
        const body = toSpotBody(s);
        return body ? [body] : [];
    });
}

/** 実際に配る本文 */
export function spotBodies(): SpotBody[] {
    return buildSpotBodies(SPOTS);
}

/** ファイル名（`<slug>.json`）から配る文字列。無ければ undefined。**minify** */
export function spotBodyJson(file: string): string | undefined {
    if (!file.endsWith(".json")) return undefined;
    const slug = file.slice(0, -".json".length);
    const body = spotBodies().find((b) => b.slug === slug);
    return body ? JSON.stringify(body) : undefined;
}
