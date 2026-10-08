#!/usr/bin/env node
// scripts/spot-thumbs.mjs
//
// **撮影スポットの写真の小さい版（サムネ）を作る。**（2026-10-08）
//
// アプリ（iOS）は地図・一覧で撮影スポットの写真を 40pt の丸で出す。そこへ横 960px の
// `public/images/spots/<slug>.jpg`（平均 約148KB）を丸ごと落としていたので、
// **短い辺 240px**（3倍の画面の 40pt ×2 の余裕）の JPEG を隣に置く:
//
//     public/images/spots/<slug>.jpg         元（横 960px・`localize-spot-images.mjs`）
//     public/images/spots/thumb/<slug>.jpg   サムネ（短い辺 240px・品質 70・プログレッシブ）
//
// アプリ向けの JSON は**サムネのファイルが在るときだけ** `image.thumbUrl` を出す
// （`lib/data/spotThumbs.ts`・`lib/data/spotFeed.ts`）。
//
//     node scripts/spot-thumbs.mjs           無い・形の合わないサムネだけ作る（既定）
//     node scripts/spot-thumbs.mjs --force   全部作り直す
//     node scripts/spot-thumbs.mjs --check   書かずに調べる（無い・形違い・元の無いサムネがあれば終了コード 1）
//
// **本番のビルド（`scripts/prepare-static-build.js`）が `next build` の前に既定の形で流す。**
// だから写真を足した PR がサムネを忘れても、デプロイで作られて配られる（作れなかった回は
// `thumbUrl` が出ないだけ＝アプリは元の写真に戻る）。手元で作ってコミットしておけば、
// デプロイのたびに作り直す手間（と時間）が要らない。
//
// 外部への通信はしない（手元の `public/images/spots/*.jpg` から縮めるだけ）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

/** 元の写真の置き場 */
export const SRC_DIR = path.join(ROOT, "public", "images", "spots");
/** サムネの置き場（元の置き場の下の `thumb/`）。`lib/data/spotThumbs.ts` の `SPOT_THUMB_DIR` と同じ */
export const THUMB_DIR_NAME = "thumb";
export const THUMB_DIR = path.join(SRC_DIR, THUMB_DIR_NAME);
/** 短い辺の長さ（px）。長い辺は縦横比のまま（切り抜かない） */
export const THUMB_SHORT_SIDE = 240;
export const THUMB_QUALITY = 70;

/**
 * 元の寸法から、サムネの寸法。**短い辺を `short` に**し、長い辺は縦横比のまま（四捨五入）。
 * 元が既に小さければ引き伸ばさない（元の寸法のまま）
 */
export function thumbSizeFor(width, height, short = THUMB_SHORT_SIDE) {
    const min = Math.min(width, height);
    if (!(min > short)) return { width, height };
    const scale = short / min;
    return width <= height
        ? { width: short, height: Math.max(1, Math.round(height * scale)) }
        : { width: Math.max(1, Math.round(width * scale)), height: short };
}

/** 画像の向きを直したあとの寸法（EXIF の向き 5〜8 は縦横が入れ替わる） */
async function orientedSize(input) {
    const m = await sharp(input).metadata();
    return (m.orientation ?? 1) >= 5 ? { width: m.height, height: m.width } : { width: m.width, height: m.height };
}

/** 1枚のサムネを作る（Buffer かファイルのパス → JPEG の Buffer と寸法） */
export async function makeSpotThumb(input) {
    const src = await orientedSize(input);
    const size = thumbSizeFor(src.width, src.height);
    const { data, info } = await sharp(input)
        .rotate()
        // 寸法は自分で決めた値を渡す（sharp の丸めに任せない＝テストと見張りが同じ式で数えられる）
        .resize({ width: size.width, height: size.height, fit: "fill" })
        .jpeg({ quality: THUMB_QUALITY, progressive: true, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
}

function listJpg(dir) {
    try {
        return fs.readdirSync(dir).filter((n) => n.endsWith(".jpg") && fs.statSync(path.join(dir, n)).isFile()).sort();
    } catch {
        return [];
    }
}

/**
 * 置き場を揃える。返り値: 作った・作れなかった・（`check` のとき）無い/形違い・元の無いサムネ。
 * 形違い＝サムネの寸法が今の元から計算した寸法と違う（元を差し替えた）
 */
export async function syncSpotThumbs({ srcDir = SRC_DIR, thumbDir = path.join(srcDir, THUMB_DIR_NAME), force = false, check = false } = {}) {
    const result = { total: 0, created: [], failed: [], missing: [], stale: [], orphans: [] };
    const sources = listJpg(srcDir);
    result.total = sources.length;
    const sourceSet = new Set(sources);
    result.orphans = listJpg(thumbDir).filter((n) => !sourceSet.has(n));
    if (!check) fs.mkdirSync(thumbDir, { recursive: true });
    for (const name of sources) {
        const srcPath = path.join(srcDir, name);
        const thumbPath = path.join(thumbDir, name);
        try {
            let reason = force ? "force" : null;
            if (!reason) {
                if (!fs.existsSync(thumbPath)) reason = "missing";
                else {
                    const src = await orientedSize(srcPath);
                    const want = thumbSizeFor(src.width, src.height);
                    const have = await orientedSize(thumbPath);
                    if (want.width !== have.width || want.height !== have.height) reason = "stale";
                }
            }
            if (!reason) continue;
            if (check) {
                if (reason === "missing") result.missing.push(name);
                if (reason === "stale") result.stale.push(name);
                continue;
            }
            const out = await makeSpotThumb(srcPath);
            // 途中で落ちても半端なファイルを残さない（在る＝使える、を守る。フィードは在るかだけを見る）
            const tmp = `${thumbPath}.tmp-${process.pid}`;
            fs.writeFileSync(tmp, out.data);
            fs.renameSync(tmp, thumbPath);
            result.created.push(name);
        } catch (e) {
            result.failed.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    return result;
}

async function main() {
    const force = process.argv.includes("--force");
    const check = process.argv.includes("--check");
    const r = await syncSpotThumbs({ force, check });
    if (check) {
        const bad = r.missing.length + r.stale.length + r.orphans.length;
        console.log(`[spot-thumbs] 元 ${r.total} 枚・無い ${r.missing.length}・形違い ${r.stale.length}・元の無いサムネ ${r.orphans.length}`);
        for (const n of r.missing) console.log(`  無い: ${n}`);
        for (const n of r.stale) console.log(`  形違い: ${n}`);
        for (const n of r.orphans) console.log(`  元が無い: thumb/${n}`);
        if (bad > 0) console.log("  → node scripts/spot-thumbs.mjs で作る（元の無いサムネは消す）");
        process.exit(bad > 0 || r.failed.length > 0 ? 1 : 0);
    }
    console.log(`[spot-thumbs] 元 ${r.total} 枚・作った ${r.created.length}・作れなかった ${r.failed.length}`);
    for (const f of r.failed) console.log(`  作れなかった: ${f}`);
    if (r.orphans.length) console.log(`  元の無いサムネ ${r.orphans.length} 枚（消してよい）: ${r.orphans.join(", ")}`);
    process.exit(r.failed.length > 0 ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
