/**
 * sync-photos-from-ddb.js
 *
 * DynamoDB の prod-photo-gallery-photos テーブルから全写真を取得して
 * app/data/photos.json に書き出す。
 * 静的エクスポートビルド前に実行することで、/photo/[id] の SSG に使う。
 *
 * 使い方:
 *   AWS_PROFILE=xxx node scripts/sync-photos-from-ddb.js
 *   または GitHub Actions で AWS 環境変数を設定した状態で実行
 *
 * 環境変数:
 *   AWS_REGION          (default: ap-northeast-1)
 *   PHOTOS_TABLE        (default: prod-photo-gallery-photos)
 *   DRY_RUN=1           ファイルを書かずに件数だけ確認
 *   CI                  取得に失敗したらビルドを止める（Actions では自動で入る）
 *
 * 安全装置（どちらもデプロイ事故を防ぐためのもの）:
 *   1. 取得に失敗したとき、CI では異常終了する。
 *      以前は常に exit 0 で、失敗しても古い photos.json のままビルドが緑で通り、
 *      デプロイが「新しい写真のページ」を S3 から消していた（HTML は猶予なしで削除）。
 *      ローカルは今まで通り警告のみ（認証情報なしでもビルドを回せるように）。
 *   2. 件数が0、または既存ファイルの半分未満に減る書き込みは拒否する。
 *      空のテーブルを指したスキャンで photos.json が空になり、次のビルドで
 *      全ページが消えるのを防ぐ。意図した大量削除のときは --force を付ける。
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const fs = require("fs");
const path = require("path");

// .env.local から AWS 認証情報を読み込む
const envLocalPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envLocalPath)) {
    for (const line of fs.readFileSync(envLocalPath, "utf8").split("\n")) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
    }
}

const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
const TABLE = process.env.PHOTOS_TABLE ?? "prod-photo-gallery-photos";
const OUTPUT = path.resolve(__dirname, "../app/data/photos.json");
const DRY_RUN = process.env.DRY_RUN === "1";
const FORCE = process.argv.includes("--force");
const IS_CI = !!process.env.CI;

// 既存ファイルからここまで減る書き込みは事故とみなす（0.5 = 半減）
const SHRINK_LIMIT = 0.5;

/** 既存の photos.json の件数。無い・壊れているときは null（＝比較しない） */
function existingCount(file) {
    try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        return Array.isArray(parsed) ? parsed.length : null;
    } catch {
        return null;
    }
}

/**
 * この書き込みを許してよいか。
 * 「取得できた件数が急に減った」は、テーブルを間違えた・権限が欠けた・
 * スキャンが途中で切れた、のどれかである可能性が高い。上書きすると
 * 次のビルドでページが消え、デプロイがそれを S3 からも削除してしまう。
 */
function checkWriteSafety(nextCount, prevCount) {
    if (FORCE) return { ok: true, reason: "--force" };
    if (nextCount === 0) return { ok: false, reason: "取得できた写真が0件です" };
    if (prevCount === null || prevCount === 0) return { ok: true, reason: "比較対象なし" };
    if (nextCount < prevCount * SHRINK_LIMIT) {
        return { ok: false, reason: `${prevCount}件 → ${nextCount}件 と大きく減っています` };
    }
    return { ok: true, reason: "" };
}

async function scan() {
    const client = new DynamoDBClient({ region: REGION });
    const ddb = DynamoDBDocumentClient.from(client, {
        marshallOptions: { removeUndefinedValues: true },
    });

    const items = [];
    let lastKey;
    let page = 0;
    do {
        page++;
        process.stdout.write(`  Scanning page ${page}...\r`);
        const res = await ddb.send(new ScanCommand({
            TableName: TABLE,
            ExclusiveStartKey: lastKey,
        }));
        items.push(...(res.Items ?? []));
        lastKey = res.LastEvaluatedKey;
    } while (lastKey);

    // 公開済みの「写真」のみ絞り込んで createdAt 降順でソート。
    // テーブルには like#/go# マーカーや golist#/notifs# 文書が同居しているため、
    // src を持つ item（=写真）だけを photos.json に出す（プライバシー保護）。
    return items
        .filter(item => item.src && item.published !== false)
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

async function main() {
    console.log(`\n[sync] DynamoDB → ${path.relative(process.cwd(), OUTPUT)}`);
    console.log(`  table : ${TABLE}`);
    console.log(`  region: ${REGION}`);

    let photos;
    try {
        photos = await scan();
    } catch (err) {
        console.error("\n[sync] DynamoDB scan failed:", err.message ?? err);
        console.warn("[sync] photos.json は更新しません（既存ファイルを維持）");
        // CI で古いスナップショットのままビルドを通すと、デプロイが
        // 「その後に増えた写真のページ」を S3 から消してしまう。止める。
        process.exit(IS_CI ? 1 : 0);
    }

    console.log(`\n[sync] ${photos.length} 件取得（公開済みのみ）`);

    if (DRY_RUN) {
        console.log("[sync] DRY_RUN=1 のためファイル書き込みをスキップ");
        return;
    }

    const prev = existingCount(OUTPUT);
    const safety = checkWriteSafety(photos.length, prev);
    if (!safety.ok) {
        console.error(`\n[sync] 書き込みを中止しました: ${safety.reason}`);
        console.error("[sync] テーブル名・リージョン・認証情報を確認してください。");
        console.error("[sync] 意図した削除であれば --force を付けて再実行します。");
        process.exit(1);
    }

    fs.writeFileSync(OUTPUT, JSON.stringify(photos, null, 2) + "\n", "utf-8");
    console.log(`[sync] ${OUTPUT} に書き込みました`);
}

if (require.main === module) {
    main().catch((err) => {
        console.error("[sync] unexpected error:", err);
        process.exit(IS_CI ? 1 : 0);
    });
}

module.exports = { checkWriteSafety, existingCount };
