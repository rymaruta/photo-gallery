/**
 * 静的エクスポート（output: "export"）ビルドの前に app/api を一時退避する。
 * Next.js は output: "export" 時に app/api 内の Route Handlers を
 * サポートしておらず、ビルド時にエラーになるため、ビルド中のみ app/api を除外する。
 *
 * - ビルド前: app/api → _api_build_backup に退避
 * - next build --webpack 実行
 * - ビルド後（成否問わず）: _api_build_backup → app/api に復元
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = process.cwd();
const appApi = path.join(root, "app", "api");
const backup = path.join(root, "_api_build_backup");

// 前回のビルドが異常終了して _api_build_backup が残っている場合は復元
if (fs.existsSync(backup)) {
  if (fs.existsSync(appApi)) {
    fs.rmSync(appApi, { recursive: true });
  }
  fs.renameSync(backup, appApi);
  console.log("[prepare-static-build] Restored app/api from previous _api_build_backup");
}

const hadApi = fs.existsSync(appApi);

try {
  if (hadApi) {
    fs.renameSync(appApi, backup);
    console.log("[prepare-static-build] Moved app/api to _api_build_backup for static export build");
  }

  execSync("next build --webpack", { stdio: "inherit" });
} finally {
  if (fs.existsSync(backup)) {
    if (fs.existsSync(appApi)) {
      fs.rmSync(appApi, { recursive: true });
    }
    fs.renameSync(backup, appApi);
    console.log("[prepare-static-build] Restored app/api");
  }
}
