// lib/data/spotImages.ts（サーバー専用）
//
// **撮影スポットの写真（Wikimedia Commons）。** `scripts/fetch-spot-images.mjs` が
// 各スポットの Wikidata の代表画像を探し、自由に使えるライセンスのものだけを
// `content/spot-images.json` に書く（2026-09-26・988件）。
//
// 🔴 **出すのは owner が「写真が合っている」と確かめた行だけ**（`reviewedBy` に
// 人の名前）。機械は `reviewedBy` を埋めない——台帳の `verifiedBy` と同じ考え方。
// 名前の一致と距離で選んでいるので、別の場所の写真が混ざる余地がある。
//
// CC BY・CC BY-SA は**作者とライセンスの表示が使う条件**。画面は必ず
// `author` と `license` を写真の近くに出す。

import raw from "@/content/spot-images.json";

export type SpotImage = {
    wikidata: string;
    file: string;
    /** Commons のファイルのページ（出典のリンク先） */
    pageUrl: string;
    /** 画面に出す縮小画像（upload.wikimedia.org） */
    thumbUrl: string;
    author: string;
    license: string;
    licenseUrl?: string;
    distanceKm?: number;
    coordsMismatch?: boolean;
    method: string;
    fetchedAt: string;
    /** 写真が合っていると確かめた人の名前。**機械は書かない** */
    reviewedBy: string | null;
    reviewedAt?: string;
};

export const SPOT_IMAGES: Readonly<Record<string, SpotImage>> = raw as Record<string, SpotImage>;

/** 人が確かめた写真だけを返す（無ければ undefined） */
export function reviewedSpotImage(
    slug: string,
    images: Readonly<Record<string, SpotImage>> = SPOT_IMAGES,
): SpotImage | undefined {
    const image = images[slug];
    return image && image.reviewedBy?.trim() ? image : undefined;
}
