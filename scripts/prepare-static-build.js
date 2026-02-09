/**
 * 静的エクスポート（output: "export"）用のビルドを実行する。
 *
 * app/api は廃止済み。API は開発時は serverless-offline（api/）にプロキシ、本番は API Gateway + Lambda。
 * そのため退避処理は不要で、next build のみ実行する。
 *
 * 本番用写真一覧（prod-photos.json）は dev-photos.json から生成する運用のため、
 * ビルド前に convert:photos:prod を実行し、photos-initial が import する prod-photos.json を用意する。
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = process.cwd();

// 本番用写真 JSON を 1 本化のため、ビルド前に dev-photos.json から生成（無い場合は空の prod-photos.json を生成）
try {
  execSync("node scripts/write-prod-photos.js", { cwd: root, stdio: "inherit" });
} catch {
  const prodPath = path.join(root, "app", "data", "prod-photos.json");
  if (!fs.existsSync(prodPath)) {
    console.warn("[prepare-static-build] dev-photos.json がありません。空の prod-photos.json を生成します。");
    fs.mkdirSync(path.dirname(prodPath), { recursive: true });
    fs.writeFileSync(prodPath, "[]", "utf8");
  }
}

execSync("next build --webpack", { cwd: root, stdio: "inherit" });
