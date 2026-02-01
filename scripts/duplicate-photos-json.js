/**
 * app/data/photos.json を dev-photos.json と prod-photos.json にコピーする。
 * 使い方: node scripts/duplicate-photos-json.js
 *        npm run duplicate:photos
 */
const fs = require("fs");
const path = require("path");
const root = process.cwd();
const src = path.join(root, "app", "data", "photos.json");
const dataDir = path.join(root, "app", "data");
const devPath = path.join(dataDir, "dev-photos.json");
const prodPath = path.join(dataDir, "prod-photos.json");

if (!fs.existsSync(src)) {
  console.error("app/data/photos.json が見つかりません。");
  process.exit(1);
}
const content = fs.readFileSync(src, "utf-8");
fs.writeFileSync(devPath, content, "utf-8");
fs.writeFileSync(prodPath, content, "utf-8");
console.log("Created app/data/dev-photos.json and app/data/prod-photos.json");
