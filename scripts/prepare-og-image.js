/**
 * OGP 用画像を用意する。
 * public/images/og-image.jpg が無い場合、sample1.jpg をコピーして暫定で使用する。
 * 本番では 1200×630 px の専用画像に差し替えることを推奨。
 *
 * 使い方: npm run prepare:og-image
 */
const fs = require("fs");
const path = require("path");

const publicImages = path.join(process.cwd(), "public", "images");
const ogPath = path.join(publicImages, "og-image.jpg");
const fallbackPath = path.join(publicImages, "sample1.jpg");

if (fs.existsSync(ogPath)) {
  console.log("[prepare-og-image] public/images/og-image.jpg は既に存在します。");
  process.exit(0);
}

if (!fs.existsSync(fallbackPath)) {
  console.warn(
    "[prepare-og-image] public/images/sample1.jpg がありません。\n" +
      "  1200×630 px の画像を public/images/og-image.jpg として配置してください。"
  );
  process.exit(1);
}

fs.copyFileSync(fallbackPath, ogPath);
console.log("[prepare-og-image] public/images/og-image.jpg を作成しました（sample1.jpg のコピー）。");
console.log("  本番では 1200×630 px の専用 OGP 画像に差し替えることを推奨します。");
