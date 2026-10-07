// lib/data/spotFeed.ts（サーバー専用）
//
// **アプリ（iOS）が読む撮影スポットの索引。** `out/app/data/spots.json` として
// ビルド時に1回だけ書き出す（`app/app/data/spots.json/route.ts`）。写真の
// `app/data/photos.json` と同じ「静的なスナップショット」で、API ではない。
//
// ## 載せるもの・載せないもの（2026-09-25）
//
//   載せる    spotId / slug / name / nameEn / reading / region（都道府県・市。**日本の外の行
//             だけ国も**・2026-09-29。アプリの地図の「リスト」が海外を国ごとに分けるため。
//             日本の行には付けない＝無ければ日本——1,000行に「日本」を足して重くしない）/
//             coords（約1km精度）/ category / summary / stage / draftedAt /
//             verifiedAt（人が確かめた行だけ）/
//             image（写真・作者・ライセンス。**owner が写真を確かめた公開済みの行だけ**
//             ・2026-09-26。`lib/data/spotImages.ts`）/
//             seasonalGuide（季節の案内。**公開済みの行だけ**・2026-09-27。アプリの
//             「いつ行く？」と「いまが見頃」が全部の場所の季節を一度に要るため。約 52KB）/
//             timeOfDayGuide（時間帯の案内。**公開済みの行だけ**・2026-10-03。アプリの
//             探すの「時間帯で絞る」が撮影地にも効くよう。本文・台帳と同じ名前・同じ形
//             `[{time, text}]`。季節と同じ書き方）/
//   載せない  description・highlights・構図・アクセス・駐車場・
//             注意点・項目ごとの出典、draftedBy（製品名を画面・アプリに出さない）、verifiedBy・
//             aiCheck（照合日・出典・委任した人）。
//             **本文は場所ごとのファイル**（`/app/data/spots/<slug>.json`・`spotBody.ts`）。
//             AI 照合の出典もそちらの `check` で運ぶ——アプリはスポットの画面で
//             「出典: …（AI 照合 日付）」をそこから出す（`SpotBodyText.checkLine`）。
//             索引にも載せていた時期がある（#210・2026-09-28 に本番へも出た）が、
//             アプリは読んでおらず全件で約 110KB 重くなるだけだったので外した
//
// **母集合は `visibleSpots`**（画面と同じ）。**いまは公開済みだけ**が載る
// （`BUILD_DRAFT_SPOTS` が false・owner の判断 2026-09-25）。下書きを建てる設定に
// 戻せば `stage: "review"` の行も載り、アプリは「下書き・未確認」と描く。
//
// 🔴 このモジュールは台帳（`SPOTS`）を値で読む。**`"use client"` から
// import しない**（`app/__tests__/spotLedgerClientImport.test.ts` が見張る）。

import { SPOTS, type Spot } from "./spots";
import { visibleSpots, isVerified, isPublished } from "../utils/spotGuide";
import { SPOT_IMAGES, cleanAuthor, shownSpotImage, type SpotImage } from "./spotImages";
import { siteConfig } from "../utils/seo";
import legacyFreeze from "../../content/spots-feed-legacy.json";

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
    /** `country` は日本の外の行だけ（無ければ日本） */
    region: { country?: string; prefecture?: string; city?: string };
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
    /** 季節の案内（台帳の文のまま）。**公開済みの行だけ**——下書きの文はアプリに出さない */
    seasonalGuide?: { season: string; text: string }[];
    /** 時間帯の案内（台帳の文のまま）。**公開済みの行だけ**。本文（`spotBody.ts`）と同じ名前・同じ形 */
    timeOfDayGuide?: { time: string; text: string }[];
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
        region: compact({
            country: spot.region?.country && spot.region.country !== "日本" ? spot.region.country : undefined,
            prefecture: spot.region?.prefecture,
            city: spot.region?.city,
        }),
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
                author: cleanAuthor(image.author),
                license: image.license,
                licenseUrl: image.licenseUrl || undefined,
                pageUrl: image.pageUrl,
            })
            : undefined,
        seasonalGuide: published && spot.seasonalGuide?.length
            ? spot.seasonalGuide.map((g) => ({ season: g.season, text: g.text }))
            : undefined,
        timeOfDayGuide: published && spot.timeOfDayGuide?.length
            ? spot.timeOfDayGuide.map((g) => ({ time: g.time, text: g.text }))
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

// ## 古いアプリのための固定（2026-10-07）
//
// この `spots.json` を1つで読むアプリ（2026-10 までの版）のために、**載せる行を 2026-10-07 の
// 公開行（1,079件）に固定する**（`content/spots-feed-legacy.json`）。数千〜数万件に増やす行は
// 新しい置き場（`/app/data/spot-feed/`・`spotFeedShards.ts`）にだけ載る。
// 2026-10-07 判断: 「上限に収まるぶんだけ選ぶ」ではなく「行を固定」にした——選び方が台帳の
// 増減で揺れると、古いアプリで昨日あった場所が今日消える。中身（文・写真）は今の台帳のまま。
// 設計は `docs/spot-feed-sharding.md`

/** 固定した行（`spotId`）。**この一覧は増やさない** */
export const LEGACY_SPOT_IDS: ReadonlySet<string> = new Set((legacyFreeze as { spotIds: string[] }).spotIds);

/**
 * 古いアプリの `spots.json` に載せる行。**固定した一覧に在り、いまも配っている行だけ**。
 * 新しく公開した行は載らない。下書きに戻した行は落ちる
 */
export function legacySpotFeed(items: readonly SpotFeedItem[]): SpotFeedItem[] {
    return items.filter((item) => LEGACY_SPOT_IDS.has(item.spotId));
}

/** 実際に配る索引（古いアプリ向け・固定した行だけ） */
export function spotIndexFeed(): SpotFeedItem[] {
    return legacySpotFeed(buildSpotFeed(SPOTS));
}

/** 配る文字列。**minify**（改行・空白を入れない） */
export function spotIndexFeedJson(): string {
    return JSON.stringify(spotIndexFeed());
}
