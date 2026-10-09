#!/usr/bin/env node
// scripts/localize-spot-images.mjs
//
// **撮影スポットの写真をサイトの中に置く。**（2026-09-26）
//
// `content/spot-images.json` の写真は Wikimedia Commons にある。Web のスポットの
// ページは代表写真を**サイト内に置いたものだけ**出す（`SpotCoverImage.src` の決まり
// ——外部へのホットリンクはしない）。そこで、**公開済みのスポットの写真だけ**を
// 横 960px の JPEG にして `public/images/spots/<slug>.jpg` に置き、置いた場所と
// 寸法を `spot-images.json` の `local` に書く。
//
//   node scripts/localize-spot-images.mjs              公開済みで、まだ置いていないもの
//   node scripts/localize-spot-images.mjs --slug=a,b   指定のスポットだけ（置き直す）
//
// 下書きの写真は置かない（ページが建たないので、置いても誰も見ない）。
// Wikimedia は同じ出口の IP を数えて絞る（429）。**3秒に1回・429 は待って取り直す**。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { syncSpotThumbs } from "./spot-thumbs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const LEDGER_PATH = path.join(ROOT, "content", "spots.json");
const IMAGES_PATH = path.join(ROOT, "content", "spot-images.json");
const OUT_DIR = path.join(ROOT, "public", "images", "spots");
const USER_AGENT = "JourneyPhotoSpotImages/1.0 (https://journey-photo.com)";
export const WIDTH = 960;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Commons の元画像の URL から、横 `width` px の縮小版の URL を作る。
 * 形が違えば null（縮小版を作れない＝元画像を落として縮める）
 */
export function commonsThumbUrl(originalUrl, width = WIDTH) {
    const m = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/([0-9a-f]\/[0-9a-f]{2})\/([^/?#]+)$/.exec(
        (originalUrl ?? "").split("?")[0],
    );
    if (!m) return null;
    return `https://upload.wikimedia.org/wikipedia/commons/thumb/${m[1]}/${m[2]}/${width}px-${m[2]}`;
}

async function download(url) {
    for (let attempt = 0; attempt < 6; attempt++) {
        const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
        if (res.ok) return Buffer.from(await res.arrayBuffer());
        if (res.status === 429 || res.status >= 500) {
            const wait = Number(res.headers.get("retry-after")) || 15 * (attempt + 1);
            console.log(`  ${res.status}・${wait}秒待つ`);
            await sleep(wait * 1000);
            continue;
        }
        // 元画像が 960px より小さいと縮小版は作れない（4xx）。呼び出し側が元画像へ倒す
        return null;
    }
    return null;
}

function isShown(spot, image) {
    if (spot.status !== "published" || !image) return false;
    if (image.reviewedBy?.trim()) return true;
    return spot.aiCheck?.imageChecked === true && !image.coordsMismatch;
}

async function main() {
    const only = process.argv.find((a) => a.startsWith("--slug="))?.slice(7).split(",").filter(Boolean);
    const spots = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
    const images = JSON.parse(fs.readFileSync(IMAGES_PATH, "utf8"));
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const targets = spots.filter((s) => (only ? only.includes(s.slug) : isShown(s, images[s.slug]) && !images[s.slug].local));
    let done = 0;
    for (const spot of targets) {
        const image = images[spot.slug];
        if (!image) { console.log(`${spot.slug}: 写真の記録が無い`); continue; }
        const thumb = commonsThumbUrl(image.thumbUrl);
        let buf = thumb ? await download(thumb) : null;
        if (!buf) buf = await download(image.thumbUrl.split("?")[0]);
        if (!buf) { console.log(`${spot.slug}: 取れなかった`); continue; }
        const out = await sharp(buf).rotate().resize({ width: WIDTH, withoutEnlargement: true })
            .jpeg({ quality: 78, mozjpeg: true }).toBuffer({ resolveWithObject: true });
        fs.writeFileSync(path.join(OUT_DIR, `${spot.slug}.jpg`), out.data);
        image.local = { src: `/images/spots/${spot.slug}.jpg`, width: out.info.width, height: out.info.height };
        fs.writeFileSync(IMAGES_PATH, JSON.stringify(images, null, 2) + "\n");
        done++;
        console.log(`${spot.slug}: ${out.info.width}x${out.info.height} ${Math.round(out.data.length / 1024)}KB`);
        await sleep(3000);
    }
    console.log(`置いた ${done} / ${targets.length}`);
    // 小さい版（`public/images/spots/thumb/`・アプリの `thumbUrl`）も揃える。差し替えた写真は元の
    // SHA-1 で見分けて作り直す（`scripts/spot-thumbs.mjs`）。本番のビルドも同じことをするので、
    // ここで落ちても止めない
    try {
        const t = await syncSpotThumbs();
        console.log(`小さい版: 作った ${t.created.length}・消した ${t.removed.length}・作れなかった ${t.failed.length}`);
    } catch (e) {
        console.log(`小さい版を作れなかった（本番のビルドが作る）: ${e instanceof Error ? e.message : e}`);
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
