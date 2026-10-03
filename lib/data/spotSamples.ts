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
    dateTimeOriginal?: string;
    /** 選んだ主体。"auto" は収集スクリプトの規則、それ以外は人の名前 */
    pickedBy: string;
};

export type SpotSamplesFile = Record<string, { slug: string; name: string; samples: SpotSampleRecord[] }>;

/** 画面とアプリに渡す1枚（表示に要る項目だけ・必ず作者とライセンスと出典を持つ） */
export type SpotSample = {
    src: string;
    width: number;
    height: number;
    author: string;
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

const isHttps = (u: unknown): u is string => typeof u === "string" && /^https:\/\/[^\s]+$/.test(u);
const isCommonsPage = (u: string) => /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(u);
const isCommonsUpload = (u: string) => /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//.test(u);

/**
 * ライセンスの種類。Commons の短い名前は "CC BY-SA 4.0" と "CC-BY-SA-3.0" の両方の書き方が
 * あるので、区切りをそろえてから `coverLicenseOf`（代表写真と同じ判定）に掛ける。
 * NC（商用不可）・ND（改変不可）・その他は undefined
 */
export function sampleLicenseKind(label: string | undefined) {
    const s = String(label ?? "").trim()
        .replace(/^cc[-\s]by[-\s]sa(?=[-\s]|$)/i, "CC BY-SA")
        .replace(/^cc[-\s]by(?=[-\s]|$)/i, "CC BY");
    return coverLicenseOf(s);
}

/**
 * 1枚を表示の形へ。**出してはいけない1枚は undefined**:
 *   - ライセンスが CC0・パブリックドメイン・CC BY・CC BY-SA でない（NC・ND・その他）
 *   - 作者が空（CC BY 系は表示が条件。パブリックドメインは「作者不明」と書いてあればよい）
 *   - 画像が Commons のサムネイルでない・出典が Commons のファイルのページでない
 *   - CC BY 系なのにライセンスの文面の URL が無い
 */
export function toSpotSample(r: SpotSampleRecord): SpotSample | undefined {
    const kind = sampleLicenseKind(r.license);
    if (!kind) return undefined;
    const author = cleanAuthor(String(r.author ?? ""));
    if (!author) return undefined;
    const src = String(r.thumbUrl ?? "").replace(/^http:\/\//, "https://");
    const sourceUrl = String(r.pageUrl ?? "").replace(/^http:\/\//, "https://");
    if (!isHttps(src) || !isCommonsUpload(src)) return undefined;
    if (!isHttps(sourceUrl) || !isCommonsPage(sourceUrl)) return undefined;
    const licenseUrl = r.licenseUrl ? r.licenseUrl.replace(/^http:\/\//, "https://") : undefined;
    if ((kind === "cc-by" || kind === "cc-by-sa") && !isHttps(licenseUrl)) return undefined;
    if (!(r.width > 0) || !(r.height > 0)) return undefined;
    return {
        src,
        width: r.width,
        height: r.height,
        author,
        license: r.license.trim(),
        ...(isHttps(licenseUrl) ? { licenseUrl } : {}),
        sourceUrl,
        ...(r.dateTimeOriginal?.trim() ? { takenAt: r.dateTimeOriginal.trim() } : {}),
    };
}

/**
 * **そのスポットの作例**（表示してよいものだけ・最大6枚）。
 * 下書きには付けない（本文と同じく、誰も確かめていないページに足さない）。
 * `exclude` は代表写真の出典 URL など、同じ写真を2度出さないためのもの
 */
export function spotSamples(
    spot: Pick<Spot, "spotId"> & Partial<Spot>,
    opts: { file?: Readonly<SpotSamplesFile>; exclude?: (string | undefined)[] } = {},
): SpotSample[] {
    if (!isPublished(spot as Spot)) return [];
    const file = opts.file ?? SPOT_SAMPLES;
    const skip = new Set(opts.exclude?.filter(Boolean));
    const seen = new Set<string>();
    const out: SpotSample[] = [];
    for (const r of file[spot.spotId]?.samples ?? []) {
        const s = toSpotSample(r);
        if (!s || skip.has(s.sourceUrl) || seen.has(s.sourceUrl)) continue;
        seen.add(s.sourceUrl);
        out.push(s);
        if (out.length >= MAX_SHOWN_SAMPLES) break;
    }
    return out;
}

/** 構造化データ（JSON-LD）の `ImageObject`。作者・ライセンス・出典を必ず書く */
export function sampleImageObject(s: SpotSample) {
    return {
        "@type": "ImageObject",
        contentUrl: s.src,
        width: s.width,
        height: s.height,
        creator: { "@type": "Person", name: s.author },
        creditText: `${s.author} / ${s.license} / Wikimedia Commons`,
        ...(s.licenseUrl ? { license: s.licenseUrl } : {}),
        acquireLicensePage: s.sourceUrl,
    };
}
