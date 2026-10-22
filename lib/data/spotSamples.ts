// lib/data/spotSamples.ts（サーバー専用）
//
// **撮影地ページの「作例」（Wikimedia Commons の自由に使える写真）。**（2026-10-03）
// 2026-10-04: Flickr（CC BY・CC BY-SA・CC0）も出せる。行に `source: { name: "Flickr", url: <写真のページ> }`
// を書く。`source` の無い行は今まで通り Commons（`toFlickrSample`）。
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
// 2026-10-04: **サイトに置いた写真**（環境省の国立公園の写真＝公共データ利用規約 PDL1.0、県の観光協会・
// 観光連盟の写真素材のうち申請不要のもの）も出せる。どちらも画像への直リンクを禁じているので、
// 縮小して位置情報を消した JPEG を `public/samples/<slug>/<n>.jpg` に置き、行の `thumbUrl` にその
// パスを書く。出典の書き方・ライセンスの名前・規約のページは提供元ごとに決まっているので、行には
// 書かせず `HOSTED_SOURCES` から出す（行が書き方を間違える余地を作らない）。
//
// 🔴 台帳と同じく JSON を値で読む。**`"use client"` から import しない**（型だけは可）。

import raw from "@/content/spot-samples.json";
import {
    cleanAuthor, licenseKindOf, isReviewedPick, isNoFopCoverExcluded, isExcludedSample, titleFromFile, SAMPLE_COVER_METHOD,
    SPOT_IMAGES, SEO_IMAGE_MIN_WIDTH, spotCoverImage, spotCoverLarge, spotCoverSize, type SpotImage,
} from "./spotImages";
import type { Spot, SpotCoverImage } from "./spots";
import { publicImageUrl, siteConfig } from "@/lib/utils/seo";
import { isPublished } from "@/lib/utils/spotGuide";
import {
    UNKNOWN_AUTHOR_LABEL, isPlaceholderAuthor, isUnusablePublicDomain, EVENT_OR_PERSON, isEventSpot, standardThumbOf, hasPdBasis, isOrganizationName,
} from "@/lib/utils/commonsAttribution.mjs";

/**
 * 作例の出どころ（2026-10-04）。**無ければ Wikimedia Commons**（既存の行はこの鍵を持たない）。
 * - `name`: 出どころの名前。"Flickr"、サイトに置いた写真の提供元（`HOSTED_SOURCES` の鍵: "環境省"・
 *   "福岡県観光連盟" など）。"Wikimedia Commons" と書いてもよい＝無いのと同じ
 * - `url`: その写真のページ（出典のリンク先）。Flickr は `https://www.flickr.com/photos/<人>/<写真ID>/`
 *
 * 🔴 Flickr は CC BY・CC BY-SA・CC0 だけ（Public Domain Mark・「著作権の制限なし」・NC・ND は出さない）。
 * Flickr の決まりどおり、出典のリンクは**写真のページ**へ張る
 */
export type SpotSampleSource = { name: SpotSampleSourceName; url: string };
export type SpotSampleSourceName = "Wikimedia Commons" | "Flickr" | HostedSourceName;

/**
 * **サイトに置いた作例の出どころと、その規約が求める表示**（2026-10-04）。
 *
 * - `pageHost`: 出典のページ（`source.url`）のホスト。ほかのホストの URL は出さない
 * - `author`: 著作権者として出す団体の名前
 * - `license`: ライセンス欄に出す規約の名前
 * - `licenseUrl`: 規約（ライセンス）の文面。無い提供元は規約が写真のページに載っている（＝出典のページ）
 * - `termsUrl`: 構造化データの `acquireLicensePage`（使ってよい条件が書いてあるページ）。無ければ `licenseUrl`
 * - `credit`: 規約が求める出典の文。`resized` は縮小して置いた1枚
 *
 * 🔴 **どれも画像への直リンクを禁じている**（環境省「他のホームページ中に組み込まれるようなリンク」・
 * 福岡・熊本は名指しで禁止）。画像は必ずサイトに置いた複製を出す（`HOSTED_IMAGE_PATH`）
 */
type HostedSourceRule = {
    pageHost: string;
    author: string;
    license: string;
    licenseUrl?: string;
    termsUrl?: string;
    credit: (title: string, resized: boolean) => string;
};

export const HOSTED_SOURCES = {
    /** 環境省「国立公園に、行ってみよう！」。PDL1.0。出典の記載例どおり。加工したら「を加工して作成」を足す */
    "環境省": {
        pageHost: "www.env.go.jp",
        author: "環境省",
        license: "PDL1.0",
        licenseUrl: "https://www.digital.go.jp/resources/open_data/public_data_license_v1.0",
        termsUrl: "https://www.env.go.jp/nature/nationalparks/terms/",
        credit: (title, resized) => resized
            ? `出典：「${title}の写真」（環境省）を加工して作成（journey.photo が縮小）`
            : `出典：「${title}の写真」（環境省）`,
    },
    /** 山口県観光連盟。規約は写真のページに載っている。クレジットの決まりは無い（書く） */
    "山口県観光連盟": {
        pageHost: "yamaguchi-tourism.jp",
        author: "山口県観光連盟",
        license: "山口県観光連盟 画像ダウンロード利用規約",
        credit: () => "写真提供：山口県観光連盟",
    },
    /** 福岡県観光連盟（クロスロードふくおか）。クレジット必須 */
    "福岡県観光連盟": {
        pageHost: "www.crossroadfukuoka.jp",
        author: "福岡県観光連盟",
        license: "クロスロードふくおか フォトダウンロード利用規約",
        licenseUrl: "https://www.crossroadfukuoka.jp/business/photo/guide",
        credit: () => "写真提供：福岡県観光連盟",
    },
    /** 熊本県観光連盟の「申請不要」の写真。著作権は熊本県。「©」は「写真提供：」に置き換えてよい */
    "熊本県観光連盟": {
        pageHost: "kumamoto.guide",
        author: "熊本県",
        license: "熊本県観光連盟 写真ダウンロード利用規約（申請不要）",
        licenseUrl: "https://kumamoto.guide/photos/guide-free",
        credit: () => "写真提供：熊本県観光連盟",
    },
    /** 香川県観光協会。規約は写真のページに載っている。クレジットは任意（決まった書き方で書く） */
    "香川県観光協会": {
        pageHost: "www.my-kagawa.jp",
        author: "香川県観光協会",
        license: "香川県観光協会 フォトダウンロード利用規約",
        credit: () => "提供：（公社）香川県観光協会",
    },
    /** 宮崎県観光協会。ホームページでの利用を明記。クレジットは任意（「宮崎県観光協会」） */
    "宮崎県観光協会": {
        pageHost: "www.kanko-miyazaki.jp",
        author: "宮崎県観光協会",
        license: "宮崎県観光協会 フォトダウンロード利用規約",
        licenseUrl: "https://www.kanko-miyazaki.jp/business/photo/guide",
        credit: () => "写真提供：宮崎県観光協会",
    },
    /** やまなし観光推進機構。「画像の下などに著作権者の名前」が条件 */
    "やまなし観光推進機構": {
        pageHost: "www.yamanashi-kankou.jp",
        author: "やまなし観光推進機構",
        license: "やまなし観光推進機構 使用許諾",
        licenseUrl: "https://www.yamanashi-kankou.jp/gallery/use.html",
        credit: () => "写真提供：やまなし観光推進機構",
    },
} as const satisfies Record<string, HostedSourceRule>;

export type HostedSourceName = keyof typeof HOSTED_SOURCES;

/** サイトに置いた作例の画像のパス（`public/` の下） */
export const HOSTED_IMAGE_PATH = /^\/samples\/[a-z0-9-]+\/\d+\.jpg$/;

/** サイトに置く作例の幅の上限 */
export const HOSTED_MAX_WIDTH = 1280;

export function isHostedSourceName(name: unknown): name is HostedSourceName {
    return typeof name === "string" && Object.prototype.hasOwnProperty.call(HOSTED_SOURCES, name);
}

/**
 * **作例の画像を読みにいく先（オリジン）の許可リスト。** `toSpotSample` を通った1枚の `src` は
 * 必ずこのどれか（`app/__tests__/imageOriginSites.test.ts` が確定ファイルの全部で見る）。
 * 出どころを足すときは、ここと `toSpotSample` の両方に足す。
 * 3つ目はこのサイト（サイトに置いた作例・2026-10-04）
 */
export const SAMPLE_IMAGE_ORIGINS: readonly string[] = [
    "https://upload.wikimedia.org", "https://live.staticflickr.com", new URL(siteConfig.url).origin,
];

/** 出どころが書かれていないときの名前（既存の行はみな Commons） */
export const COMMONS_SOURCE_NAME = "Wikimedia Commons";

/** 確定ファイルの1枚（手で書く形） */
export type SpotSampleRecord = {
    /** Commons のファイル名（"File:…"）。Commons 以外は無くてよい（題は `title`） */
    file?: string;
    /** 題。Commons 以外（Flickr の写真の題）で使う。Commons はファイル名から作る */
    title?: string;
    /** Commons のファイルのページ（出典のリンク先）。Commons 以外は `source.url` を使う */
    pageUrl?: string;
    /** 出どころ。無ければ Wikimedia Commons */
    source?: SpotSampleSource;
    /**
     * 表示に使う画像（Commons は upload.wikimedia.org・横 1280px まで。Flickr は live.staticflickr.com。
     * サイトに置いた写真は `/samples/<slug>/<n>.jpg`）
     */
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
    /** サイトに置いた写真を縮小した（規約が加工の表記を求める） */
    resized?: boolean;
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
    /** 出典のページ（Commons のファイルのページ・Flickr の写真のページ）。`source` があれば `source.url` と同じ */
    sourceUrl: string;
    /**
     * 出どころ。**Commons 以外のときだけ持つ**（無ければ Wikimedia Commons。既存の本文の形は変えない）。
     * アプリ（`/app/data/spots/<slug>.json`）も同じ形で読む
     */
    source?: SpotSampleSource;
    /** 撮影日時（Commons の書き方のまま） */
    takenAt?: string;
    /**
     * **規約が求める出典の文**（サイトに置いた写真だけ・2026-10-04）。例「出典：「タデ原の写真」（環境省）」
     * 「写真提供：福岡県観光連盟」。画面とアプリは「写真: 作者」の代わりにこれをそのまま出す
     */
    credit?: string;
    /** 加工の表記（サイトに置いた写真を縮小したときだけ）。例「journey.photo が縮小して掲載」 */
    modified?: string;
    /** 使ってよい条件が書いてあるページ（サイトに置いた写真だけ。構造化データの acquireLicensePage） */
    termsUrl?: string;
};

export const SPOT_SAMPLES: Readonly<SpotSamplesFile> = raw as SpotSamplesFile;

/** 画面に出す最大の枚数 */
export const MAX_SHOWN_SAMPLES = 6;

/** 作者が分からないときの表記（パブリックドメイン・CC0 だけに許す） */
export const UNKNOWN_AUTHOR = UNKNOWN_AUTHOR_LABEL;

/** パブリックドメインの印（Public Domain Mark）。構造化データの `license` に使う */
export const PUBLIC_DOMAIN_MARK_URL = "https://creativecommons.org/publicdomain/mark/1.0/";

const isHttps = (u: unknown): u is string => typeof u === "string" && /^https:\/\/[^\s]+$/.test(u);
const isCommonsPage = (u: string) => /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(u);
const isCommonsUpload = (u: string) => /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//.test(u);
/** Commons の縮小版の URL の幅（`…/<幅>px-<名前>`）。縮小版でなければ undefined */
export function commonsThumbWidth(u: string): number | undefined {
    const m = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/[^?#\s"<>]+\/(\d+)px-[^/?#\s"<>]+$/.exec(u);
    return m ? Number(m[1]) : undefined;
}
const isCommonsThumb = (u: string) => /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\//.test(u);
/** Flickr の写真のページ（`https://www.flickr.com/photos/<人>/<写真ID>/`）。写真ID を返す */
const flickrPhotoIdOfPage = (u: string) => /^https:\/\/www\.flickr\.com\/photos\/[A-Za-z0-9@_-]+\/(\d+)\/?$/.exec(u)?.[1];
/** Flickr の画像（`https://live.staticflickr.com/<server>/<写真ID>_<secret>[_<大きさ>].jpg`）。写真ID を返す */
const flickrPhotoIdOfImage = (u: string) => /^https:\/\/live\.staticflickr\.com\/\d+\/(\d+)_[0-9a-f]+(?:_[a-z0-9]{1,2})?\.(?:jpe?g|png)$/.exec(u)?.[1];

/** 出どころの名前（書かれていなければ Wikimedia Commons）。知らない名前は undefined */
export function sampleSourceName(r: Pick<SpotSampleRecord, "source">): SpotSampleSourceName | undefined {
    if (r.source == null) return COMMONS_SOURCE_NAME;
    const name = String(r.source.name ?? "").trim();
    return name === "Flickr" || name === COMMONS_SOURCE_NAME || isHostedSourceName(name) ? name : undefined;
}

/** 表示の形の1枚の出どころの名前（`source` が無ければ Wikimedia Commons） */
export function sourceNameOf(s: Pick<SpotSample, "source">): SpotSampleSourceName {
    return s.source?.name ?? COMMONS_SOURCE_NAME;
}

/**
 * ライセンスの種類。Commons の短い名前は "CC BY-SA 4.0" と "CC-BY-SA-3.0" の両方の書き方が
 * あるので、区切りをそろえてから `coverLicenseOf`（代表写真と同じ判定）に掛ける。
 * 表示の名前に添えた根拠（"Public domain (PD-self)" の括弧）は見ない。
 * NC（商用不可）・ND（改変不可）・その他は undefined
 */
export function sampleLicenseKind(label: string | undefined) {
    return licenseKindOf(label);
}

/** Commons のファイル名から題を作る（判定は `spotImages.ts` の1本） */
export { titleFromFile };

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
    const sourceName = sampleSourceName(r);
    if (!sourceName) return undefined;
    if (sourceName === "Flickr") return toFlickrSample(r);
    if (isHostedSourceName(sourceName)) return toHostedSample(r, sourceName);
    const kind = sampleLicenseKind(r.license);
    if (!kind) return undefined;
    // PD-US 系・PD-Detroit・Flickr の Public Domain Mark（2026-10-11 レビュー）
    if (isUnusablePublicDomain(r.license, r.licenseCode)) return undefined;
    if (kind === "public-domain" && !hasPdBasis(r.licenseCode)) return undefined;
    if (r.personality) return undefined;
    const byLicense = kind === "cc-by" || kind === "cc-by-sa";
    let author = cleanAuthor(String(r.author ?? ""));
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
    // 縮小版は **URL の幅（`/<幅>px-`）が正**（2026-10-22 レビュー）。記録の寸法が元画像や別の幅のままだと、
    // og:image・構造化データに 960px の画像を 1280px と申告する（dubai-frame の1件）。高さは縦横比から出し直す
    const px = commonsThumbWidth(src);
    if (px && px !== width) {
        height = Math.max(1, Math.round((height * px) / width));
        width = px;
    }
    const licenseUrl = r.licenseUrl ? r.licenseUrl.replace(/^http:\/\//, "https://") : undefined;
    if (byLicense && !isHttps(licenseUrl)) return undefined;
    const title = titleFromFile(r.file ?? "") || titleFromFile(decodeURIComponent(sourceUrl.replace(/^.*\/wiki\//, "")));
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

/**
 * **Flickr の1枚**を表示の形へ（2026-10-04）。出してはいけない1枚は undefined:
 *   - ライセンスが CC BY・CC BY-SA・CC0 でない（Public Domain Mark・「著作権の制限なし」・NC・ND は出さない）
 *   - CC BY 系なのにライセンスの文面の URL が無い・作者が空か決まり文句（CC0 は「作者不明」と出す）
 *   - 出典が Flickr の写真のページでない・画像が live.staticflickr.com でない・2つの写真ID が食い違う
 *   - 題が無い・人物の権利の印がある・大きさが無い
 */
function toFlickrSample(r: SpotSampleRecord): SpotSample | undefined {
    const kind = sampleLicenseKind(r.license);
    if (kind !== "cc-by" && kind !== "cc-by-sa" && kind !== "cc0") return undefined;
    if (r.personality) return undefined;
    const byLicense = kind !== "cc0";
    let author = cleanAuthor(String(r.author ?? ""));
    if (isPlaceholderAuthor(author)) {
        if (byLicense) return undefined;
        author = UNKNOWN_AUTHOR;
    }
    const sourceUrl = String(r.source?.url ?? "").trim().replace(/^http:\/\//, "https://");
    const src = String(r.thumbUrl ?? "").trim().replace(/^http:\/\//, "https://");
    const pageId = flickrPhotoIdOfPage(sourceUrl);
    if (!pageId || flickrPhotoIdOfImage(src) !== pageId) return undefined;
    if (!(r.width > 0) || !(r.height > 0)) return undefined;
    const licenseUrl = r.licenseUrl ? r.licenseUrl.trim().replace(/^http:\/\//, "https://") : undefined;
    if (byLicense && !isHttps(licenseUrl)) return undefined;
    const title = String(r.title ?? "").replace(/\s+/g, " ").trim();
    if (!title) return undefined;
    return {
        src,
        width: r.width,
        height: r.height,
        title,
        author,
        license: r.license.trim(),
        ...(isHttps(licenseUrl) ? { licenseUrl } : {}),
        sourceUrl,
        source: { name: "Flickr", url: sourceUrl },
        ...(r.dateTimeOriginal?.trim() ? { takenAt: r.dateTimeOriginal.trim() } : {}),
    };
}

/** 縮小して置いた1枚の加工の表記（環境省以外。環境省は出典の文に「を…縮小して作成」と入る） */
export const RESIZED_NOTE = "journey.photo が縮小して掲載";

/**
 * **サイトに置いた1枚**（環境省・県の観光協会など）を表示の形へ（2026-10-04）。出してはいけない1枚は undefined:
 *   - 画像が `/samples/<slug>/<n>.jpg` でない（外部への直リンクは出さない）・幅が 1280px を超える・大きさが無い
 *   - 出典のページがその提供元のホストの https でない
 *   - 題が無い・人物の権利の印がある
 * 作者・ライセンス・出典の文・規約のページは行ではなく `HOSTED_SOURCES` から出す
 */
function toHostedSample(r: SpotSampleRecord, name: HostedSourceName): SpotSample | undefined {
    const rule: HostedSourceRule = HOSTED_SOURCES[name];
    if (r.personality) return undefined;
    const path = String(r.thumbUrl ?? "").trim();
    if (!HOSTED_IMAGE_PATH.test(path)) return undefined;
    if (!(r.width > 0) || !(r.height > 0) || r.width > HOSTED_MAX_WIDTH) return undefined;
    const sourceUrl = String(r.source?.url ?? "").trim();
    if (!isHttps(sourceUrl)) return undefined;
    try {
        if (new URL(sourceUrl).host !== rule.pageHost) return undefined;
    } catch {
        return undefined;
    }
    const title = String(r.title ?? "").replace(/\s+/g, " ").trim();
    if (!title) return undefined;
    const resized = r.resized === true;
    const licenseUrl = rule.licenseUrl ?? sourceUrl;
    return {
        src: publicImageUrl(path),
        width: r.width,
        height: r.height,
        title,
        author: rule.author,
        license: rule.license,
        licenseUrl,
        sourceUrl,
        source: { name, url: sourceUrl },
        credit: rule.credit(title, resized),
        ...(resized && name !== "環境省" ? { modified: RESIZED_NOTE } : {}),
        termsUrl: rule.termsUrl ?? licenseUrl,
        ...(r.dateTimeOriginal?.trim() ? { takenAt: r.dateTimeOriginal.trim() } : {}),
    };
}

/** 人（または目で見て選ぶ作業）が選んだ1枚か。"auto" は機械の規則（判定は `spotImages.ts` の1本） */
export { isReviewedPick };

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
        if (isExcludedSample(spot.spotId, r)) continue;
        if (opts.reviewedOnly && !isReviewedPick(r)) continue;
        if (!eventSpot && EVENT_OR_PERSON.test(`${r.file ?? r.title ?? ""}`)) continue;
        const s = toSpotSample(r);
        if (!s || skip.has(s.sourceUrl) || seen.has(s.sourceUrl)) continue;
        seen.add(s.sourceUrl);
        out.push(s);
        if (out.length >= MAX_SHOWN_SAMPLES) break;
    }
    return out;
}

/**
 * **代表写真に昇格してよい作例**（2026-10-11・owner「検索で見つけてもらう」）。無ければ undefined。
 *
 * 代表写真は「その場所の写真だと確かめた」（`SpotCoverImage.verifiedPlace`）が条件。作例のうちそれを
 * 満たすのは、**写真を1枚ずつ見てその撮影地の景色と確かめた1枚**（`pickedBy` が "visual-review" か人の
 * 名前＝`isReviewedPick`）だけ。"auto"（名前の一致と距離だけ）は上げない。ほかに:
 *   - 公開済みのスポットだけ（下書きはページが建たない）
 *   - Wikimedia Commons の写真だけ（縮小版をサイトに置く道具 `localize-spot-images.mjs` が Commons 用。
 *     Flickr・サイトに置いた提供元の写真は規約の表示が別なので上げない）
 *   - 画面に出せる1枚（`toSpotSample` を通る＝ライセンス・作者・PD の根拠・人物の権利）で、
 *     人や催しが主役でない（`spotSamples` と同じ）
 *   - 横長を先に（ページの頭と共有のカードは横長）。横長が無ければ最初の1枚
 */
/**
 * **作例から代表写真を上げる対象か**（2026-10-11）。公開済みで代表写真がまだ出ていない行のうち、
 * **人が確かめた Wikidata の代表画像（`reviewedBy`）を持つ行は上げない**——縮小版を置き忘れただけの
 * 人の確認を、機械の昇格で上書きしない（`localize-spot-images.mjs --slug` で置けばよい）
 */
export function isPromotionTarget(
    spot: Spot,
    images: Readonly<Record<string, SpotImage>>,
    hasCover: (spot: Spot) => boolean,
): boolean {
    if (!isPublished(spot) || hasCover(spot)) return false;
    return !images[spot.slug]?.reviewedBy?.trim();
}

export function coverCandidateSample(
    spot: Pick<Spot, "spotId"> & Partial<Spot>,
    file: Readonly<SpotSamplesFile> = SPOT_SAMPLES,
): { record: SpotSampleRecord; sample: SpotSample } | undefined {
    if (!isPublished(spot as Spot)) return undefined;
    // パノラマの自由が無い国の現代建築は代表写真に上げない（`NO_FOP_COVER_EXCLUSIONS`・2026-10-11）
    if (isNoFopCoverExcluded(spot.slug)) return undefined;
    const eventSpot = isEventSpot(spot);
    const ok: { record: SpotSampleRecord; sample: SpotSample }[] = [];
    for (const record of file[spot.spotId]?.samples ?? []) {
        if (isExcludedSample(spot.spotId, record)) continue;
        if (!isReviewedPick(record) || sampleSourceName(record) !== COMMONS_SOURCE_NAME) continue;
        if (!eventSpot && EVENT_OR_PERSON.test(`${record.file ?? record.title ?? ""}`)) continue;
        const sample = toSpotSample(record);
        if (sample) ok.push({ record, sample });
    }
    return ok.find((c) => c.sample.width >= c.sample.height) ?? ok[0];
}

/**
 * 昇格させる作例から `content/spot-images.json` の1行を作る（`local` は縮小版を置いたあとに足す）。
 * 作者・ライセンスは**画面の作例と同じ表示の形**（`toSpotSample` を通したもの）を写す——作者の飾りを
 * 落とし、パブリックドメインは根拠を添えた名前（"Public domain (PD-self)"）
 */
export function sampleCoverEntry(
    c: { record: SpotSampleRecord; sample: SpotSample },
    fetchedAt: string,
    previous?: SpotImage,
): SpotImage {
    const { local: _local, replaced: _replaced, ...prev } = previous ?? ({} as SpotImage);
    void _local; void _replaced;
    return {
        wikidata: previous?.wikidata ?? "",
        file: c.record.file ?? "",
        pageUrl: c.sample.sourceUrl,
        thumbUrl: c.sample.src,
        author: c.sample.author,
        license: c.sample.license,
        ...(c.sample.licenseUrl ? { licenseUrl: c.sample.licenseUrl } : {}),
        ...(c.record.licenseCode ? { licenseCode: c.record.licenseCode } : {}),
        method: SAMPLE_COVER_METHOD,
        pickedBy: c.record.pickedBy.trim(),
        fetchedAt,
        reviewedBy: null,
        ...(previous ? { replaced: prev } : {}),
    };
}

/**
 * 構造化データ（JSON-LD）の `ImageObject`。題・ライセンス・出典・表示の文字を必ず書く。
 * 画面に出す作例は**全部**ここを通す（自動で選んだものも。`SpotGuidePage`）。
 * - 作者は**分かるときだけ** `creator`（「作者不明」のパブリックドメイン・CC0 は `creditText` にだけ出る）。
 *   型は `Person`。団体と分かる名前（Section・Museum・協会・大学…）だけ `Organization`（`isOrganizationName`）
 * - パブリックドメインは Public Domain Mark の URL を `license` に
 * - 表示の文字の最後と `acquireLicensePage` は出どころに合わせる（Commons のページ・Flickr の写真のページ）
 * - サイトに置いた写真（環境省・県の観光協会など）は、表示の文字が規約の求める出典の文、`license` が規約の
 *   文面（PDL1.0 など）、`acquireLicensePage` が規約のページ。作者は団体（`Organization`）
 */
export function sampleImageObject(s: SpotSample) {
    if (s.credit && s.source && isHostedSourceName(s.source.name)) {
        return {
            "@type": "ImageObject",
            name: s.title,
            contentUrl: s.src,
            width: s.width,
            height: s.height,
            creator: { "@type": "Organization", name: s.author },
            creditText: s.modified ? `${s.credit}（${s.modified}）` : s.credit,
            ...(s.licenseUrl ? { license: s.licenseUrl } : {}),
            acquireLicensePage: s.termsUrl ?? s.licenseUrl ?? s.sourceUrl,
        };
    }
    const license = s.licenseUrl ?? (sampleLicenseKind(s.license) === "public-domain" ? PUBLIC_DOMAIN_MARK_URL : undefined);
    return {
        "@type": "ImageObject",
        name: s.title,
        contentUrl: s.src,
        width: s.width,
        height: s.height,
        ...(s.author !== UNKNOWN_AUTHOR
            ? { creator: { "@type": isOrganizationName(s.author) ? "Organization" : "Person", name: s.author } }
            : {}),
        creditText: `${s.author} / ${s.license} / ${sourceNameOf(s)}`,
        ...(license ? { license } : {}),
        acquireLicensePage: s.sourceUrl,
    };
}

/**
 * **代表写真の `ImageObject`**（観光地の構造化データの `image` の先頭・2026-10-11）。
 * 以前は URL の文字列だけで、作者・ライセンスが構造化データに無かった（作例は `sampleImageObject` で持つ）。
 * 書き方は作例と同じ: 作者は分かるときだけ `creator`、ライセンスの文面（パブリックドメインは
 * Public Domain Mark）、出典のページを `acquireLicensePage`、表示の文字を `creditText`。
 * Commons の写真でない（owner・許諾）代表写真は、ライセンスの文面を持たないので書かない
 */
export function coverImageObject(cover: SpotCoverImage, url: string, size?: { width?: number; height?: number }) {
    const license = cover.licenseUrl ?? (cover.license === "public-domain" ? PUBLIC_DOMAIN_MARK_URL : undefined);
    const fromCommons = Boolean(cover.sourceUrl && /^https:\/\/commons\.wikimedia\.org\//.test(cover.sourceUrl));
    const credit = cover.credit.trim();
    return {
        "@type": "ImageObject",
        contentUrl: url,
        // 寸法は分かるときだけ（2026-10-22・`spotCoverSeoSource`）
        ...(size?.width && size?.height ? { width: size.width, height: size.height } : {}),
        name: cover.title ?? cover.alt,
        ...(credit && credit !== UNKNOWN_AUTHOR
            ? { creator: { "@type": isOrganizationName(credit) ? "Organization" : "Person", name: credit } }
            : {}),
        creditText: cover.requiredCreditText?.trim()
            || [credit, cover.licenseLabel, fromCommons ? COMMONS_SOURCE_NAME : undefined].filter(Boolean).join(" / "),
        ...(license ? { license } : {}),
        ...(cover.sourceUrl ? { acquireLicensePage: cover.sourceUrl } : {}),
    };
}

/** 検索・共有に渡す絶対 URL（サイト内のパスは `publicImageUrl` で本番のオリジンへ・2026-10-22 レビュー） */
const absoluteUrl = (src: string) => publicImageUrl(src);

/**
 * **代表写真を検索に渡すときの URL と寸法**（構造化データ・画像サイトマップ・2026-10-22）。
 * 横 1,200px 以上の版（`spotCoverLarge`・Commons の 1280px）があればそれ、無ければ画面と同じ
 * サイトに置いた縮小版（横 960px）。代表写真が無ければ undefined
 */
export function spotCoverSeoSource(
    spot: Spot,
    images: Readonly<Record<string, SpotImage>> = SPOT_IMAGES,
): { url: string; width?: number; height?: number; large: boolean } | undefined {
    const cover = spotCoverImage(spot, images);
    if (!cover?.src) return undefined;
    const large = spotCoverLarge(spot, images);
    if (large) return { url: large.src, width: large.width, height: large.height, large: true };
    return { url: absoluteUrl(cover.src), ...spotCoverSize(spot, images), large: false };
}

/** 検索・共有に渡す1枚（og:image・twitter:image・構造化データの先頭） */
export type SpotSeoImage = {
    url: string;
    width?: number;
    height?: number;
    /** どこから選んだか。`sample` は画面の作例の1枚（`sample` にその1枚） */
    from: "cover" | "sample";
    sample?: SpotSample;
};

/**
 * **スポットのページを代表して検索・共有に渡す1枚**（2026-10-22・SEO）。
 *
 * Google の画像検索・Discover は横 1,200px 以上の画像を大きく出すので、選ぶ順は:
 *   1. 代表写真の横 1,200px 以上の版（`spotCoverLarge`）
 *   2. 画面に出している作例のうち、横 1,200px 以上の最初の1枚（代表写真が小さい・無いとき）
 *   3. 代表写真のサイトに置いた縮小版（横 960px。1,200 に届く写真がほかに無いとき）
 * どれも無ければ undefined（呼ぶ側がサイトの既定の画像に落とす）。
 * `samples` は画面に出すもの（`spotSamples(spot, { exclude: [cover?.sourceUrl] })`）をそのまま渡す
 */
export function spotSeoImage(
    spot: Spot,
    samples: readonly SpotSample[],
    images: Readonly<Record<string, SpotImage>> = SPOT_IMAGES,
    file: Readonly<SpotSamplesFile> = SPOT_SAMPLES,
): SpotSeoImage | undefined {
    const cover = spotCoverSeoSource(spot, images);
    if (cover?.large) return { url: cover.url, width: cover.width, height: cover.height, from: "cover" };
    // 🔴 2026-10-22 判断: 作例から選ぶのは**場所を人（または写真を1枚ずつ見る作業）が確かめた1枚だけ**
    // （`isReviewedPick`）。"auto"（名前の一致と距離だけ）は、別の場所の写真をこの場所の写真として
    // 検索・共有のカードに出しうる（ページの metadata の注記「別の場所の写真を、この場所の写真として見せない」と同じ考え）。
    // 代表写真が無いページも同じ。確かめた作例が無ければ 1,200 未満の代表写真のまま（無ければ既定の画像）
    const reviewed = reviewedSampleSources(spot, file);
    const big = samples.find((s) => reviewed.has(s.sourceUrl) && seoWidthOf(s) >= SEO_IMAGE_MIN_WIDTH && s.height > 0);
    if (big) {
        const width = seoWidthOf(big);
        const height = width === big.width ? big.height : Math.max(1, Math.round((big.height * width) / big.width));
        return { url: absoluteUrl(big.src), width, height, from: "sample", sample: big };
    }
    if (cover) return { url: cover.url, width: cover.width, height: cover.height, from: "cover" };
    return undefined;
}

/** 作例の幅。Commons の縮小版は URL の幅が正（記録の幅と食い違っても URL を信じる） */
function seoWidthOf(s: SpotSample): number {
    return commonsThumbWidth(s.src) ?? s.width;
}

/**
 * そのスポットの作例のうち、**場所を確かめた1枚**（`isReviewedPick`）の出典の URL（`SpotSample.sourceUrl` と同じ形）。
 * 画面と本文の JSON（`SpotSample`）には印を足さない——アプリと HTML に載る形を変えずに、確定ファイルの行から引く
 */
export function reviewedSampleSources(
    spot: Pick<Spot, "spotId">,
    file: Readonly<SpotSamplesFile> = SPOT_SAMPLES,
): Set<string> {
    const out = new Set<string>();
    for (const r of file[spot.spotId]?.samples ?? []) {
        if (!isReviewedPick(r)) continue;
        const s = toSpotSample(r);
        if (s) out.add(s.sourceUrl);
    }
    return out;
}
