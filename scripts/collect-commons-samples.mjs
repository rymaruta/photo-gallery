#!/usr/bin/env node
// scripts/collect-commons-samples.mjs
//
// **撮影地ページの「作例」を Wikimedia Commons から集める。**（2026-10-03）
//
// 撮影地ページ（`/spots/<slug>`）は、利用者の投稿が0枚だと写真が1枚も無い。
// そこで、**その撮影地の近くで撮られ、自由に使えるライセンスで公開されている写真**を
// 「作例」として作者表示つきで載せる。詳しい決まりは `docs/spot-samples-commons.md`。
//
//   node scripts/collect-commons-samples.mjs --prefecture=京都府        候補を集め、確定ファイルも作る
//   node scripts/collect-commons-samples.mjs --all                      公開済みの全件（約1,079か所・1時間あまり）
//   node scripts/collect-commons-samples.mjs --slug=kinkakuji,byodoin   指定のスポットだけ
//   **候補ファイルに済んでいる spotId は飛ばす**（止まっても同じコマンドで続きから）。
//   取り直すときは --refresh
//   node scripts/collect-commons-samples.mjs --prefecture=京都府 --pick-only
//                                     通信せず、候補ファイルから確定ファイルを選び直す
//   --radius=500   探す半径（m・300〜500 に収める）
//   --keep-picks   確定ファイルに既にあるスポットは上書きしない（人が直した分を守る）
//
// ## 2つのファイル
//
//   content/spot-samples.candidates.json   **機械が集めた候補**（spotId ごとに配列）。人が選ぶ材料
//   content/spot-samples.json              **採用した分だけ**（spotId → 最大6枚）。画面とアプリが読む。
//                                          手で足し引きしてよい（`pickedBy` に人の名前を書く）
//
// ## 機械で決めること
//
//   - 候補は **スポットの座標から Commons の geosearch**（ファイルの名前空間 6）で集める。
//     台帳の座標は約1km に丸めてあるので、Wikidata に座標があるスポットはその点の周りも探す
//     （`content/spot-images.json` の `wikidata`。**探す中心に使うだけ**で、画面の位置は台帳のまま）
//   - ライセンスは CC0・パブリックドメイン・CC BY・CC BY-SA だけ（`isAllowedLicense`）。
//     NC（商用不可）・ND（改変不可）・GFDL だけ・不明は捨てる。CC BY 系で作者が空なら捨てる
//   - 人物の権利などの注意書き（`Restrictions`）が付いた写真は候補に残すが、自動では採らない
//
// ## 位置情報の扱い
//
// 🔴 **写真そのものの撮影位置（EXIF の GPS・Commons の座標）は、どちらのファイルにも書かない。**
// 距離の計算（並べ替え）に使うだけ。画面・アプリが出す位置は**台帳の撮影地の座標**（約1km に
// 丸めたもの）で、画像は **Commons のサムネイルの URL** をそのまま使う——こちらで画像を
// 複製して配らないので、元の画像に GPS が入っていても、こちらが位置を再配布することはない。
//
// ## 通信の作法（CLAUDE.md「Wikipedia / Wikidata の API は叩きすぎない」）
//
//   - **2秒に1回まで・1本だけ**（並べて流さない）
//   - 連絡先の分かる User-Agent（サイトの URL）
//   - 429・5xx は `retry-after` に従って待ち、取り直す。`maxlag` も同じ
//   - 途中経過を毎回書くので、止まっても続きから走れる

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAllowedLicense, stripHtml, creditFor, cleanUrl, distanceKm } from "./fetch-spot-images.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
export const LEDGER_PATH = path.join(ROOT, "content", "spots.json");
export const SPOT_IMAGES_PATH = path.join(ROOT, "content", "spot-images.json");
export const CANDIDATES_PATH = path.join(ROOT, "content", "spot-samples.candidates.json");
export const SAMPLES_PATH = path.join(ROOT, "content", "spot-samples.json");

export const USER_AGENT = "JourneyPhotoSpotSamples/1.0 (https://journey-photo.com; spot sample collector)";
const COMMONS = "https://commons.wikimedia.org/w/api.php";
const WIKIDATA = "https://www.wikidata.org/w/api.php";

/** 1回の要求の間隔（ms）。CLAUDE.md の「2秒に1回まで」 */
export const MIN_INTERVAL_MS = 2000;
/** 探す半径の既定と、許す幅（m） */
export const DEFAULT_RADIUS_M = 500;
export const MIN_RADIUS_M = 300;
export const MAX_RADIUS_M = 500;
/** 1スポットに採る最大の枚数 */
export const MAX_SAMPLES = 6;
/** 同じ作者から採る最大の枚数（同じ日の連写で埋まらないように） */
export const MAX_PER_AUTHOR = 2;
/**
 * 候補ファイルに残す1スポットの最大の件数（自動で採ったもの＋点数の高い順）。全部残すと全国で
 * 約 100MB になる（京都府の9か所で 838KB を実測）。15件・字下げ2で 13MB だったので、10件・
 * 1候補1行にした。残りは件数（`usable`・`named`）だけ数える
 */
export const KEEP_CANDIDATES = 10;
/** 表示に使うサムネイルの幅（px） */
export const THUMB_WIDTH = 1280;
/** 採る画像の種類（写真だけ。SVG・TIFF・PDF・GIF・動画は採らない） */
export const PHOTO_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

// ---- 判定（純関数・テストが縛る） -------------------------------------------

/** 半径を許す幅に収める */
export function clampRadius(r) {
    const n = Number(r);
    if (!Number.isFinite(n)) return DEFAULT_RADIUS_M;
    return Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, Math.round(n)));
}

/**
 * 撮影日時の欄（HTML のことがある）を平文に。空なら undefined。
 * 「撮影日：」の前置きは落とす。**「当初のアップロード日」「upload」は撮影日ではない**ので undefined
 */
export function plainDate(value) {
    const s = stripHtml(value).replace(/^(撮影日|date taken)\s*[:：]\s*/i, "").trim();
    if (!s || /アップロード|upload/i.test(s)) return undefined;
    return s;
}

/** 比べる形: 小文字・かなと漢字と英数字だけ（空白・記号・中黒・括弧書きを落とす） */
export function matchForm(text) {
    return String(text ?? "")
        .replace(/[（(].*?[）)]/g, (m) => ` ${m.slice(1, -1)} `)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * スポットの名前で、ファイル名・題・説明に当たりうる語。
 *   main   正式名（括弧書きを外したもの・空白で分かれた最後の語も）。例「嵐山 渡月橋」→「嵐山渡月橋」「渡月橋」
 *   alias  別名（3文字以上だけ——「鞍馬」「八瀬」のような地域の語は広すぎるので2文字は使わない）
 *   roman  slug と英語名（"kinkakuji"・"fushimi-inari-taisha" → 英数字だけ）
 */
export function nameTerms(spot) {
    const base = String(spot.name ?? "").replace(/[（(].*?[）)]/g, "").trim();
    const inParens = [...String(spot.name ?? "").matchAll(/[（(](.*?)[）)]/g)].map((m) => m[1]);
    const words = base.split(/\s+/).filter(Boolean);
    const main = [base, ...inParens, ...(words.length > 1 ? [words[words.length - 1]] : [])]
        .map(matchForm).filter((t) => t.length >= 2);
    const alias = (spot.aliases ?? []).map(matchForm).filter((t) => t.length >= 3);
    const roman = [spot.slug, spot.nameEn].map(matchForm).filter((t) => t && t.length >= 5);
    // slug の語（4文字以上・寺社や公園などの一般語を除く）が**全部**入っていれば当たりとする
    // （"Arashiyama, Chikurin-no-michi (Bamboo Grove Road)" ↔ arashiyama-bamboo-grove、
    //   "Fushimi Inari Grand Shrine" ↔ fushimi-inari-taisha）
    const tokens = String(spot.slug ?? "").toLowerCase().split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 4 && !GENERIC_ROMAN.has(t));
    const uniq = (xs) => [...new Set(xs)];
    return { main: uniq(main), alias: uniq(alias).filter((t) => !main.includes(t)), roman: uniq(roman), romanTokens: tokens.length >= 2 ? tokens : [] };
}

/** slug の語のうち、名前の一致に使わない一般語 */
const GENERIC_ROMAN = new Set(["jinja", "jingu", "taisha", "temple", "shrine", "park", "castle", "garden", "gardens", "onsen",
    "station", "bridge", "falls", "lake", "beach", "kaigan", "machinami", "street", "museum", "tower", "island", "valley"]);

/**
 * 作例に向かないものの語: 地図・看板・切符・食べ物・被害や閉鎖の記録など。
 * 京都府の25か所で自動の選定を目で見て足した（2026-10-03: 「サラダ準備」「Tea and desserts」
 * 「Damage from Typhoon」「Closed Kuramadera」「Christmas Tree in … Station」が上位に来た）
 */
const OFF_TOPIC = /\b(map|logo|sign|signboard|ticket|stamp|menu|timetable|diagram|plan|poster|leaflet|brochure|food|dessert|desserts|tea|salad|lunch|dinner|breakfast|ramen|sushi|meal|damage|damaged|closed|construction|christmas|interior|toilet|parking)\b|地図|案内図|案内板|看板|拝観券|御朱印|時刻表|ポスター|パンフレット|サラダ|料理|ランチ|弁当|ラーメン|被害|工事|駐車場|トイレ|クリスマス/i;

/**
 * **作例の点数。** 高いほど代表になりそう。理由（`reasons`）も返す。
 *
 *   +4 正式名がファイル名・題・説明に入る  /  +3 slug・英語名が入る  /  +2 別名が入る
 *   +2 横長（幅÷高さが 1.25〜2.2）  /  −2 縦長
 *   +2 長い辺が 2000px 以上  /  +1 撮影日時がある  /  +1 中心から 250m 以内
 *   −4 地図・看板・切符などの語
 *
 * **名前が1つも当たらない写真は自動では採らない**（`autoEligible` が false）。
 * 近くで撮られただけの写真（コンビニ・人・別の寺）を作例と名乗らせないため
 */
export function scoreCandidate(spot, c) {
    const terms = nameTerms(spot);
    const hay = matchForm([c.title, c.file, c.description].filter(Boolean).join(" "));
    const reasons = [];
    let score = 0;
    let named = false;
    if (terms.main.some((t) => hay.includes(t))) { score += 4; named = true; reasons.push("名前"); }
    if (terms.roman.some((t) => hay.includes(t))
        || (terms.romanTokens.length > 0 && terms.romanTokens.every((t) => hay.includes(t)))) {
        score += 3; named = true; reasons.push("英字名");
    }
    if (terms.alias.some((t) => hay.includes(t))) { score += 2; named = true; reasons.push("別名"); }
    const ratio = c.width && c.height ? c.width / c.height : 0;
    if (ratio >= 1.25 && ratio <= 2.2) { score += 2; reasons.push("横長"); }
    else if (ratio > 0 && ratio < 1) { score -= 2; reasons.push("縦長"); }
    if (Math.max(c.width ?? 0, c.height ?? 0) >= 2000) { score += 2; reasons.push("高解像度"); }
    if (c.dateTimeOriginal) { score += 1; reasons.push("撮影日時"); }
    if (typeof c.distanceM === "number" && c.distanceM <= 250) { score += 1; reasons.push("近い"); }
    if (OFF_TOPIC.test(`${c.title ?? ""} ${c.file ?? ""}`)) { score -= 4; reasons.push("向かない語"); }
    return { score, reasons, named };
}

/** 解像度が足りるか（短い辺 600px・長い辺 1000px 以上） */
export function bigEnough(c) {
    const long = Math.max(c.width ?? 0, c.height ?? 0);
    const short = Math.min(c.width ?? 0, c.height ?? 0);
    return long >= 1000 && short >= 600;
}

/** 自動で採ってよい候補か（名前が当たる・写真・解像度・注意書きなし・極端な横長でない） */
export function autoEligible(c) {
    if (!c.named) return false;
    if (c.reasons?.includes("向かない語")) return false; // 地図・食べ物・被害の記録などは名前が当たっても採らない
    if (!PHOTO_MIMES.has(c.mime)) return false;
    if (!bigEnough(c)) return false;
    if (c.restrictions) return false;
    const ratio = c.width / c.height;
    return ratio <= 3; // パノラマは画面の格子で潰れる
}

/**
 * **候補から確定ファイルの1スポット分を選ぶ。** 点数の高い順に、同じ作者は2枚まで、最大6枚。
 * 点数が同じなら近い順・ファイル名の順（毎回同じ結果になるように）
 */
export function pickSamples(candidates, { max = MAX_SAMPLES, perAuthor = MAX_PER_AUTHOR } = {}) {
    const sorted = candidates.filter(autoEligible).slice().sort((a, b) =>
        b.score - a.score
        || (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity)
        || a.file.localeCompare(b.file));
    const byAuthor = new Map();
    const out = [];
    for (const c of sorted) {
        if (out.length >= max) break;
        const n = byAuthor.get(c.author) ?? 0;
        if (n >= perAuthor) continue;
        byAuthor.set(c.author, n + 1);
        out.push(c);
    }
    return out;
}

/** 候補を確定ファイルの1枚の形へ（画面とアプリが読む項目だけ） */
export function toSample(c, pickedBy = "auto") {
    return {
        file: c.file,
        pageUrl: c.pageUrl,
        thumbUrl: c.thumbUrl,
        width: c.thumbWidth ?? c.width,
        height: c.thumbHeight ?? c.height,
        author: c.author,
        license: c.license,
        ...(c.licenseUrl ? { licenseUrl: c.licenseUrl } : {}),
        ...(c.dateTimeOriginal ? { dateTimeOriginal: c.dateTimeOriginal } : {}),
        pickedBy,
    };
}

/**
 * Commons の API の1ページ分（`formatversion=2` の `pages`）を候補の形へ。
 * **捨てた理由も数える**（ライセンス・作者なし・写真でない）
 */
export function parseCommonsPages(pages) {
    const candidates = [];
    const rejected = { license: 0, noAuthor: 0, notPhoto: 0, noInfo: 0 };
    const rejectedLicenses = {};
    for (const page of pages ?? []) {
        const info = page?.imageinfo?.[0];
        if (!info) { rejected.noInfo++; continue; }
        const meta = info.extmetadata ?? {};
        const license = String(meta.LicenseShortName?.value ?? "").trim();
        if (!isAllowedLicense(license)) {
            rejected.license++;
            rejectedLicenses[license || "(空)"] = (rejectedLicenses[license || "(空)"] ?? 0) + 1;
            continue;
        }
        if (!PHOTO_MIMES.has(info.mime)) { rejected.notPhoto++; continue; }
        const author = creditFor(stripHtml(meta.Artist?.value) || stripHtml(meta.Credit?.value), license);
        if (!author) { rejected.noAuthor++; continue; }
        const licenseUrl = String(meta.LicenseUrl?.value ?? "").trim().replace(/^http:\/\//, "https://");
        const description = stripHtml(meta.ImageDescription?.value).slice(0, 160);
        const restrictions = stripHtml(meta.Restrictions?.value);
        candidates.push({
            file: page.title,
            title: stripHtml(meta.ObjectName?.value) || page.title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, ""),
            pageUrl: info.descriptionurl,
            thumbUrl: cleanUrl(info.thumburl ?? info.url),
            thumbWidth: info.thumbwidth ?? info.width,
            thumbHeight: info.thumbheight ?? info.height,
            width: info.width,
            height: info.height,
            mime: info.mime,
            author,
            license,
            ...(licenseUrl ? { licenseUrl } : {}),
            ...(plainDate(meta.DateTimeOriginal?.value) ? { dateTimeOriginal: plainDate(meta.DateTimeOriginal?.value) } : {}),
            ...(description ? { description } : {}),
            ...(restrictions ? { restrictions } : {}),
            // 写真の撮影位置そのものは持たない。探した中心からの距離（m）だけ
            ...(typeof page.coordinates?.[0]?.dist === "number" ? { distanceM: Math.round(page.coordinates[0].dist) } : {}),
        });
    }
    return { candidates, rejected, rejectedLicenses };
}

/**
 * 探す中心。台帳の座標と、Wikidata の座標（あれば・台帳から 150m〜3km の間）。
 * 台帳の座標は約1km に丸めてあるので、本当の場所から 500m 以上ずれることがある
 */
export function searchCenters(spot, wikidataCoords) {
    const centers = [];
    if (spot.coords) centers.push({ lat: spot.coords.lat, lng: spot.coords.lng, from: "ledger" });
    if (wikidataCoords && spot.coords) {
        const d = distanceKm(spot.coords, wikidataCoords);
        if (d >= 0.15 && d <= 3) centers.push({ lat: wikidataCoords.lat, lng: wikidataCoords.lng, from: "wikidata" });
    } else if (wikidataCoords && !spot.coords) {
        centers.push({ lat: wikidataCoords.lat, lng: wikidataCoords.lng, from: "wikidata" });
    }
    return centers;
}

/** 候補を足し合わせる（同じファイルは近い方の距離を残す） */
export function mergeCandidates(lists) {
    const byFile = new Map();
    for (const c of lists.flat()) {
        const prev = byFile.get(c.file);
        if (!prev || (c.distanceM ?? Infinity) < (prev.distanceM ?? Infinity)) byFile.set(c.file, c);
    }
    return [...byFile.values()];
}

// ---- 通信 --------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
export let requestCount = 0;

async function api(base, params) {
    const url = `${base}?${new URLSearchParams({ format: "json", formatversion: "2", maxlag: "5", ...params })}`;
    for (let attempt = 0; attempt < 8; attempt++) {
        const wait = lastCall + MIN_INTERVAL_MS - Date.now();
        if (wait > 0) await sleep(wait);
        lastCall = Date.now();
        requestCount++;
        const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT } });
        if (res.status === 429 || res.status >= 500) {
            const after = Number(res.headers.get("retry-after")) || 10 * (attempt + 1);
            console.log(`  ${res.status}・${after}秒待つ`);
            await sleep(after * 1000);
            continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
        const body = await res.json();
        if (body?.error?.code === "maxlag") {
            await sleep((Number(res.headers.get("retry-after")) || 5) * 1000);
            continue;
        }
        if (body?.error) throw new Error(`${body.error.code}: ${body.error.info}`);
        return body;
    }
    throw new Error(`API が応答しません: ${url}`);
}

const EXTMETA = ["Artist", "Credit", "LicenseShortName", "LicenseUrl", "DateTimeOriginal", "ImageDescription", "ObjectName", "Restrictions"];

/** 1つの中心の周りの候補（続きのページも辿る） */
async function geosearch(center, radiusM) {
    const params = {
        action: "query",
        generator: "geosearch",
        ggscoord: `${center.lat}|${center.lng}`,
        ggsradius: String(radiusM),
        ggsnamespace: "6",
        ggslimit: "100",
        prop: "imageinfo|coordinates",
        iiprop: "url|extmetadata|size|mime",
        iiurlwidth: String(THUMB_WIDTH),
        iiextmetadatafilter: EXTMETA.join("|"),
        iiextmetadatalanguage: "ja",
        codistancefrompoint: `${center.lat}|${center.lng}`,
        // 🔴 既定は 10 件。これを付けないと 100 件の座標を取るのに続きのページを10回辿る
        // （1スポット11回の要求になっていた・2026-10-03 実測）
        colimit: "max",
    };
    const pages = new Map();
    let cont = {};
    for (let i = 0; i < 20; i++) {
        const r = await api(COMMONS, { ...params, ...cont });
        for (const p of r.query?.pages ?? []) {
            const prev = pages.get(p.pageid) ?? {};
            pages.set(p.pageid, { ...prev, ...p, imageinfo: p.imageinfo ?? prev.imageinfo, coordinates: p.coordinates ?? prev.coordinates });
        }
        if (!r.continue) break;
        // 続きは imageinfo・coordinates の取り残しだけ辿る（geosearch の次の束へは進まない＝近い100件まで）
        const { ggsoffset: _skip, ...rest } = r.continue;
        void _skip;
        if (Object.keys(rest).filter((k) => k !== "continue").length === 0) break;
        cont = rest;
    }
    return [...pages.values()];
}

/** Wikidata の座標を Q-ID ごとに（50件ずつまとめて聞く） */
async function wikidataCoords(ids) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += 50) {
        const r = await api(WIKIDATA, { action: "wbgetentities", ids: ids.slice(i, i + 50).join("|"), props: "claims" });
        for (const [id, e] of Object.entries(r.entities ?? {})) {
            const v = e?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
            if (v) out.set(id, { lat: v.latitude, lng: v.longitude });
        }
    }
    return out;
}

// ---- CLI --------------------------------------------------------------------

function readJson(p, fallback) {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function writeJson(p, data) {
    fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * 候補ファイルの書き方。**1候補を1行**にする（字下げ2だと全国で 13MB・差分も読みにくい）。
 * スポットの見出しの項目はふつうに字下げする
 */
export function formatCandidatesFile(data) {
    const { spots = {}, ...head } = data;
    const lines = ["{"];
    for (const [k, v] of Object.entries(head)) lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
    lines.push('  "spots": {');
    const ids = Object.keys(spots).sort();
    ids.forEach((id, i) => {
        const { candidates = [], ...rest } = spots[id];
        lines.push(`    ${JSON.stringify(id)}: {`);
        for (const [k, v] of Object.entries(rest)) lines.push(`      ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
        lines.push('      "candidates": [');
        candidates.forEach((c, j) => lines.push(`        ${JSON.stringify(c)}${j < candidates.length - 1 ? "," : ""}`));
        lines.push("      ]");
        lines.push(`    }${i < ids.length - 1 ? "," : ""}`);
    });
    lines.push("  }", "}");
    return `${lines.join("\n")}\n`;
}

/** 1スポットの候補を、自動で採るもの＋点数の高い順に `KEEP_CANDIDATES` 件まで残す */
export function trimCandidates(scored) {
    const picked = new Set(pickSamples(scored).map((c) => c.file));
    return [...scored.filter((c) => picked.has(c.file)), ...scored.filter((c) => !picked.has(c.file))]
        .slice(0, Math.max(KEEP_CANDIDATES, picked.size))
        .sort((a, b) => b.score - a.score || (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
}

/**
 * 候補ファイルから確定ファイルを作る。
 *
 * - 候補ファイルに無いスポット（ほかの県など）は、前の確定ファイルのまま残す
 * - **人が選んだ1枚（`pickedBy` が "auto" 以外）は消さない**。先頭に残し、残りの枠を自動で埋める
 * - `keep` のときは、前の確定ファイルにあるスポットを丸ごと触らない
 */
export function buildSamplesFile(candidatesFile, spots, previous = {}, keep = false) {
    const out = { ...previous };
    for (const [spotId, entry] of Object.entries(candidatesFile.spots ?? {})) {
        if (keep && previous[spotId]) continue;
        const spot = spots.find((s) => s.spotId === spotId);
        if (!spot) continue;
        const human = (previous[spotId]?.samples ?? []).filter((s) => s.pickedBy && s.pickedBy !== "auto");
        const taken = new Set(human.map((s) => s.file));
        // 点数は**いまの規則で付け直す**（規則を直したら --pick-only で選び直せる）
        const rescored = (entry.candidates ?? []).map((c) => ({ ...c, ...scoreCandidate(spot, c) }));
        const auto = pickSamples(rescored.filter((c) => !taken.has(c.file)),
            { max: Math.max(0, MAX_SAMPLES - human.length) });
        const samples = [...human, ...auto.map((c) => toSample(c))];
        if (samples.length === 0) { delete out[spotId]; continue; }
        out[spotId] = { slug: spot.slug, name: spot.name, samples };
    }
    return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
}

async function main(argv) {
    const args = argv.slice(2);
    const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const spots = readJson(LEDGER_PATH, []);
    const only = arg("slug")?.split(",").filter(Boolean);
    const prefecture = arg("prefecture");
    const radiusM = clampRadius(arg("radius") ?? DEFAULT_RADIUS_M);
    const all = args.includes("--all");
    if (!only && !prefecture && !all) {
        console.error("--prefecture=… か --slug=… か --all を付けてください");
        return 1;
    }
    const candidatesFile = readJson(CANDIDATES_PATH, { spots: {} });
    const refresh = args.includes("--refresh");
    const targets = spots.filter((s) => s.status === "published"
        && (only ? only.includes(s.slug) : true)
        && (prefecture ? s.region?.prefecture === prefecture : true)
        // 済んだ spotId は飛ばす（止まっても続きから）。--slug で名指ししたものは取り直す
        && (refresh || only ? true : !candidatesFile.spots[s.spotId]));
    candidatesFile.note = "機械が集めた候補。人が選ぶ材料で、画面には出ない（出すのは spot-samples.json）。"
        + "写真そのものの撮影位置は持たない（distanceM は探した中心からの距離）。";
    candidatesFile.radiusM = radiusM;

    if (!args.includes("--pick-only")) {
        const images = readJson(SPOT_IMAGES_PATH, {});
        const ids = [...new Set(targets.map((s) => images[s.slug]?.wikidata).filter(Boolean))];
        const wd = ids.length ? await wikidataCoords(ids) : new Map();
        const today = new Date().toISOString().slice(0, 10);
        let n = 0;
        for (const spot of targets) {
            n++;
            const centers = searchCenters(spot, wd.get(images[spot.slug]?.wikidata));
            const lists = [];
            const rejected = { license: 0, noAuthor: 0, notPhoto: 0, noInfo: 0 };
            const rejectedLicenses = {};
            let found = 0;
            try {
                for (const center of centers) {
                    const pages = await geosearch(center, radiusM);
                    found += pages.length;
                    const parsed = parseCommonsPages(pages);
                    lists.push(parsed.candidates);
                    for (const k of Object.keys(rejected)) rejected[k] += parsed.rejected[k];
                    for (const [k, v] of Object.entries(parsed.rejectedLicenses)) rejectedLicenses[k] = (rejectedLicenses[k] ?? 0) + v;
                }
            } catch (e) {
                console.log(`[${n}/${targets.length}] ${spot.slug}: error ${e.message}`);
                continue;
            }
            const scored = mergeCandidates(lists).map((c) => {
                const { score, reasons, named } = scoreCandidate(spot, c);
                return { ...c, score, reasons, named };
            }).sort((a, b) => b.score - a.score || (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
            // 自動で採るものは必ず残し、残りの枠を点数の高い順に埋める
            const picked = new Set(pickSamples(scored).map((c) => c.file));
            const candidates = trimCandidates(scored);
            candidatesFile.spots[spot.spotId] = {
                slug: spot.slug, name: spot.name, prefecture: spot.region?.prefecture ?? spot.region?.country ?? "",
                searchedAt: today, radiusM, centers, filesFound: found,
                usable: scored.length, named: scored.filter((c) => c.named).length,
                rejected, rejectedLicenses, candidates,
            };
            console.log(`[${n}/${targets.length}] ${spot.slug}: 見つかった ${found}・使える ${scored.length}・名前一致 ${scored.filter((c) => c.named).length}・自動で採れる ${picked.size}`);
            candidatesFile.spots = Object.fromEntries(Object.keys(candidatesFile.spots).sort().map((k) => [k, candidatesFile.spots[k]]));
            fs.writeFileSync(CANDIDATES_PATH, formatCandidatesFile(candidatesFile));
        }
        console.log(`[spot-samples] 要求 ${requestCount} 回`);
    }

    const previous = readJson(SAMPLES_PATH, {});
    const samples = buildSamplesFile(candidatesFile, spots, previous, args.includes("--keep-picks"));
    writeJson(SAMPLES_PATH, samples);
    const total = Object.values(samples).reduce((a, e) => a + e.samples.length, 0);
    console.log(`[spot-samples] 確定 ${Object.keys(samples).length} スポット・${total} 枚`);
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv).then((code) => process.exit(code));
}
