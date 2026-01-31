/**
 * デプロイ前にローカル prod-photos.json を日付付きでバックアップする。
 * 使い方: npm run backup:prod-photos
 * 保存先: app/data/backups/prod-photos-YYYYMMDD-HHmmss.json（直近 10 件を残す）
 */
const fs = require("fs");
const path = require("path");

const prodPath = path.join(process.cwd(), "app", "data", "prod-photos.json");
const backupDir = path.join(process.cwd(), "app", "data", "backups");
const KEEP_LAST = 10;

if (!fs.existsSync(prodPath)) {
  console.log("[backup-prod-photos] app/data/prod-photos.json がありません。スキップします。");
  process.exit(0);
}

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

const now = new Date();
const dateStr =
  now.getFullYear() +
  String(now.getMonth() + 1).padStart(2, "0") +
  String(now.getDate()).padStart(2, "0") +
  "-" +
  String(now.getHours()).padStart(2, "0") +
  String(now.getMinutes()).padStart(2, "0") +
  String(now.getSeconds()).padStart(2, "0");
const backupPath = path.join(backupDir, `prod-photos-${dateStr}.json`);

fs.copyFileSync(prodPath, backupPath);
console.log(`[backup-prod-photos] バックアップしました: ${path.relative(process.cwd(), backupPath)}`);

const files = fs.readdirSync(backupDir).filter((f) => f.startsWith("prod-photos-") && f.endsWith(".json"));
if (files.length > KEEP_LAST) {
  const sorted = files.sort();
  const toRemove = sorted.slice(0, files.length - KEEP_LAST);
  for (const f of toRemove) {
    fs.unlinkSync(path.join(backupDir, f));
    console.log(`[backup-prod-photos] 古いバックアップを削除: ${f}`);
  }
}
