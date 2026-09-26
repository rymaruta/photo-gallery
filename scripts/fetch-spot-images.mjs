#!/usr/bin/env node
// scripts/fetch-spot-images.mjs
//
// **撮影スポットの写真を Wikimedia Commons から集める。**（2026-09-26）
//
// スポット台帳（content/spots.json）は写真を持たない。地図のピンを
// 「写真の丸・真鍮の縁」（デザイン 07）にするため、各スポットの Wikidata の
// 代表画像（P18）を探し、**自由に使えるライセンスのものだけ**を
// content/spot-images.json に記録する。
//
//   node scripts/fetch-spot-images.mjs                 全件（記録済みは飛ばす）
//   node scripts/fetch-spot-images.mjs --limit=50      先頭から50件だけ
//   node scripts/fetch-spot-images.mjs --slug=a,b      指定のスポットだけ
//   node scripts/fetch-spot-images.mjs --refresh       記録済みも取り直す
//
// **機械で決められるものだけ採る:**
//   - Wikidata の候補は**座標で確かめる**（点の場所 2km・広い場所 5km 以内）。
//     名前が同じ別の場所（同名の滝・寺）を拾わないため
//   - 画像は Wikidata の P18（人が選んで登録した代表画像）だけ。近くで撮られた
//     写真を当てはめることはしない（別の場所が写る）
//   - ライセンスは CC0・パブリックドメイン・CC BY・CC BY-SA だけ。
//     NC（商用不可）・ND（改変不可）・不明は捨てる
//   - `reviewedBy` は必ず null。**owner が「写真が合っている」と確かめたら
//     人の名前が入る欄で、機械では埋めない**（台帳の verifiedBy と同じ考え方）
//
// 🔴 **台帳は触らない。** 台帳には owner の確認の規則とテストがある。
//
// Wikimedia の API は同じ出口の IP を数えて絞る（429）。**1.5秒に1回・
// 429 は retry-after を待つ**。途中経過を毎回書くので、止まっても続きから走る。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
export const LEDGER_PATH = path.join(ROOT, "content", "spots.json");
export const IMAGES_PATH = path.join(ROOT, "content", "spot-images.json");

const USER_AGENT = "JourneyPhotoSpotImages/1.0 (https://journey-photo.com)";
const WIKIDATA = "https://www.wikidata.org/w/api.php";
const COMMONS = "https://commons.wikimedia.org/w/api.php";

/** 広がりのある場所。代表座標がずれやすいので 5km まで許す */
export const AREA_CATEGORIES = new Set([
    "町並み", "街並み", "海岸", "公園", "山岳", "渓谷", "湖沼", "湖", "島", "棚田", "鉄道",
    "祭り", "高原", "岬", "農村", "並木道", "湿原", "森林", "渓流", "温泉", "動物", "市場",
]);
export const POINT_KM = 2;
export const AREA_KM = 5;

export function maxDistanceKm(category) {
    return AREA_CATEGORIES.has(category) ? AREA_KM : POINT_KM;
}

/** 2点間の距離（km・球面） */
export function distanceKm(a, b) {
    const R = 6371;
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * **採ってよいライセンスか。** Commons の `LicenseShortName` を見る。
 * 許すのは CC0・Public domain（PD-…）・CC BY・CC BY-SA（版は問わない）。
 * NC・ND が入るもの、GFDL だけのもの、空は捨てる
 */
export function isAllowedLicense(shortName) {
    const s = String(shortName ?? "").trim();
    if (!s) return false;
    if (/\b(NC|ND)\b/i.test(s) || /noncommercial|no ?deriv/i.test(s)) return false;
    if (/^cc0\b/i.test(s) || /^cc[- ]zero/i.test(s)) return true;
    if (/^public domain$/i.test(s) || /^pd\b|^pd-/i.test(s)) return true;
    if (/^cc[- ]by(-sa)?(\s|-|$)/i.test(s)) return true;
    return false;
}

/** 作者の欄（HTML）を平文にする。リンク・タグ・実体参照を剥がし、空白を畳む */
export function stripHtml(html) {
    return String(html ?? "")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#0?39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
}

/** 検索に使う名前。**全角の括弧書きは外す**（「清水渓流広場（濃溝の滝…）」→「清水渓流広場」）＋別名 */
export function searchNames(spot) {
    const base = String(spot.name ?? "").replace(/[（(].*?[）)]/g, "").trim();
    const names = [base, ...(spot.aliases ?? [])].filter(Boolean);
    return [...new Set(names)].slice(0, 3);
}

/** 名前を比べる形（空白・中黒・括弧書きを落とす） */
export function normalizeName(name) {
    return String(name ?? "").replace(/[（(].*?[）)]/g, "").replace(/[\s・･]/g, "").trim();
}

/**
 * 名前が同じなら許す距離（km）。**台帳の座標がずれている行がある**
 * （2026-09-26 実測: 高屋神社は Wikidata から約3.4km、清水渓流広場は約6km）。
 * 名前が一致する候補だけ、ここまで離れていても採り、`coordsMismatch` を立てる
 */
export const SAME_NAME_KM = 15;

/**
 * 候補（`{ id, label, coords, image }`）から1つ選ぶ。
 *   1. 許す距離（点 2km・広い場所 5km）の内で最も近いもの
 *   2. 無ければ、**名前が一致し** 15km 以内で最も近いもの（座標のずれとして印を付ける）
 * 座標の無い候補は採らない（確かめようが無い）
 */
export function pickCandidate(spot, candidates) {
    const limit = maxDistanceKm(spot.category);
    const names = new Set(searchNames(spot).map(normalizeName));
    let near = null;
    let named = null;
    for (const c of candidates) {
        if (!c.coords) continue;
        const d = Math.round(distanceKm(spot.coords, c.coords) * 100) / 100;
        if (d <= limit) {
            if (!near || d < near.distanceKm) near = { ...c, distanceKm: d };
        } else if (d <= SAME_NAME_KM && names.has(normalizeName(c.label))) {
            if (!named || d < named.distanceKm) named = { ...c, distanceKm: d, coordsMismatch: true };
        }
    }
    return near ?? named;
}

// ---- 通信 --------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;

async function api(base, params) {
    const url = `${base}?${new URLSearchParams({ format: "json", maxlag: "5", ...params })}`;
    for (let attempt = 0; attempt < 8; attempt++) {
        const wait = lastCall + 1500 - Date.now();
        if (wait > 0) await sleep(wait);
        lastCall = Date.now();
        const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
        if (res.status === 429 || res.status >= 500) {
            const after = Number(res.headers.get("retry-after")) || 5 * (attempt + 1);
            await sleep(after * 1000);
            continue;
        }
        const body = await res.json();
        if (body?.error?.code === "maxlag") {
            await sleep(5000);
            continue;
        }
        return body;
    }
    throw new Error(`API が応答しません: ${url}`);
}

/**
 * 画像の URL を整える。追跡用の引数（utm_…）を落とし、**配信元を
 * upload.wikimedia.org に揃える**（API は thumb.wikimedia.org を返すことがあるが、
 * 同じ道筋で upload.wikimedia.org からも配られる。許可するドメインを1つにする）
 */
export function cleanUrl(url) {
    const u = new URL(url);
    if (u.hostname === "thumb.wikimedia.org") u.hostname = "upload.wikimedia.org";
    for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k);
    return u.toString();
}

function claimCoords(entity) {
    const v = entity?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
    return v ? { lat: v.latitude, lng: v.longitude } : null;
}
function claimImage(entity) {
    return entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value ?? null;
}

async function candidatesFor(spot) {
    const ids = new Set();
    for (const name of searchNames(spot)) {
        const r = await api(WIKIDATA, { action: "wbsearchentities", search: name, language: "ja", uselang: "ja", type: "item", limit: "7" });
        for (const hit of r.search ?? []) ids.add(hit.id);
        if (ids.size) break;
    }
    if (!ids.size) return [];
    const r = await api(WIKIDATA, { action: "wbgetentities", ids: [...ids].join("|"), props: "claims|labels", languages: "ja" });
    return Object.values(r.entities ?? {}).map((e) => ({
        id: e.id, label: e.labels?.ja?.value ?? "", coords: claimCoords(e), image: claimImage(e),
    }));
}

async function imageInfo(file) {
    const r = await api(COMMONS, {
        action: "query", titles: `File:${file}`, prop: "imageinfo",
        iiprop: "url|extmetadata", iiurlwidth: "640",
    });
    const page = Object.values(r.query?.pages ?? {})[0];
    const info = page?.imageinfo?.[0];
    if (!info) return null;
    const meta = info.extmetadata ?? {};
    return {
        file: `File:${file}`,
        pageUrl: info.descriptionurl,
        thumbUrl: cleanUrl(info.thumburl ?? info.url),
        author: stripHtml(meta.Artist?.value) || stripHtml(meta.Credit?.value) || "",
        license: meta.LicenseShortName?.value ?? "",
        licenseUrl: meta.LicenseUrl?.value ?? "",
    };
}

/** 1件を調べる。結果は `{ status, record? }` */
export async function lookup(spot, today) {
    if (!spot.coords) return { status: "no-coords" };
    const candidates = await candidatesFor(spot);
    const best = pickCandidate(spot, candidates);
    if (!best) return { status: candidates.length ? "too-far" : "not-found" };
    const where = { wikidata: best.id, distanceKm: best.distanceKm, ...(best.coordsMismatch ? { coordsMismatch: true, wikidataCoords: best.coords } : {}) };
    if (!best.image) return { status: "no-image", ...where };
    const info = await imageInfo(best.image);
    if (!info) return { status: "no-image", ...where };
    if (!isAllowedLicense(info.license)) return { status: "license-rejected", ...where, license: info.license };
    return {
        status: "ok",
        ...where,
        record: {
            wikidata: best.id, ...info, distanceKm: best.distanceKm,
            ...(best.coordsMismatch ? { coordsMismatch: true } : {}),
            method: "wikidata-P18", fetchedAt: today, reviewedBy: null,
        },
    };
}

// ---- CLI --------------------------------------------------------------------

function readJson(p, fallback) {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

async function main(argv) {
    const args = argv.slice(2);
    const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const refresh = args.includes("--refresh");
    const spots = readJson(LEDGER_PATH, []);
    const images = readJson(IMAGES_PATH, {});
    const logPath = path.join(ROOT, "content", ".spot-images-log.json");
    const log = readJson(logPath, {});
    const only = arg("slug")?.split(",");
    let targets = spots.filter((s) => (only ? only.includes(s.slug) : true));
    if (!refresh) targets = targets.filter((s) => !images[s.slug] && !log[s.slug]);
    const limit = Number(arg("limit")) || targets.length;
    targets = targets.slice(0, limit);
    const today = new Date().toISOString().slice(0, 10);

    let n = 0;
    for (const spot of targets) {
        n++;
        try {
            const r = await lookup(spot, today);
            if (r.record) images[spot.slug] = r.record;
            const rest = { ...r };
            delete rest.record;
            log[spot.slug] = rest;
            console.log(`[${n}/${targets.length}] ${spot.slug}: ${r.status}${r.record ? `（${r.record.license}・${r.record.distanceKm}km）` : ""}`);
        } catch (e) {
            console.log(`[${n}/${targets.length}] ${spot.slug}: error ${e.message}`);
        }
        const sorted = Object.fromEntries(Object.keys(images).sort().map((k) => [k, images[k]]));
        fs.writeFileSync(IMAGES_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
        fs.writeFileSync(logPath, `${JSON.stringify(log, null, 2)}\n`);
    }
    const counts = {};
    for (const v of Object.values(log)) counts[v.status] = (counts[v.status] ?? 0) + 1;
    console.log("[spot-images] 集計", counts, "記録", Object.keys(images).length);
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv).then((code) => process.exit(code));
}
