/**
 * prepare-static-build.js
 *
 * 静的エクスポート（output: "export"）ビルド用のスクリプト。
 * app/api/ は開発環境専用のため、本番ビルド時に一時退避してから next build を実行し、
 * 完了後に元の場所に戻す。
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const apiDir = path.join(root, "app", "api");
const backupDir = path.join(root, "_api_build_backup");

function move(src, dest) {
    if (fs.existsSync(src)) {
        try {
            fs.renameSync(src, dest);
        } catch (err) {
            if (err.code === "EXDEV") {
                fs.cpSync(src, dest, { recursive: true });
                fs.rmSync(src, { recursive: true, force: true });
            } else {
                throw err;
            }
        }
        console.log(`  Moved: ${path.relative(root, src)} → ${path.relative(root, dest)}`);
    }
}

function restore() {
    move(backupDir, apiDir);
}

// 万が一前回の退避が残っていたらクリーンアップ
if (fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
}

// DynamoDB から写真データを同期（失敗してもビルドは継続）
const syncScript = path.join(__dirname, "sync-photos-from-ddb.js");
if (fs.existsSync(syncScript)) {
    console.log("\n[build] DynamoDB から写真データを同期...");
    try {
        execSync(`node ${syncScript}`, { stdio: "inherit", cwd: root });
    } catch {
        console.warn("[build] DynamoDB 同期に失敗しました（既存の photos.json を使用）");
    }
}

console.log("\n[build] app/api を一時退避...");
move(apiDir, backupDir);

let exitCode = 0;
try {
    console.log("[build] next build を実行...\n");
    execSync("npx next build", { stdio: "inherit", cwd: root });
} catch (err) {
    exitCode = err.status ?? 1;
} finally {
    console.log("\n[build] app/api を復元...");
    restore();
}

process.exit(exitCode);
