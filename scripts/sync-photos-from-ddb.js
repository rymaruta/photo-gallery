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
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const fs = require("fs");
const path = require("path");

const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
const TABLE = process.env.PHOTOS_TABLE ?? "prod-photo-gallery-photos";
const OUTPUT = path.resolve(__dirname, "../app/data/photos.json");
const DRY_RUN = process.env.DRY_RUN === "1";

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

    // 公開済みのみ絞り込んで createdAt 降順でソート
    return items
        .filter(item => item.published !== false)
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
        process.exit(0); // ビルドを止めない
    }

    console.log(`\n[sync] ${photos.length} 件取得（公開済みのみ）`);

    if (DRY_RUN) {
        console.log("[sync] DRY_RUN=1 のためファイル書き込みをスキップ");
        return;
    }

    fs.writeFileSync(OUTPUT, JSON.stringify(photos, null, 2) + "\n", "utf-8");
    console.log(`[sync] ${OUTPUT} に書き込みました`);
}

main().catch((err) => {
    console.error("[sync] unexpected error:", err);
    process.exit(0); // ビルドを止めない
});
