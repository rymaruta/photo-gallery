// lib/data/spotFeed.ts（サーバー専用）
//
// **アプリ（iOS）が読む撮影スポットの索引。** `out/app/data/spots.json` として
// ビルド時に1回だけ書き出す（`app/app/data/spots.json/route.ts`）。写真の
// `app/data/photos.json` と同じ「静的なスナップショット」で、API ではない。
//
// ## 載せるもの・載せないもの（2026-09-25）
//
//   載せる    spotId / slug / name / nameEn / reading / region（都道府県・市）/
//             coords（約1km精度）/ category / summary / stage / draftedAt /
//             verifiedAt（人が確かめた行だけ）/
//             image（写真・作者・ライセンス。**owner が写真を確かめた公開済みの行だけ**
//             ・2026-09-26。`lib/data/spotImages.ts`）
//   載せない  description・highlights・季節・時間帯・構図・アクセス・駐車場・
//             注意点・出典（全文 3.5MB。索引は約 0.6MB / gzip 0.2MB）、
//             draftedBy（製品名を画面・アプリに出さない）、verifiedBy
//
// **母集合は `visibleSpots`**（画面と同じ）。**いまは公開済みだけ**が載る
// （`BUILD_DRAFT_SPOTS` が false・owner の判断 2026-09-25）。下書きを建てる設定に
// 戻せば `stage: "review"` の行も載り、アプリは「下書き・未確認」と描く。
//
// 🔴 このモジュールは台帳（`SPOTS`）を値で読む。**`"use client"` から
// import しない**（`app/__tests__/spotLedgerClientImport.test.ts` が見張る）。

import { SPOTS, type Spot } from "./spots";
import { visibleSpots, isVerified, isPublished } from "../utils/spotGuide";
import { SPOT_IMAGES, shownSpotImage, type SpotImage } from "./spotImages";
import { siteConfig } from "../utils/seo";

/**
 * スポットの写真。**作者とライセンスは必ず一緒に出す**（CC BY・CC BY-SA の条件）。
 * `pageUrl` は出典のリンク先（Commons のファイルのページ）
 */
export type SpotFeedImage = {
    url: string;
    author: string;
    license: string;
    licenseUrl?: string;
    pageUrl: string;
};

export type SpotFeedItem = {
    spotId: string;
    slug: string;
    name: string;
    nameEn?: string;
    reading?: string;
    region: { prefecture?: string; city?: string };
    coords?: { lat: number; lng: number };
    category?: string;
    summary?: string;
    /** 運営未確認の下書きか、人が確かめた公開済みか */
    stage: "review" | "published";
    /** 下書きを書いた日（ISO の日付） */
    draftedAt?: string;
    /** 人が最後に確かめた日。`published` のときだけ */
    verifiedAt?: string;
    /** 写真。**公開済みで、owner が写真を確かめた行だけ** */
    image?: SpotFeedImage;
};

/** `undefined` の鍵を落とす（JSON に `"x": null` を出さない・鍵の集合を固定する） */
function compact<T extends object>(obj: T): T {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

/** 台帳の1件を索引の形へ */
export function toSpotFeedItem(spot: Spot, images: Readonly<Record<string, SpotImage>> = SPOT_IMAGES): SpotFeedItem {
    const published = isPublished(spot);
    const verified = isVerified(spot);
    // 出してよい写真の判定は画面と同じ1か所（`shownSpotImage`）
    const image = shownSpotImage(spot, images);
    return compact({
        spotId: spot.spotId,
        slug: spot.slug,
        name: spot.name,
        nameEn: spot.nameEn,
        reading: spot.reading,
        region: compact({ prefecture: spot.region?.prefecture, city: spot.region?.city }),
        coords: spot.coords,
        category: spot.category,
        summary: spot.summary,
        stage: published ? "published" : "review",
        draftedAt: spot.draftedAt,
        verifiedAt: verified ? spot.verifiedAt : undefined,
        image: image
            ? compact({
                // **サイトに置いた縮小版（横 960px）を優先。** 元画像は数MBあり、
                // スポットの画面の大きい写真に使うと重い
                url: image.local ? `${siteConfig.url}${image.local.src}` : image.thumbUrl,
                author: image.author,
                license: image.license,
                licenseUrl: image.licenseUrl || undefined,
                pageUrl: image.pageUrl,
            })
            : undefined,
    });
}

/** 純関数。テストは固定の台帳を渡す */
export function buildSpotFeed(
    spots: readonly Spot[],
    images: Readonly<Record<string, SpotImage>> = SPOT_IMAGES,
): SpotFeedItem[] {
    return visibleSpots(spots).map((s) => toSpotFeedItem(s, images));
}

/** 実際に配る索引 */
export function spotIndexFeed(): SpotFeedItem[] {
    return buildSpotFeed(SPOTS);
}

/** 配る文字列。**minify**（改行・空白を入れない） */
export function spotIndexFeedJson(): string {
    return JSON.stringify(spotIndexFeed());
}
