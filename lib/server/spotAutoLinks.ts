// lib/server/spotAutoLinks.ts
//
// **自動の結び（`lib/utils/spotAutoLink.ts`）を静的な生成で使う口**（2026-10-31・journey.photo-ios#425）。
//
// 台帳（`SPOTS`）から索引を1回だけ作る。撮影スポットの頁は約 2,700 枚建ち、頁ごとに
// `loadAllPhotos()` が写真を読み直す（毎回新しい配列）ので、2段で覚える:
//
//   - **表（`autoLinksFor`）**: 読み込んだ配列ごとに1回（`WeakMap`）。中身が前の読み込みと同じなら
//     （写真ごとの id・`updatedAt`・`spotId`・`spotAuto`・公開・撮影地・位置を並べた鍵が同じ）前の表を
//     そのまま返す——頁ごとに全件の並べ替え・突き合わせをやり直さない
//   - **写真1枚の答え（`ruleSpotIdFor`・写真の詳細）**: 写真 id ごと。鍵は決まりに効く項目
//     （撮影地・題・説明・位置・`geoApprox`。`signature()`）で、`spotId`・`spotAuto` は見ない
//     （それは `autoSpotIdFor` が別に見る）

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
    return JSON.stringify([p.location ?? "", p.title ?? "", p.description ?? "", p.coords ?? null, !!p.geoApprox]);
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

/** 自動で結ぶ先（`spotId` を持つ・本人が外した・非公開の写真は `null`。表 `autoLinksFor` と同じ守り） */
export function autoSpotIdForPhoto(photo: Photoish): string | null {
    if (photo.published === false) return null;
    return autoSpotIdFor({ match: () => ruleSpotIdFor(photo) }, photo);
}

const tableByLoad = new WeakMap<readonly Photo[], Record<string, string>>();
let lastTable: { key: string; table: Record<string, string> } | null = null;

/** 読み込みの中身の鍵（安い項目だけ。題・説明が変わる保存は `updatedAt` が変わる） */
function loadKey(photos: readonly Photo[]): string {
    return photos.map((p) => {
        const q = p as Photoish & { updatedAt?: string };
        return [q.id, q.updatedAt ?? "", q.spotId ?? "", q.spotAuto ?? "", q.published === false ? 0 : 1,
            q.location ?? "", q.coords?.lat ?? "", q.coords?.lng ?? "", q.geoApprox ? 1 : 0].join("\u0001");
    }).join("\u0002");
}

/** 写真 id → 撮影スポット id（自動の結びだけ・公開の写真だけ）。読み込みごとに1回だけ作る */
export function autoLinksFor(photos: readonly Photo[]): Record<string, string> {
    const known = tableByLoad.get(photos);
    if (known) return known;
    const key = loadKey(photos);
    const table = lastTable && lastTable.key === key
        ? lastTable.table
        : autoLinkTable({ match: (p) => ruleSpotIdFor(p as Photoish) }, photos as readonly Photoish[]);
    lastTable = { key, table };
    tableByLoad.set(photos, table);
    return table;
}

/** 試験用: 覚えた答えを捨てる */
export function resetSpotAutoLinkCache(): void {
    cached = null;
    memo.clear();
    lastTable = null;
}

/** iOS が読む表の中身（`/app/data/spot-photo-links.json`）。形は `SpotPhotoLinks` で固定 */
export type SpotPhotoLinks = { v: 1; links: Record<string, string> };

export function spotPhotoLinksJson(photos: readonly Photo[]): string {
    const body: SpotPhotoLinks = { v: 1, links: autoLinksFor(photos) };
    return JSON.stringify(body);
}
