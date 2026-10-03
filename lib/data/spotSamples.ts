// lib/data/spotSamples.ts（サーバー専用）
//
// **撮影地ページの「作例」（Wikimedia Commons の自由に使える写真）。**（2026-10-03）
//
// `scripts/collect-commons-samples.mjs` が候補（`content/spot-samples.candidates.json`）を集め、
// 採用した分だけを `content/spot-samples.json`（spotId → 最大6枚）に書く。**画面とアプリが
// 読むのは確定ファイルだけ**。確定ファイルは手で足し引きしてよい（人が選んだ1枚は
// `pickedBy` に人の名前）。決まりは `docs/spot-samples-commons.md`。
//
// 🔴 **作者・ライセンス・出典を必ず一緒に出す。** CC BY・CC BY-SA は作者とライセンス
// （文面へのリンク）と出典の表示が使う条件。この3つのどれかが欠けた1枚は、ここで落とす
// ——画面が表示を忘れる余地を作らない。
//
// 画像は Commons のサムネイル（upload.wikimedia.org）をそのまま使う。こちらで複製しないので、
// 元画像の位置情報（EXIF の GPS）をこちらが配ることはない。画面が出す位置は台帳の座標だけ。
//
// 🔴 台帳と同じく JSON を値で読む。**`"use client"` から import しない**（型だけは可）。

import raw from "@/content/spot-samples.json";
import { coverLicenseOf, cleanAuthor } from "./spotImages";
import type { Spot } from "./spots";
import { isPublished } from "@/lib/utils/spotGuide";
import {
    cleanCommonsAuthor, isPlaceholderAuthor, isUsOnlyPublicDomain, EVENT_OR_PERSON, isEventSpot, standardThumbOf, hasPdBasis,
} from "@/lib/utils/commonsAttribution.mjs";

/** 確定ファイルの1枚（手で書く形） */
export type SpotSampleRecord = {
    /** Commons のファイル名（"File:…"） */
    file: string;
    /** Commons のファイルのページ（出典のリンク先） */
    pageUrl: string;
    /** 表示に使うサムネイル（upload.wikimedia.org・横 1280px まで） */
    thumbUrl: string;
    width: number;
    height: number;
    author: string;
    /** Commons の `LicenseShortName`（例 "CC BY-SA 4.0"） */
    license: string;
    licenseUrl?: string;
    /**
     * ライセンスのテンプレートの名前（例 "cc-by-sa-4.0"）。**パブリックドメインは根拠のテンプレート**
     * （例 "PD-self" "PD-Japan" "PD-USGov-POTUS"）——extmetadata の License は根拠を問わず "pd" なので、
     * 収集スクリプトがページのテンプレートから書く（`--refresh-licenses`・`pdBasisOf`）
     */
    licenseCode?: string;
    dateTimeOriginal?: string;
    /** 人物の権利の印（Restrictions・カテゴリ）があった。表示しない */
    personality?: boolean;
    /** 選んだ主体。"auto" は収集スクリプトの規則、"visual-review" は目で見て選んだもの、それ以外は人の名前 */
    pickedBy: string;
};

export type SpotSamplesFile = Record<string, { slug: string; name: string; samples: SpotSampleRecord[] }>;

/** 画面とアプリに渡す1枚（表示に要る項目だけ・必ず題と作者とライセンスと出典を持つ） */
export type SpotSample = {
    src: string;
    width: number;
    height: number;
    /** 題（Commons のファイル名から "File:" と拡張子を除いたもの） */
    title: string;
    author: string;
    /** 表示する名前。パブリックドメインは根拠を添える（例 "Public domain (PD-self)"） */
    license: string;
    /** ライセンスの文面（https）。パブリックドメインなど URL の無いものは持たない */
    licenseUrl?: string;
    /** Commons のファイルのページ */
    sourceUrl: string;
    /** 撮影日時（Commons の書き方のまま） */
    takenAt?: string;
};

export const SPOT_SAMPLES: Readonly<SpotSamplesFile> = raw as SpotSamplesFile;

/** 画面に出す最大の枚数 */
export const MAX_SHOWN_SAMPLES = 6;

/** 作者が分からないときの表記（パブリックドメイン・CC0 だけに許す） */
export const UNKNOWN_AUTHOR = "作者不明";

/** パブリックドメインの印（Public Domain Mark）。構造化データの `license` に使う */
export const PUBLIC_DOMAIN_MARK_URL = "https://creativecommons.org/publicdomain/mark/1.0/";

const isHttps = (u: unknown): u is string => typeof u === "string" && /^https:\/\/[^\s]+$/.test(u);
const isCommonsPage = (u: string) => /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(u);
const isCommonsUpload = (u: string) => /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//.test(u);
const isCommonsThumb = (u: string) => /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\//.test(u);

/**
 * ライセンスの種類。Commons の短い名前は "CC BY-SA 4.0" と "CC-BY-SA-3.0" の両方の書き方が
 * あるので、区切りをそろえてから `coverLicenseOf`（代表写真と同じ判定）に掛ける。
 * 表示の名前に添えた根拠（"Public domain (PD-self)" の括弧）は見ない。
 * NC（商用不可）・ND（改変不可）・その他は undefined
 */
export function sampleLicenseKind(label: string | undefined) {
    const s = String(label ?? "").trim().replace(/\s*\([^()]*\)$/, "")
        .replace(/^cc[-\s]by[-\s]sa(?=[-\s]|$)/i, "CC BY-SA")
        .replace(/^cc[-\s]by(?=[-\s]|$)/i, "CC BY");
    return coverLicenseOf(s);
}

/** Commons のファイル名から題を作る（"File:" と拡張子を除き、"_" を空白に） */
export function titleFromFile(file: string): string {
    return String(file ?? "").replace(/^File:/i, "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/_/g, " ").trim();
}

/**
 * 1枚を表示の形へ。**出してはいけない1枚は undefined**:
 *   - ライセンスが CC0・パブリックドメイン・CC BY・CC BY-SA でない（NC・ND・その他）
 *   - アメリカだけのパブリックドメイン（PD-US 系）
 *   - パブリックドメインなのに根拠のテンプレート（licenseCode の "PD-…"）が分からない
 *     （"Public domain" だけでは PD-US と見分けられない）
 *   - 作者が空・決まり文句（「推定されます」「Own work」「Unknown author」…）・お願い文
 *     （CC BY 系は表示が条件なので出せない。パブリックドメイン・CC0 は「作者不明」と出す）
 *   - 人物の権利の印がある
 *   - 画像が Commons でない・縮小版にできない・出典が Commons のファイルのページでない
 *   - CC BY 系なのにライセンスの文面の URL が無い
 *
 * 🔴 確定ファイルに既に入っている行にも効く（収集し直さなくても、表示のところで守る）
 */
export function toSpotSample(r: SpotSampleRecord): SpotSample | undefined {
    const kind = sampleLicenseKind(r.license);
    if (!kind) return undefined;
    if (isUsOnlyPublicDomain(r.license, r.licenseCode)) return undefined;
    if (kind === "public-domain" && !hasPdBasis(r.licenseCode)) return undefined;
    if (r.personality) return undefined;
    const byLicense = kind === "cc-by" || kind === "cc-by-sa";
    let author = cleanCommonsAuthor(cleanAuthor(String(r.author ?? "")));
    if (isPlaceholderAuthor(author)) {
        if (byLicense) return undefined;
        author = UNKNOWN_AUTHOR;
    }
    let src = String(r.thumbUrl ?? "").replace(/^http:\/\//, "https://");
    let width = r.width;
    let height = r.height;
    const sourceUrl = String(r.pageUrl ?? "").replace(/^http:\/\//, "https://");
    if (!isHttps(src) || !isCommonsUpload(src)) return undefined;
    if (!isHttps(sourceUrl) || !isCommonsPage(sourceUrl)) return undefined;
    if (!(width > 0) || !(height > 0)) return undefined;
    // 元画像の URL（元が 1280px 以下のとき API が返す）は、標準の幅の縮小版に替える
    if (!isCommonsThumb(src)) {
        const small = standardThumbOf(src, width, height);
        if (!small) return undefined;
        ({ url: src, width, height } = small);
    }
    const licenseUrl = r.licenseUrl ? r.licenseUrl.replace(/^http:\/\//, "https://") : undefined;
    if (byLicense && !isHttps(licenseUrl)) return undefined;
    const title = titleFromFile(r.file) || titleFromFile(decodeURIComponent(sourceUrl.replace(/^.*\/wiki\//, "")));
    if (!title) return undefined;
    return {
        src,
        width,
        height,
        title,
        author,
        license: kind === "public-domain" ? `${r.license.trim()} (${r.licenseCode!.trim()})` : r.license.trim(),
        ...(isHttps(licenseUrl) ? { licenseUrl } : {}),
        sourceUrl,
        ...(r.dateTimeOriginal?.trim() ? { takenAt: r.dateTimeOriginal.trim() } : {}),
    };
}

/** 人（または目で見て選ぶ作業）が選んだ1枚か。"auto" は機械の規則 */
export function isReviewedPick(r: Pick<SpotSampleRecord, "pickedBy">): boolean {
    return typeof r.pickedBy === "string" && r.pickedBy.trim() !== "" && r.pickedBy.trim() !== "auto";
}

/**
 * **そのスポットの作例**（表示してよいものだけ・最大6枚）。
 * 下書きには付けない（本文と同じく、誰も確かめていないページに足さない）。
 *
 * - `exclude` は代表写真の出典 URL など、同じ写真を2度出さないためのもの
 * - `reviewedOnly` は人が選んだ1枚だけ（いまは使っていない。構造化データも画面と同じ全部を入れる）
 * - **人や催しが主役の写真**（Festival・Rallye・ポートレート…）は落とす。撮影地が催しそのものなら残す
 */
export function spotSamples(
    spot: Pick<Spot, "spotId"> & Partial<Spot>,
    opts: { file?: Readonly<SpotSamplesFile>; exclude?: (string | undefined)[]; reviewedOnly?: boolean } = {},
): SpotSample[] {
    if (!isPublished(spot as Spot)) return [];
    const file = opts.file ?? SPOT_SAMPLES;
    const skip = new Set(opts.exclude?.filter(Boolean));
    const eventSpot = isEventSpot(spot);
    const seen = new Set<string>();
    const out: SpotSample[] = [];
    for (const r of file[spot.spotId]?.samples ?? []) {
        if (opts.reviewedOnly && !isReviewedPick(r)) continue;
        if (!eventSpot && EVENT_OR_PERSON.test(`${r.file ?? ""}`)) continue;
        const s = toSpotSample(r);
        if (!s || skip.has(s.sourceUrl) || seen.has(s.sourceUrl)) continue;
        seen.add(s.sourceUrl);
        out.push(s);
        if (out.length >= MAX_SHOWN_SAMPLES) break;
    }
    return out;
}

/**
 * 構造化データ（JSON-LD）の `ImageObject`。題・ライセンス・出典・表示の文字を必ず書く。
 * 画面に出す作例は**全部**ここを通す（自動で選んだものも。`SpotGuidePage`）。
 * - 作者は**分かるときだけ** `creator`（「作者不明」のパブリックドメイン・CC0 は `creditText` にだけ出る）。
 *   人か団体かは分からないので型（Person）を断定しない
 * - パブリックドメインは Public Domain Mark の URL を `license` に
 */
export function sampleImageObject(s: SpotSample) {
    const license = s.licenseUrl ?? (sampleLicenseKind(s.license) === "public-domain" ? PUBLIC_DOMAIN_MARK_URL : undefined);
    return {
        "@type": "ImageObject",
        name: s.title,
        contentUrl: s.src,
        width: s.width,
        height: s.height,
        ...(s.author !== UNKNOWN_AUTHOR ? { creator: { name: s.author } } : {}),
        creditText: `${s.author} / ${s.license} / Wikimedia Commons`,
        ...(license ? { license } : {}),
        acquireLicensePage: s.sourceUrl,
    };
}
