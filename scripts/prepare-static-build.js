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

// 前回の退避が残っていたときの後始末。
//
// 以前は無条件に消していた。ところが**中断されたビルドの後は、その退避先が
// app/api そのもの**（退避してから復元する前に Ctrl-C / SIGTERM / OOM で
// 落ちた状態）。_api_build_backup は gitignore されているので、次に
// npm run build を叩いた瞬間に app/api がディスクから消える。
// 未コミットのルート実装はそこで失われる。
// 本体が無いなら「残骸」ではなく「退避中」なので、戻す。
if (fs.existsSync(backupDir)) {
    if (!fs.existsSync(apiDir)) {
        console.log("[build] 前回のビルドが中断していました。app/api を復元します...");
        restore();
    } else {
        fs.rmSync(backupDir, { recursive: true, force: true });
    }
}

// 中断されても退避したままにしない。
// finally は SIGINT/SIGTERM では走らないので、明示的に拾う。
let restored = false;
const restoreOnce = () => {
    if (restored) return;
    restored = true;
    try {
        if (fs.existsSync(backupDir) && !fs.existsSync(apiDir)) restore();
    } catch (e) {
        console.error("[build] app/api の復元に失敗しました:", e);
    }
};
for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
        console.log(`\n[build] ${sig} を受け取りました。app/api を復元します...`);
        restoreOnce();
        process.exit(1);
    });
}

// DynamoDB から写真データを同期。
// ローカル（認証情報なし）では失敗してもビルドを続けるが、CI では止める。
// 古い photos.json のままビルドが通ると、デプロイが「その後に増えた写真の
// ページ」を S3 から削除してしまうため（HTML は猶予期間なしで消える）。
// 止めるかどうかの判断は sync 側の終了コードに委ねている。
const syncScript = path.join(__dirname, "sync-photos-from-ddb.js");
if (fs.existsSync(syncScript)) {
    console.log("\n[build] DynamoDB から写真データを同期...");
    try {
        execSync(`node ${syncScript}`, { stdio: "inherit", cwd: root });
    } catch {
        console.error("[build] DynamoDB 同期に失敗しました。ビルドを中止します。");
        process.exit(1);
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
    try {
        restore();
    } catch (restoreErr) {
        console.error("[build] app/api の復元に失敗しました:", restoreErr);
    }
}

process.exit(exitCode);
