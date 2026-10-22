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
import coverExclusions from "@/content/spot-cover-exclusions.json";
import rawSampleExclusions from "@/content/spot-sample-exclusions.json";
import type { Spot, SpotCoverImage, SpotImageLicense } from "./spots";
import { isPublished } from "@/lib/utils/spotGuide";
import { UNKNOWN_AUTHOR_LABEL, cleanCommonsAuthor, hasPlaceholderPhrase, isUnusablePublicDomain } from "@/lib/utils/commonsAttribution.mjs";

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
     * **同じ写真の横 1,200px 以上の版**（Commons の標準の縮小版・横 1280px。2026-10-22・SEO）。
     * 書くのは `scripts/spot-cover-large.mjs`（Commons の API が返した寸法をそのまま写す。画像は落とさない）。
     * 使うのは og:image・構造化データ・画像サイトマップだけ（`spotCoverLarge`）。ページの `<img>` は
     * `local` のまま（外へのホットリンクをしない・LCP を変えない）
     */
    large?: { src: string; width: number; height: number };
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

/**
 * 🔴 **パノラマの自由が無い国の、著作権の残る現代建築・作品が主役の代表写真**（2026-10-11）。
 * 写真のライセンスが自由でも、写っている建物・作品（建築家・作者の死後 50〜70 年）の権利は別にある。
 * パノラマの自由（公共の場に恒久的に置かれた建物・作品を撮った写真を自由に使える決まり）が無い国では、
 * 建物・作品が主役の写真は権利者の許しが要る（Commons の COM:FOP・国ごとの表は
 * Commons:Freedom of panorama/table。UAE・韓国・ベトナム・フランス…）。
 *
 * ここに載せたスポットは**代表写真を出さない**（`shownSpotImage`）し、**作例からも上げない**
 * （`coverCandidateSample`）。建物そのものが撮影地なので、建物が主役でない別の1枚には替えられない。
 * 一覧と理由は `content/spot-cover-exclusions.json`（`scripts/localize-spot-images.mjs` も読む）。
 * 決め方と一覧の作り方は `docs/spot-samples-commons.md`「パノラマの自由が無い国の現代建築」
 */
export const NO_FOP_COVER_EXCLUSIONS: Readonly<Record<string, string>> = coverExclusions.covers;

/**
 * 🔴 **表示から落とす作例**（2026-10-11・パノラマの自由が無い国の、著作権の残る建物・作品が主役の写真）。
 * 確定ファイルの行は消さず、表示（`spotSamples`・代表写真 `shownSpotImage`・代表写真の候補 `coverCandidateSample`）で落とす。
 * 収集（`scripts/collect-commons-samples.mjs`）も「人の目で外した写真」と同じく二度と選ばない。
 * 一覧と理由は `content/spot-sample-exclusions.json`、決め方は `docs/spot-samples-commons.md`
 * 「パノラマの自由が無い国の現代建築」
 */
export type SpotSampleExclusion = { spotId: string; file: string; reason: string };
export const SPOT_SAMPLE_EXCLUSIONS: readonly SpotSampleExclusion[] = rawSampleExclusions.samples;

/** ファイル名を比べる形（"File:" の有無・"_" と空白の揺れを吸収。収集の `fileKey` と同じ考え方） */
function sampleFileKey(file: string | null | undefined): string {
    return String(file ?? "").normalize("NFC").replace(/_/g, " ").replace(/\s+/g, " ").trim().replace(/^(file|ファイル)\s*:\s*/i, "");
}

const EXCLUDED_SAMPLE_KEYS = new Set(SPOT_SAMPLE_EXCLUSIONS.map((e) => `${e.spotId}\n${sampleFileKey(e.file)}`));

/** このスポットの、この作例は表示から落とすものか */
export function isExcludedSample(spotId: string, r: { file?: string | null }): boolean {
    return Boolean(r.file) && EXCLUDED_SAMPLE_KEYS.has(`${spotId}\n${sampleFileKey(r.file)}`);
}

/** パノラマの自由が無い国の現代建築・作品が主役で、代表写真を出さないスポットか */
export function isNoFopCoverExcluded(slug: string | undefined): boolean {
    return typeof slug === "string" && Object.prototype.hasOwnProperty.call(NO_FOP_COVER_EXCLUSIONS, slug);
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
    const image = shownSpotImageUnchecked(spot, images);
    // 作者の欄が名前でない（「Own work」・お願い文の前置き…）CC BY・CC BY-SA は、作者の表示が条件なので
    // 出さない（2026-10-11）。パブリックドメイン・CC0 は「作者不明」と出す（`spotImageCredit`）
    if (image && missingRequiredCredit(image)) return undefined;
    return image;
}

/** CC BY 系なのに作者の欄が名前でないか */
function missingRequiredCredit(image: SpotImage): boolean {
    const kind = licenseKindOf(image.license);
    return (kind === "cc-by" || kind === "cc-by-sa") && hasPlaceholderPhrase(cleanAuthor(image.author));
}

/**
 * **代表写真の作者の表記**（Web のページとアプリの索引で同じ1本）。飾りを落とし（`cleanAuthor`）、
 * 名前でない欄（パブリックドメイン・CC0 のときだけここまで来る）は「作者不明」
 */
export function spotImageCredit(image: Pick<SpotImage, "author">): string {
    const credit = cleanAuthor(image.author);
    return hasPlaceholderPhrase(credit) ? UNKNOWN_AUTHOR_LABEL : credit;
}

function shownSpotImageUnchecked(
    spot: Spot,
    images: Readonly<Record<string, SpotImage>>,
): SpotImage | undefined {
    if (!isPublished(spot)) return undefined;
    // パノラマの自由が無い国の現代建築（人が確かめた写真でも出さない・2026-10-11）
    if (isNoFopCoverExcluded(spot.slug)) return undefined;
    // 作例として表示から落とした1枚は、代表写真にも出さない（作例から上げた行・Wikidata の行とも）
    if (images[spot.slug] && isExcludedSample(spot.spotId, images[spot.slug])) return undefined;
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

/**
 * 作者の欄に残る Wiki の書き方（「( talk )」「en:User:」…）・後ろのライセンスの文を落とす。
 * それ以外は作者の求める表記のまま。規則は作例と同じ1本（`cleanCommonsAuthor`・2026-10-11）
 */
export function cleanAuthor(author: string): string {
    return cleanCommonsAuthor(String(author ?? "").replace(/\s*\(\s*talk\s*\)\s*$/i, ""));
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
    const credit = spotImageCredit(image);
    return {
        src: image.local.src,
        alt: spot.name,
        // 題（2026-10-11 レビュー）: CC BY / BY-SA の 1.0〜3.0 は題（作品名）の表示が条件。作例と同じく
        // Commons のファイル名から作る
        ...(titleFromFile(image.file) ? { title: titleFromFile(image.file) } : {}),
        aspectRatio: image.local.width / image.local.height,
        credit,
        license,
        sourceUrl: image.pageUrl,
        // CC BY・CC BY-SA は作者・ライセンス（文面へのリンク）・出典の表示が条件
        licenseLabel: image.license,
        licenseUrl: image.licenseUrl ? image.licenseUrl.replace(/^http:\/\//, "https://") : undefined,
        checkedAt: image.reviewedAt ?? spot.aiCheck?.checkedAt ?? image.fetchedAt,
        verifiedPlace: true,
    };
}

/**
 * **検索に渡す画像の幅の下限**（2026-10-22）。Google の画像検索・Discover は横 1,200px 以上の画像を
 * 大きく出す（`max-image-preview:large` と組み・`pageRobots`）。`scripts/spot-cover-large.mjs` の `MIN_WIDTH` と同じ
 */
export const SEO_IMAGE_MIN_WIDTH = 1200;

/** Commons の画像の URL の元のファイル名（比べる形）。縮小版でも元画像でも */
function uploadFileKey(url: string): string | undefined {
    const m = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)(?:\/[^/]+)?$/.exec(url);
    if (!m) return undefined;
    try {
        return sampleFileKey(decodeURIComponent(m[1]));
    } catch {
        return undefined;
    }
}

/**
 * **代表写真の横 1,200px 以上の版**（og:image・構造化データ・画像サイトマップ用）。無ければ undefined。
 *
 * 画面に代表写真を出しているとき（`spotCoverImage` が Commons の写真から組む＝`local` がある）だけ。
 * 記録（`large`）が**同じファイル**の Commons の画像で、横 `SEO_IMAGE_MIN_WIDTH` 以上のときだけ返す
 * ——別の写真・小さい版を「大きい代表写真」として渡さない
 */
export function spotCoverLarge(
    spot: Spot,
    images: Readonly<Record<string, SpotImage>> = SPOT_IMAGES,
): { src: string; width: number; height: number } | undefined {
    if (spot.coverImage) return undefined;
    const image = shownSpotImage(spot, images);
    if (!image?.local || !spotCoverImage(spot, images)) return undefined;
    const large = image.large;
    if (!large || !(large.width >= SEO_IMAGE_MIN_WIDTH) || !(large.height > 0)) return undefined;
    const key = uploadFileKey(String(large.src ?? ""));
    if (!key || key !== sampleFileKey(image.file)) return undefined;
    return { src: large.src, width: large.width, height: large.height };
}

/** 画面に出している代表写真（サイトに置いた縮小版）の寸法。台帳の `coverImage` は寸法を持たないので undefined */
export function spotCoverSize(
    spot: Spot,
    images: Readonly<Record<string, SpotImage>> = SPOT_IMAGES,
): { width: number; height: number } | undefined {
    if (spot.coverImage) return undefined;
    const local = shownSpotImage(spot, images)?.local;
    return local && spotCoverImage(spot, images) ? { width: local.width, height: local.height } : undefined;
}
