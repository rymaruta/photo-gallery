/**
 * app/data/dev-photos.json の画像 URL を開発用 → 本番用に変換して標準出力に出す。
 * 使い方:
 *   node scripts/convert-photos-to-prod-urls.js > app/data/prod-photos.json
 *   PROD_PHOTO_BASE_URL=https://d1s3dwwzgxf5ni.cloudfront.net node scripts/convert-photos-to-prod-urls.js > app/data/prod-photos.json
 *
 * デフォルトの本番ベース URL: https://journey-photo.com
 * 置き換え: dev-journey-photo-upload.s3.ap-northeast-1.amazonaws.com の URL を
 *           PROD_PHOTO_BASE_URL + パス（/uploads/...） に変換する。
 */
const fs = require("fs");
const path = require("path");

const DEV_S3_PATTERN = /^https:\/\/dev-journey-photo-upload\.s3\.ap-northeast-1\.amazonaws\.com(\/.*)$/;
const PROD_BASE = process.env.PROD_PHOTO_BASE_URL || "https://journey-photo.com";

const photosPath = path.join(process.cwd(), "app", "data", "dev-photos.json");
const raw = fs.readFileSync(photosPath, "utf-8");
const photos = JSON.parse(raw);

function convertSrc(src) {
  if (!src || typeof src !== "string") return src;
  const m = src.match(DEV_S3_PATTERN);
  if (m) return PROD_BASE.replace(/\/$/, "") + m[1];
  return src;
}

const converted = photos.map((p) => ({
  ...p,
  src: convertSrc(p.src),
}));

process.stdout.write(JSON.stringify(converted, null, 2));
