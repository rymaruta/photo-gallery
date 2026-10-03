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
//   **作例**（`samples`・2026-10-03）: Wikimedia Commons の自由に使える写真（最大6枚・
//   `lib/data/spotSamples.ts`）。1枚ごとに作者・ライセンス・出典（Commons のページ）を
//   必ず持つ——アプリは写真の下にこの3つを出す。**後から足した項目**なので、知らない
//   アプリ（いまの iOS）は読み飛ばす。無いスポットは鍵ごと出さない
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
import { spotSamples, type SpotSample, type SpotSamplesFile } from "./spotSamples";

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
    /**
     * 国（台帳の `region.country`）。**日本の外の行だけ**——旅行プランの当日モードが、光の時刻を
     * その土地の時計で言うのに使う（`timeZoneForCountry`）。日本の行は持たない（無ければ日本）
     */
    country?: string;
    description?: string;
    highlights?: string[];
    seasonalGuide?: { season: string; text: string }[];
    timeOfDayGuide?: { time: string; text: string }[];
    compositionTips?: string[];
    officialWebsiteUrl?: string;
    check: SpotBodyCheck;
    /** 作例（Wikimedia Commons・作者とライセンスと出典つき）。無ければ鍵ごと無い */
    samples?: SpotSample[];
};

function compact<T extends object>(obj: T): T {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

function nonEmpty<T>(list: T[] | undefined): T[] | undefined {
    return list && list.length > 0 ? list : undefined;
}

/** 台帳の1件を本文の形へ。**公開済みでなければ undefined**（下書きは配らない） */
export function toSpotBody(spot: Spot, samplesFile?: Readonly<SpotSamplesFile>): SpotBody | undefined {
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
        country: spot.region?.country && spot.region.country.trim() !== "日本" ? spot.region.country.trim() : undefined,
        description: spot.description?.trim() ? spot.description : undefined,
        highlights: nonEmpty(spot.highlights),
        seasonalGuide: nonEmpty(spot.seasonalGuide)?.map((g) => ({ season: g.season, text: g.text })),
        timeOfDayGuide: nonEmpty(spot.timeOfDayGuide)?.map((g) => ({ time: g.time, text: g.text })),
        compositionTips: nonEmpty(spot.compositionTips),
        officialWebsiteUrl: spot.officialWebsiteUrl || undefined,
        check,
        samples: nonEmpty(spotSamples(spot, { file: samplesFile })),
    });
}

/** 純関数。テストは固定の台帳を渡す。**母集合は `visibleSpots`**（画面と同じ） */
export function buildSpotBodies(spots: readonly Spot[], samplesFile?: Readonly<SpotSamplesFile>): SpotBody[] {
    return visibleSpots(spots).flatMap((s) => {
        const body = toSpotBody(s, samplesFile);
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
