// lib/server/spotAutoLinks.ts
//
// **自動の結び（`lib/utils/spotAutoLink.ts`）を静的な生成で使う口**（2026-10-31・journey.photo-ios#425）。
//
// 台帳（`SPOTS`）から索引を1回だけ作り、写真ごとの答えを覚えておく。撮影スポットの頁は
// 約 2,700 枚建つので、頁ごとに全写真 × 全スポットを数え直すと遅い——写真の判定に効く項目
// （撮影地・題・説明・位置・`spotId`・`spotAuto`）が同じなら、前の答えを使う。

import type { Photo } from "@/lib/data/photos";
import { SPOTS } from "@/lib/data/spots";
import {
    buildSpotMatchIndex, spotMatcher, autoSpotIdFor, autoLinkTable,
    type SpotMatchIndex, type SpotMatcher, type AutoLinkPhoto,
} from "@/lib/utils/spotAutoLink";

let cached: { index: SpotMatchIndex; matcher: SpotMatcher } | null = null;

function ledger(): { index: SpotMatchIndex; matcher: SpotMatcher } {
    if (!cached) {
        const index = buildSpotMatchIndex(SPOTS);
        cached = { index, matcher: spotMatcher(index) };
    }
    return cached;
}

/** 投稿画面が読む索引（`/app/data/spot-match.json`） */
export function spotMatchIndex(): SpotMatchIndex {
    return ledger().index;
}

type Photoish = AutoLinkPhoto & { id: string; published?: boolean; spotAuto?: string | null };

/** 写真ごとの答え。鍵は判定に効く項目だけを並べたもの */
const memo = new Map<string, { sig: string; spotId: string | null }>();

function signature(p: Photoish): string {
    return JSON.stringify([p.location ?? "", p.title ?? "", p.description ?? "", p.coords ?? null]);
}

/** **決まりだけ**の答え（`spotId`・`spotAuto` を見ない）。本人に「外した先」を見せるのに使う */
export function ruleSpotIdFor(photo: Photoish): string | null {
    const sig = signature(photo);
    const hit = memo.get(photo.id);
    if (hit && hit.sig === sig) return hit.spotId;
    const spotId = ledger().matcher.match(photo);
    memo.set(photo.id, { sig, spotId });
    return spotId;
}

/** 自動で結ぶ先（`spotId` を持つ・本人が外した写真は `null`） */
export function autoSpotIdForPhoto(photo: Photoish): string | null {
    return autoSpotIdFor({ match: () => ruleSpotIdFor(photo) }, photo);
}

/** 写真 id → 撮影スポット id（自動の結びだけ・公開の写真だけ） */
export function autoLinksFor(photos: readonly Photo[]): Record<string, string> {
    return autoLinkTable({ match: (p) => ruleSpotIdFor(p as Photoish) }, photos as readonly Photoish[]);
}

/** 試験用: 覚えた答えを捨てる */
export function resetSpotAutoLinkCache(): void {
    cached = null;
    memo.clear();
}

/** iOS が読む表の中身（`/app/data/spot-photo-links.json`）。形は `SpotPhotoLinks` で固定 */
export type SpotPhotoLinks = { v: 1; links: Record<string, string> };

export function spotPhotoLinksJson(photos: readonly Photo[]): string {
    const body: SpotPhotoLinks = { v: 1, links: autoLinksFor(photos) };
    return JSON.stringify(body);
}
