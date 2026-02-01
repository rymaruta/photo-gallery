/**
 * 開発用 dev-photos.json から本番用 prod-photos.json を生成する。
 * 画像 URL を dev-journey-photo-upload.s3... → 本番ベース URL に変換する。
 *
 * 使い方: npm run convert:photos:prod
 * オプション: PROD_PHOTO_BASE_URL=https://journey-photo.com（未指定時はこれ）
 */
const fs = require("fs");
const path = require("path");
const prodBase = process.env.PROD_PHOTO_BASE_URL || "https://journey-photo.com";
const raw = fs.readFileSync(
  path.join(process.cwd(), "app", "data", "dev-photos.json"),
  "utf8"
);
const out = raw.replace(
  /https:\/\/dev-journey-photo-upload\.s3\.ap-northeast-1\.amazonaws\.com/g,
  prodBase
);
fs.writeFileSync(
  path.join(process.cwd(), "app", "data", "prod-photos.json"),
  out,
  "utf8"
);
console.log("Written app/data/prod-photos.json");
