#!/usr/bin/env node
// scripts/spot-cover-large.mjs
//
// **代表写真の「横 1,200px 以上の版」の在りかを記録する。**（2026-10-22・SEO）
//
// サイトに置いた代表写真（`local`）は横 960px で、Google の画像検索・Discover が優先する
// 横 1,200px 以上に届かない。Commons には同じ写真の横 1280px の縮小版（標準の幅・作り置きあり）が
// 既にあるので、その URL と寸法を `content/spot-images.json` の `large` に書く。
// **画像は落とさない・変換しない・どこにも置かない**（費用の増える処理を足さない）。
//
// 使うのは og:image・twitter:image・構造化データ・画像サイトマップだけ（`spotSeoImage`）。
// ページの `<img>` は今までどおりサイトに置いた 960px（外へのホットリンクをしない・LCP を変えない）。
//
// 寸法の出どころ（どれも Commons の API が返した縮小版の寸法そのもの）:
//   1. `content/spot-samples.json`（作例の確定ファイル）
//   2. `content/spot-samples.candidates.json`（作例の候補）
//   3. `--fetch` を付けたときだけ Commons の API（imageinfo・iiurlwidth=1280）。1分に1回・429 は待つ
//
//   node scripts/spot-cover-large.mjs            手元のファイルだけで埋める
//   node scripts/spot-cover-large.mjs --fetch    足りない分を Commons の API で埋める
//   node scripts/spot-cover-large.mjs --check    書かずに数だけ出す

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const IMAGES_PATH = path.join(ROOT, "content", "spot-images.json");
const SAMPLES_PATH = path.join(ROOT, "content", "spot-samples.json");
const CANDIDATES_PATH = path.join(ROOT, "content", "spot-samples.candidates.json");
const USER_AGENT = "JourneyPhotoSpotImages/1.0 (https://journey-photo.com)";
/** `lib/data/spotImages.ts` の `SEO_IMAGE_MIN_WIDTH` と同じ */
export const MIN_WIDTH = 1200;
/** Commons に頼む幅（標準の幅のうち 1,200 以上で一番小さいもの） */
export const LARGE_WIDTH = 1280;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ファイル名を比べる形（"File:" の有無・"_" と空白の揺れを吸収） */
export function fileKey(file) {
    return String(file ?? "").normalize("NFC").replace(/_/g, " ").replace(/\s+/g, " ").trim().replace(/^(file|ファイル)\s*:\s*/i, "");
}

/** Commons の画像の URL の最後のファイル名（縮小版なら元のファイル名の部分）を比べる形で */
export function fileKeyOfUpload(url) {
    const m = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)(?:\/[^/]+)?$/.exec(String(url ?? ""));
    if (!m) return undefined;
    try {
        return fileKey(decodeURIComponent(m[1]));
    } catch {
        return undefined;
    }
}

/**
 * 1枚の大きい版の記録として使えるか。**同じファイルの** Commons の画像で、横 `MIN_WIDTH` 以上
 */
export function usableLarge(file, rec) {
    if (!rec || !(rec.width >= MIN_WIDTH) || !(rec.height > 0)) return false;
    const k = fileKeyOfUpload(rec.src);
    return Boolean(k) && k === fileKey(file);
}

/** 手元のファイル（作例の確定・候補）から ファイル名 → { src, width, height } */
export function knownSizes(samplesFile, candidatesFile) {
    const map = new Map();
    const add = (file, thumbUrl, width, height) => {
        if (!file || !thumbUrl || !(width > 0) || !(height > 0)) return;
        const src = String(thumbUrl).replace(/^http:\/\//, "https://");
        if (!fileKeyOfUpload(src)) return;
        map.set(fileKey(file), { src, width, height });
    };
    for (const s of Object.values(candidatesFile?.spots ?? {})) {
        for (const c of s.candidates ?? []) add(c.file, c.thumbUrl, c.width, c.height);
    }
    // 確定ファイルが後（同じファイルなら確定ファイルの値を使う）
    for (const s of Object.values(samplesFile ?? {})) {
        for (const r of s.samples ?? []) add(r.file, r.thumbUrl, r.width, r.height);
    }
    return map;
}

async function fetchSizes(files) {
    const out = new Map();
    for (let i = 0; i < files.length; i += 50) {
        const titles = files.slice(i, i + 50).map((f) => (/^file:/i.test(f) ? f : `File:${f}`));
        const qs = new URLSearchParams({
            action: "query", format: "json", formatversion: "2", prop: "imageinfo",
            iiprop: "size|url", iiurlwidth: String(LARGE_WIDTH), titles: titles.join("|"),
        });
        let json = null;
        for (let attempt = 0; attempt < 6 && !json; attempt++) {
            const res = await fetch(`https://commons.wikimedia.org/w/api.php?${qs}`, { headers: { "User-Agent": USER_AGENT } });
            if (res.ok) {
                try { json = await res.json(); } catch { json = null; }
            }
            if (!json) await sleep((Number(res.headers.get("retry-after")) || 60) * 1000);
        }
        for (const p of json?.query?.pages ?? []) {
            const ii = p.imageinfo?.[0];
            if (!ii) continue;
            out.set(fileKey(p.title), {
                src: ii.thumburl ?? ii.url,
                width: ii.thumbwidth ?? ii.width,
                height: ii.thumbheight ?? ii.height,
            });
        }
        await sleep(60_000);
    }
    return out;
}

async function main() {
    const check = process.argv.includes("--check");
    const doFetch = process.argv.includes("--fetch");
    const images = JSON.parse(fs.readFileSync(IMAGES_PATH, "utf8"));
    const read = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {});
    const known = knownSizes(read(SAMPLES_PATH), read(CANDIDATES_PATH));
    const targets = Object.entries(images).filter(([, img]) => img.local && img.file);
    if (doFetch && !check) {
        const missing = targets.filter(([, img]) => !known.has(fileKey(img.file))).map(([, img]) => img.file);
        console.log(`Commons に尋ねる: ${missing.length} 件`);
        for (const [k, v] of await fetchSizes(missing)) known.set(k, v);
    }
    let large = 0, small = 0, unknown = 0, changed = 0;
    for (const [, img] of targets) {
        const rec = known.get(fileKey(img.file));
        if (!rec) { unknown++; continue; }
        if (usableLarge(img.file, rec)) {
            large++;
            const next = { src: rec.src, width: rec.width, height: rec.height };
            if (JSON.stringify(img.large) !== JSON.stringify(next)) { img.large = next; changed++; }
        } else {
            small++;
            if (img.large) { delete img.large; changed++; }
        }
    }
    console.log(`サイトに置いた代表写真 ${targets.length}: 横 ${MIN_WIDTH}px 以上の版あり ${large}・無し ${small}・寸法が分からない ${unknown}`);
    if (check) return;
    if (changed > 0) fs.writeFileSync(IMAGES_PATH, JSON.stringify(images, null, 2) + "\n");
    console.log(`書き換えた ${changed} 件`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
