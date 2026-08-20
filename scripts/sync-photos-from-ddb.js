/**
 * sync-photos-from-ddb.js
 *
 * DynamoDB の写真テーブル（PHOTOS_TABLE）から全写真を取得して
 * app/data/photos.json に書き出す。
 * 静的エクスポートビルド前に実行することで、/photo/[id] の SSG に使う。
 *
 * 使い方:
 *   AWS_PROFILE=xxx node scripts/sync-photos-from-ddb.js
 *   または GitHub Actions で AWS 環境変数を設定した状態で実行
 *
 * 環境変数:
 *   AWS_REGION          (default: ap-northeast-1)
 *   PHOTOS_TABLE        (必須)
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
const { requireEnv } = require("./lib/env");

// .env.local から AWS 認証情報を読み込む
const envLocalPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envLocalPath)) {
    for (const line of fs.readFileSync(envLocalPath, "utf8").split("\n")) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
    }
}

const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
const TABLE = requireEnv("PHOTOS_TABLE");
const OUTPUT = path.resolve(__dirname, "../app/data/photos.json");
const DRY_RUN = process.env.DRY_RUN === "1";
const FORCE = process.argv.includes("--force");
const IS_CI = !!process.env.CI;
// 「この環境にはまだ写真が無い」を許す。新しく作った環境の最初のビルド用。
// 本番では絶対に立てない（0件を通すと全ページが消える）。
const ALLOW_EMPTY = process.env.ALLOW_EMPTY_PHOTOS === "1";

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
function checkWriteSafety(nextCount, prevCount, { allowEmpty = ALLOW_EMPTY } = {}) {
    if (FORCE) return { ok: true, reason: "--force" };
    // 作りたての環境はテーブルが空。リポジトリにコミットされている photos.json は
    // 本番の写真なので、ここで拒否すると staging が本番の写真を並べてしまう。
    // 「空でよい」と明示された環境だけ、0件と大幅減を許す。
    if (allowEmpty) return { ok: true, reason: "ALLOW_EMPTY_PHOTOS=1" };
    if (nextCount === 0) return { ok: false, reason: "取得できた写真が0件です" };
    if (prevCount === null || prevCount === 0) return { ok: true, reason: "比較対象なし" };
    if (nextCount < prevCount * SHRINK_LIMIT) {
        return { ok: false, reason: `${prevCount}件 → ${nextCount}件 と大きく減っています` };
    }
    return { ok: true, reason: "" };
}

/**
 * 公開してはいけない項目。
 *
 * photos.json はビルドの入力であり、そのまま
 *   - クライアントのJSバンドル（lib/routes.ts が丸ごと import している）
 *   - 各ページの静的HTML
 * に展開される。つまりここに残った値は全員に配られる。
 *
 * - srcOriginal … EXIF を落とす**前**の原本のURL。GPS が入ったまま。
 *   撮影日のバックフィル（scripts/generate-thumbnails.js）は DynamoDB を
 *   直接読むので、photos.json から落としても支障は無い。
 * - key … S3 のオブジェクトキー。バケット構造を公開する理由が無い。
 */
const PRIVATE_FIELDS = ["srcOriginal", "key"];

function stripPrivateFields(item) {
    const out = { ...item };
    for (const f of PRIVATE_FIELDS) delete out[f];
    return out;
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
        .filter(item => item.src && item.published !== false && item.story !== true)
        .map(stripPrivateFields)
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
