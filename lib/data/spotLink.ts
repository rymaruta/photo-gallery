// lib/data/spotLink.ts
//
// **公式スポットの台帳から、画面が実際に使う項目だけを取り出す。**
//
// ## なぜ要るのか（実測）
//
// 🔴 `content/spots.json` は**人が書く棚**で、1件ごとに概要・見どころ・
// 季節・時間帯・構図・注意点・アクセス・出典まで持つ。ところが
// `lib/data/spots.ts` は `import spotsJson from "@/content/spots.json"` で
// **丸ごと**読むので、`"use client"` のファイルがここから `SPOTS` を
// 読むと**その全文がクライアントのチャンクに入る**。
//
// 台帳に1件だけ入れてビルドして数えた（2026-09-23）:
//
//     クライアントのチャンクに載っていた台帳の中身
//       49896f429396482b.js  → out/saved-spots.html
//       59b11b77059e2248.js  → out/photo/*.html      ← **写真ページ30枚すべて**
//
// 写真ページは**検索の着地点**で、CLAUDE.md の優先度（表示速度）に直接当たる。
// **JSON のモジュールは項目単位で落とせない**（台帳 `3ed31141` が
// `photos.json` で同じことを踏んで `photo-index.json` を作った）ので、
// 減らす手は1つ——**クライアントから台帳を import しない**。
//
// ## 使い方
//
// **この関数を呼んでよいのはサーバー側（`page.tsx` など）だけ。**
// 解いた結果（下の `SpotLink`）を props で画面へ渡す。
// 見張りは `app/__tests__/spotLedgerClientImport.test.ts`——`"use client"` の
// ファイルが `SPOTS` を値として import していたら落ちる。

import { SPOTS, type Spot } from "./spots";
import { publishableSpots, usesMapHero, needsVisibleCredit } from "../utils/spotGuide";

/**
 * 画面がスポットへリンクするのに要る項目**だけ**。
 *
 * ここに項目を足すときは「本当に画面が読むか」を確かめること
 * ——足したぶんが写真ページ30枚のチャンクに乗る。
 */
export type SpotLink = {
    slug: string;
    name: string;
    /** 「香川県 観音寺市」。無ければ空文字 */
    region: string;
    /** 1〜2行の紹介。**カードで2行に切って出す**（長文の `description` は渡さない） */
    summary?: string;
    coords?: { lat: number; lng: number };
    /**
     * 代表写真。**権利が確認できているものだけ**（判断はサーバー側で済ませる）。
     * `null` なら画面は「写真なし」を出す。
     */
    cover: { src: string; alt: string; credit: string | null } | null;
};

/** 台帳の1件を、画面に渡す形へ落とす */
export function toSpotLink(spot: Spot): SpotLink {
    // **出すかどうかの判断はここで済ませる。** 画面に `spotGuide` の判定を
    // 持ち込むと、判断が2か所に散る（このリポジトリが何度も踏んでいる形）
    const cover = usesMapHero(spot) || !spot.coverImage
        ? null
        : {
            src: spot.coverImage.src,
            alt: spot.coverImage.alt,
            credit: needsVisibleCredit(spot)
                ? (spot.coverImage.requiredCreditText || spot.coverImage.credit)
                : null,
        };
    return {
        slug: spot.slug,
        name: spot.name,
        region: [spot.region?.prefecture, spot.region?.city].filter(Boolean).join(" "),
        summary: spot.summary,
        coords: spot.coords,
        cover,
    };
}

/**
 * 写真が指しているスポット。**`spotId` でしか照合しない。**
 *
 * owner の指示書 第11章:「写真の `location` 文字列が似ているだけで、未確認の
 * スポットへ紐付けないでください」。`spotId` は人が確認したものしか入らない。
 */
export function spotLinkForPhoto(spotId: string | undefined | null): SpotLink | null {
    if (!spotId) return null;
    const spot = publishableSpots(SPOTS).find((s) => s.spotId === spotId);
    return spot ? toSpotLink(spot) : null;
}

/**
 * 地図に立てる公式スポット。**座標を持つものだけ。**
 *
 * `SpotLink` から `coords` を必須にしただけの形にするのは、地図側が
 * 「無いかもしれない」を毎回ほどかずに済むため（ピンは座標が無いと立たない）。
 */
export type SpotPin = {
    slug: string;
    name: string;
    region: string;
    lat: number;
    lng: number;
    /**
     * 代表写真。**権利が確認できているものだけ**（判断はサーバー側で済ませる）。
     * `null` なら画面は写真の枠を出さない。
     *
     * ⚠️ **足す項目は「本当に画面が読むか」を確かめてから。** ここに入れた
     * ぶんが `/map` のチャンクに、スポットの数だけ乗る。
     */
    cover: SpotLink["cover"];
};

/** 地図に立てられる公式スポット（公開条件を満たし、座標を持つもの） */
export function spotPins(): SpotPin[] {
    const out: SpotPin[] = [];
    for (const spot of publishableSpots(SPOTS)) {
        if (!spot.coords) continue;
        const { slug, name, region, cover } = toSpotLink(spot);
        out.push({ slug, name, region, cover, lat: spot.coords.lat, lng: spot.coords.lng });
    }
    return out;
}

/** 公開してよいスポットを、スラッグで引ける形にして全部返す */
export function spotLinksBySlug(): Record<string, SpotLink> {
    const out: Record<string, SpotLink> = {};
    for (const spot of publishableSpots(SPOTS)) out[spot.slug] = toSpotLink(spot);
    return out;
}

/**
 * 公開してよいスポットを、**台帳の鍵（`spotId`）で引ける形**にして全部返す。
 *
 * 旅行プラン（`api-user/src/tripPlans.ts`）が保存するのは `spotId` で、
 * スラッグではない——`spots.ts` が書いているとおり、**スラッグは URL に
 * 出る綴りで、鍵は改名しても変わらない**。保存するものは鍵の方に寄せる。
 *
 * `SpotLink` に `spotId` を足さないのは、あの型が**写真ページ30枚の
 * チャンクに乗る**ため（同ファイル冒頭の実測）。引ける形を作るだけにする。
 */
export function spotLinksById(): Record<string, SpotLink> {
    const out: Record<string, SpotLink> = {};
    for (const spot of publishableSpots(SPOTS)) out[spot.spotId] = toSpotLink(spot);
    return out;
}
