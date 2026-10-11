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
import type { Spot, SpotCoverImage, SpotImageLicense } from "./spots";
import { isPublished } from "@/lib/utils/spotGuide";
import { isUnusablePublicDomain } from "@/lib/utils/commonsAttribution.mjs";

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
    /**
     * **サイトの中に置いた縮小版**（横 960px の JPEG・`scripts/localize-spot-images.mjs`）。
     * Web のページはこれだけを代表写真に使う（外部へのホットリンクはしない）
     */
    local?: { src: string; width: number; height: number };
    /**
     * 作例から昇格させた行（`method: "commons-sample"`・2026-10-11）だけが持つ。作例の `pickedBy`
     * をそのまま写す（"visual-review"＝写真を1枚ずつ見てその撮影地の景色と確かめた・人の名前）。
     * **"auto"（名前の一致だけ）は昇格させない**（`shownSpotImage` が落とす）
     */
    pickedBy?: string;
    /** 作例のライセンスのテンプレート名（パブリックドメインの根拠など。作例の `licenseCode` の写し） */
    licenseCode?: string;
    /** 昇格で置き換えた Wikidata の代表画像の記録（場所の確認が無く出していなかったもの）。消さずに残す */
    replaced?: Omit<SpotImage, "local" | "replaced">;
};

/**
 * **作例から昇格させた代表写真**の `method`（2026-10-11・owner「検索で見つけてもらう」）。
 * Wikidata の代表画像が無い・場所の確認が無くて出せないスポットに、`content/spot-samples.json` の
 * 作例のうち**写真を見て場所を確かめたもの**（`isReviewedPick`）を1枚、代表写真に上げた行。
 * 選ぶのは `coverCandidateSample`（`lib/data/spotSamples.ts`）、置くのは
 * `scripts/promote-sample-covers.ts`（縮小版は `localize-spot-images.mjs` と同じ処理で置く）
 */
export const SAMPLE_COVER_METHOD = "commons-sample";

/**
 * 人（または写真を1枚ずつ見て選ぶ作業）が選んだ1枚か。"auto" は機械の規則（名前の一致だけ）。
 * 作例（`SpotSampleRecord.pickedBy`）と、作例から昇格させた代表写真（`SpotImage.pickedBy`）で同じ1本
 */
export function isReviewedPick(r: { pickedBy?: string | null }): boolean {
    return typeof r.pickedBy === "string" && r.pickedBy.trim() !== "" && r.pickedBy.trim() !== "auto";
}

export const SPOT_IMAGES: Readonly<Record<string, SpotImage>> = raw as Record<string, SpotImage>;

/** 人が確かめた写真だけを返す（無ければ undefined） */
export function reviewedSpotImage(
    slug: string,
    images: Readonly<Record<string, SpotImage>> = SPOT_IMAGES,
): SpotImage | undefined {
    const image = images[slug];
    return image && image.reviewedBy?.trim() ? image : undefined;
}

/**
 * **画面・アプリに出してよい写真**（無ければ undefined）。
 *
 * 下書きには付けない（本文と同じく誰も確かめていない行）。出すのは
 * **人が確かめた写真**か、**AI 照合で写真も照らしたもの**（座標のずれ無し）だけ
 */
export function shownSpotImage(
    spot: Spot,
    images: Readonly<Record<string, SpotImage>> = SPOT_IMAGES,
): SpotImage | undefined {
    if (!isPublished(spot)) return undefined;
    const reviewed = reviewedSpotImage(spot.slug, images);
    if (reviewed) return reviewed;
    const image = images[spot.slug];
    // 作例から昇格させた行は、その作例を見て場所を確かめたものだけ（2026-10-11）
    // 2026-10-11 レビュー: 作例の表示と同じく、使えないパブリックドメイン（PD-US 系・PD-Detroit・
    // Flickr の Public Domain Mark）は出さない
    if (image?.method === SAMPLE_COVER_METHOD) {
        return isReviewedPick(image) && !isUnusablePublicDomain(image.license, image.licenseCode) ? image : undefined;
    }
    return spot.aiCheck?.imageChecked === true && image && !image.coordsMismatch ? image : undefined;
}

/** Commons のライセンスの短い名前を、代表写真の利用根拠へ。使えないものは undefined */
export function coverLicenseOf(shortName: string): SpotImageLicense | undefined {
    const s = shortName.trim().toLowerCase();
    // **商用不可（NC）・改変不可（ND）は、どの書き方でも先に落とす**
    // （"CC BY-SA-NC"・"CC BY NC" のように順番や区切りが揺れても通さない）
    if (/\bnc\b|\bnd\b/.test(s.replace(/-/g, " "))) return undefined;
    if (/^cc0\b/.test(s)) return "cc0";
    if (s === "public domain" || s === "pd" || /^pd[-\s]/.test(s)) return "public-domain";
    if (/^cc by-sa\b/.test(s)) return "cc-by-sa";
    if (/^cc by\b/.test(s)) return "cc-by";
    return undefined;
}

/**
 * ライセンスの表示名から利用根拠（`coverLicenseOf` の前に書き方をそろえる）。
 * Commons の短い名前は "CC BY-SA 4.0" と "CC-BY-SA-3.0" の両方があり、作例の表示名は
 * パブリックドメインの根拠を括弧で添える（"Public domain (PD-self)"）。括弧は見ない
 */
export function licenseKindOf(label: string | undefined): SpotImageLicense | undefined {
    const s = String(label ?? "").trim().replace(/\s*\([^()]*\)$/, "")
        .replace(/^cc[-\s]by[-\s]sa(?=[-\s]|$)/i, "CC BY-SA")
        .replace(/^cc[-\s]by(?=[-\s]|$)/i, "CC BY");
    return coverLicenseOf(s);
}

/** Commons のファイル名から題を作る（"File:" と拡張子を除き、"_" を空白に）。作例と代表写真で同じ1本 */
export function titleFromFile(file: string): string {
    return String(file ?? "").replace(/^File:/i, "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/_/g, " ").trim();
}

/** 作者の欄に残る Wiki の書き方（「( talk )」）を落とす。それ以外は作者の求める表記のまま */
export function cleanAuthor(author: string): string {
    return author.replace(/\s*\(\s*talk\s*\)\s*$/i, "").trim();
}

/**
 * **スポットのページの代表写真**。台帳が自前の `coverImage` を持てばそれを優先し、
 * 無ければ Commons の写真を**サイト内に置いた縮小版**（`local`）から組み立てる。
 * 置いていない・ライセンスが読めない写真は使わない（地図の代わりの見た目のまま）
 */
export function spotCoverImage(
    spot: Spot,
    images: Readonly<Record<string, SpotImage>> = SPOT_IMAGES,
): SpotCoverImage | undefined {
    if (spot.coverImage) return spot.coverImage;
    const image = shownSpotImage(spot, images);
    const license = image && licenseKindOf(image.license);
    if (!image?.local || !license) return undefined;
    return {
        src: image.local.src,
        alt: spot.name,
        // 題（2026-10-11 レビュー）: CC BY / BY-SA の 1.0〜3.0 は題（作品名）の表示が条件。作例と同じく
        // Commons のファイル名から作る
        ...(titleFromFile(image.file) ? { title: titleFromFile(image.file) } : {}),
        aspectRatio: image.local.width / image.local.height,
        credit: cleanAuthor(image.author),
        license,
        sourceUrl: image.pageUrl,
        // CC BY・CC BY-SA は作者・ライセンス（文面へのリンク）・出典の表示が条件
        licenseLabel: image.license,
        licenseUrl: image.licenseUrl ? image.licenseUrl.replace(/^http:\/\//, "https://") : undefined,
        checkedAt: image.reviewedAt ?? spot.aiCheck?.checkedAt ?? image.fetchedAt,
        verifiedPlace: true,
    };
}
