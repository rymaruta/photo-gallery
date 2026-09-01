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
// 中断されても退避したままにしない。
/**
 * ビルド本体。
 *
 * **require しただけでは動かないこと。** ここは app/api を退避し、out/ を
 * 消し、next build を回す——**副作用の塊**なのに、他の scripts/*.js が
 * 全部持っている `require.main === module` のガードが、このファイルにだけ
 * 無かった（deploy-static-site.js は C-9 で同じ理由の副作用を潰している）。
 * テストやツールが読み込んだだけで本物のビルドが走り、app/api が移動し、
 * out/ が消える。実際に踏んだので囲った。
 */
function main() {
    // 前回の中断の後始末。**main() の中に置くこと。**
    // ここがトップレベルにあった間は、`require` しただけで
    // `_api_build_backup` を `app/api` へ動かす（本体があれば消す）——
    // 「require しただけでは動かない」が半分しか成立していなかった。
    if (fs.existsSync(backupDir)) {
        if (!fs.existsSync(apiDir)) {
            console.log("[build] 前回のビルドが中断していました。app/api を復元します...");
            restore();
        } else {
            fs.rmSync(backupDir, { recursive: true, force: true });
        }
    }

    // finally は SIGINT/SIGTERM では走らないので、明示的に拾う。
    //
    // **ただし execSync の最中はこのハンドラも走らない**（イベントループが
    // 塞がるため。実測: next build 中に wrapper だけへ TERM を送っても
    // ログが出ず、ビルドは最後まで走った）。実際に効いているのは:
    //   - 端末の Ctrl-C … プロセスグループ全体に届いて子も死ぬので、
    //     execSync が throw して **finally** が復元する
    //   - wrapper だけを殺す／SIGKILL … ハンドラは無力。退避したままになるが、
    //     次回起動時の後始末（main() の冒頭）が拾う
    // つまりこのハンドラが本当に効くのは「execSync の外で受けたとき」だけ。
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

    // **前回の out/ を先に捨てる。**
    // next build が途中で失敗しても out/ はそのまま残るので、失敗に気づかず
    // `npm run web:deploy:prod` を打つと**前回の成果物がそのまま本番へ**行く
    // （デプロイはビルドしないので、古い out/ を本物として扱う）。
    // 消しておけば、失敗したビルドのあとのデプロイは「out/ が無い」で必ず止まる。
    const outDir = path.join(root, "out");
    if (fs.existsSync(outDir)) {
        console.log("[build] 前回の out/ を削除...");
        fs.rmSync(outDir, { recursive: true, force: true });
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
}

if (require.main === module) main();
