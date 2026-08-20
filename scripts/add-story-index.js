/**
 * add-story-index.js — 既存テーブルにストーリー一覧用の GSI を足す（移行スクリプト）
 *
 * 何が問題だったか:
 *   「今生きているストーリー」を全ユーザー分引くのに、テーブル全体を Scan していた。
 *   このテーブルには写真・コメント文書・いいね/フォローのマーカーが同居しており、
 *   マーカーは退会しても消えないので増える一方。ログインするたびに全件読むので、
 *   いずれ Lambda の実行時間に収まらなくなり、**ログイン中の全員のストーリー欄が
 *   同時に壊れる**。しかも重くなるだけで警告は出ない。
 *
 * ここでやること:
 *   1. GSI `storyFeed-expiresAt-index` を足す（既にあれば何もしない）
 *   2. 既存の生きているストーリーに storyFeed 属性を書く
 *      （新規投稿は api-user 側が最初から書く。ストーリーは24時間で
 *        入れ替わるので、本来はこの backfill 無しでも1日で揃う。
 *        今出ているストーリーを消さないためにやる）
 *
 * 使い方:
 *   node scripts/add-story-index.js            # ドライラン（既定）
 *   node scripts/add-story-index.js --apply    # 実行
 *
 * 環境変数:
 *   AWS_REGION    (default: ap-northeast-1)
 *   PHOTOS_TABLE  (必須)
 *
 * 冪等: 何度実行しても安全。
 */

const fs = require("fs");
const path = require("path");
const { requireEnv } = require("./lib/env");

const envLocalPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envLocalPath)) {
    for (const line of fs.readFileSync(envLocalPath, "utf8").split("\n")) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
    }
}

const INDEX_NAME = "storyFeed-expiresAt-index";
const STORY_FEED_KEY = "1";

/** DescribeTable の結果から、この GSI が既にあるか（＋使える状態か）を見る */
function indexState(description) {
    const gsi = (description?.Table?.GlobalSecondaryIndexes ?? [])
        .find((i) => i.IndexName === INDEX_NAME);
    if (!gsi) return "missing";
    return gsi.IndexStatus === "ACTIVE" ? "active" : "creating";
}

/** UpdateTable に渡す索引追加の指定 */
function createIndexInput(tableName) {
    return {
        TableName: tableName,
        AttributeDefinitions: [
            { AttributeName: "storyFeed", AttributeType: "S" },
            { AttributeName: "expiresAt", AttributeType: "S" },
        ],
        GlobalSecondaryIndexUpdates: [{
            Create: {
                IndexName: INDEX_NAME,
                KeySchema: [
                    { AttributeName: "storyFeed", KeyType: "HASH" },
                    { AttributeName: "expiresAt", KeyType: "RANGE" },
                ],
                Projection: { ProjectionType: "ALL" },
            },
        }],
    };
}

async function main() {
    const apply = process.argv.includes("--apply");
    const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
    const TABLE = requireEnv("PHOTOS_TABLE");

    const { DynamoDBClient, DescribeTableCommand, UpdateTableCommand } = require("@aws-sdk/client-dynamodb");
    const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

    const raw = new DynamoDBClient({ region: REGION });
    const ddb = DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } });

    console.log(`[story-index] テーブル: ${TABLE}`);
    console.log(`[story-index] モード: ${apply ? "実行" : "ドライラン（--apply で実行）"}\n`);

    const described = await raw.send(new DescribeTableCommand({ TableName: TABLE }));
    const state = indexState(described);
    console.log(`[story-index] ${INDEX_NAME}: ${state}`);

    if (state === "missing") {
        if (!apply) {
            console.log("[story-index] 索引を作成します（ドライランのため実行しません）。");
        } else {
            await raw.send(new UpdateTableCommand(createIndexInput(TABLE)));
            console.log("[story-index] 索引の作成を開始しました（バックフィルは AWS 側で進みます）。");
        }
    }

    // 生きているストーリーに storyFeed を書く。
    // 索引の作成中でも書いてよい（作成完了時に反映される）。
    const now = new Date().toISOString();
    let scanned = 0;
    let target = 0;
    let lastKey;
    do {
        const res = await ddb.send(new ScanCommand({
            TableName: TABLE,
            FilterExpression: "story = :t AND expiresAt > :now AND attribute_not_exists(storyFeed)",
            ExpressionAttributeValues: { ":t": true, ":now": now },
            ExclusiveStartKey: lastKey,
        }));
        scanned += res.ScannedCount ?? 0;
        for (const item of res.Items ?? []) {
            target++;
            if (!apply) continue;
            await ddb.send(new UpdateCommand({
                TableName: TABLE,
                Key: { id: item.id },
                UpdateExpression: "SET storyFeed = :k",
                // 途中で消えたストーリーを蘇らせない
                ConditionExpression: "attribute_exists(id)",
                ExpressionAttributeValues: { ":k": STORY_FEED_KEY },
            })).catch((e) => console.warn(`[story-index] ${item.id} の更新に失敗:`, e.name));
        }
        lastKey = res.LastEvaluatedKey;
    } while (lastKey);

    console.log(`[story-index] 走査 ${scanned} 件 / storyFeed が必要なストーリー ${target} 件`);
    if (!apply) console.log("\n[story-index] ドライランのため何も変更していません。");
    else console.log("\n[story-index] 完了。索引が ACTIVE になるまでは Scan にフォールバックします。");
}

module.exports = { indexState, createIndexInput, INDEX_NAME, STORY_FEED_KEY };

if (require.main === module) {
    main().catch((e) => {
        console.error("[story-index] 失敗:", e);
        process.exit(1);
    });
}
