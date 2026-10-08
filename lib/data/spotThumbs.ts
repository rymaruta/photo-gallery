// lib/data/spotThumbs.ts（サーバー専用・ビルド時に `public/` を見る）
//
// **撮影スポットの写真の小さい版（サムネ）の場所。**（2026-10-08）
//
// 作るのは `scripts/spot-thumbs.mjs`（短い辺 240px・品質 70・プログレッシブの JPEG）。
// 置き場は元の写真の隣の `thumb/`:
//
//     /images/spots/<slug>.jpg        → /images/spots/thumb/<slug>.jpg
//
// アプリ向けの JSON（`spotFeed.ts` の `image.thumbUrl`）は**ファイルが在るときだけ**出す。
// 在るかはビルドの時点の `public/` で見る（`next build` は `public/` をそのまま `out/` へ写す）。
// 本番のビルドは `next build` の前にサムネを作る（`scripts/prepare-static-build.js`）。

import fs from "node:fs";
import path from "node:path";

/** `scripts/spot-thumbs.mjs` の `THUMB_DIR_NAME` と同じ */
export const SPOT_THUMB_DIR = "thumb";

/**
 * サイトに置いた写真の場所（`local.src`）から、サムネの場所。
 * `/images/spots/<名前>.jpg` の形でなければ undefined（サムネを作っていない）
 */
export function spotThumbSrc(localSrc: string): string | undefined {
    const m = /^\/images\/spots\/([^/]+\.jpg)$/.exec(localSrc);
    return m ? `/images/spots/${SPOT_THUMB_DIR}/${m[1]}` : undefined;
}

/** サムネのファイルが `public/` に在るか */
export function spotThumbExists(src: string, publicDir: string = path.join(process.cwd(), "public")): boolean {
    return fs.existsSync(path.join(publicDir, src));
}
