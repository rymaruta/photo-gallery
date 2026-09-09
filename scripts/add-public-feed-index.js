/**
 * add-public-feed-index.js — 既存テーブルに公開一覧用の GSI を足す（移行スクリプト）
 *
 * **`add-story-index.js` と同じ形**（あちらがストーリーで先に解いた問題の、
 * 写真版）。索引の作成と埋め戻しを1本でやる。
 *
 * 何が問題か:
 *   `GET /photos` は**呼ばれるたびにテーブル全体を Scan**している。
 *   `FilterExpression` は読んだ**あと**に効くので、同居しているいいね・
 *   フォローのマーカー、コメント文書、通知まで全部の読み取り費用を払う。
 *   マーカーは退会しても消えないので増える一方で、しかも重くなるだけで
 *   警告は出ない。
 *
 * ここでやること:
 *   1. GSI `publicFeed-createdAt-index` を足す（既にあれば何もしない）
 *   2. 既存の公開写真に `publicFeed` 属性を書く
 *      （新規投稿・公開切替は api / api-user 側が最初から書く。
 *        写真は入れ替わらないので、**この埋め戻しをしないと既存の写真が
 *        索引に載らない**——ストーリーと違って1日待っても揃わない）
 *   3. **`createdAt` を持たない公開写真の件数を必ず報告する**
 *
 * **3 が本題。** GSI はキーが揃った項目しか載せないので、`createdAt` の無い
 * 公開写真があると、読む側を Query に切り替えた瞬間に**その写真が一覧から
 * 消える**（Scan では末尾に並んでいた）。0 件を確かめてから切り替えること。
 *
 * 使い方:
 *   node scripts/add-public-feed-index.js            # ドライラン（既定）
 *   node scripts/add-public-feed-index.js --apply    # 実行
 *
 * 環境変数:
 *   AWS_REGION    (default: ap-northeast-1)
 *   PHOTOS_TABLE  (必須)
 *
 * 冪等: 何度実行しても安全。索引の作成は完了を待たない
 *       （ACTIVE になるまでもう一度流すと状態が出る）。
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

const INDEX_NAME = "publicFeed-createdAt-index";
/**
 * 印の値。**api/src/publicFeed.ts・api-user/src/publicFeed.ts と同じでなければ
 * ならない**（ずれると、埋め戻した行が索引の別の場所に入って一覧に出ない）。
 * `scripts/__tests__/publicFeedParity.test.ts` が突き合わせる。
 */
const PUBLIC_FEED_KEY = "1";

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
            { AttributeName: "publicFeed", AttributeType: "S" },
            { AttributeName: "createdAt", AttributeType: "S" },
        ],
        GlobalSecondaryIndexUpdates: [{
            Create: {
                IndexName: INDEX_NAME,
                KeySchema: [
                    { AttributeName: "publicFeed", KeyType: "HASH" },
                    { AttributeName: "createdAt", KeyType: "RANGE" },
                ],
                // 射影は ALL。一覧はほぼ全項目を返すので KEYS_ONLY にすると
                // 行ごとに本体を引き直すことになり、Scan をやめた意味が薄れる
                // （既存の2本も ALL）。
                Projection: { ProjectionType: "ALL" },
            },
        }],
    };
}

/**
 * 公開中の写真か。**`published !== false`**（未指定は公開）で見る
 * ——このリポジトリはどこもその規則で揃っている（`api-user/src/upload.ts` の
 * `isPublished`・photoUpdate・account・userProfile・sync スクリプト）。
 * ストーリーは対象外。写真は必ず `src` を持つ。
 */
function isPublicPhoto(item) {
    if (!item || typeof item !== "object") return false;
    if (!item.src) return false;
    if (item.story === true) return false;
    return item.published !== false;
}

async function main() {
    const apply = process.argv.includes("--apply");
    const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
    const TABLE = requireEnv("PHOTOS_TABLE");

    const { DynamoDBClient, DescribeTableCommand, UpdateTableCommand } = require("@aws-sdk/client-dynamodb");
    const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

    const raw = new DynamoDBClient({ region: REGION });
    const ddb = DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } });

    console.log(`[public-feed] テーブル: ${TABLE}`);
    console.log(`[public-feed] モード: ${apply ? "実行" : "ドライラン（--apply で実行）"}\n`);

    const described = await raw.send(new DescribeTableCommand({ TableName: TABLE }));
    const state = indexState(described);
    console.log(`[public-feed] ${INDEX_NAME}: ${state}`);

    if (state === "missing") {
        if (!apply) {
            console.log("[public-feed] 索引を作成します（ドライランのため実行しません）。");
        } else {
            await raw.send(new UpdateTableCommand(createIndexInput(TABLE)));
            console.log("[public-feed] 索引の作成を開始しました（完了は待ちません）。");
        }
    }

    // 公開写真に publicFeed を書く。索引の作成中でも書いてよい。
    let scanned = 0;
    let target = 0;
    let updated = 0;
    let vanished = 0;
    /** CCF 以外で落ちた（スロットリング等）。緑にしてはいけない */
    const failed = [];
    /** **索引に載せられない行**。0 でないと読む側を切り替えられない */
    const missingCreatedAt = [];
    let lastKey;
    do {
        const res = await ddb.send(new ScanCommand({
            TableName: TABLE,
            ExclusiveStartKey: lastKey,
            // ふるいはコード側で見る（`published` の規則を1か所に保つため）
            ProjectionExpression: "id, src, published, story, createdAt, publicFeed",
        }));
        scanned += res.ScannedCount ?? 0;
        for (const item of res.Items ?? []) {
            if (!isPublicPhoto(item)) continue;
            if (!item.createdAt) { missingCreatedAt.push(item.id); continue; }
            if (item.publicFeed === PUBLIC_FEED_KEY) continue;
            target++;
            if (!apply) continue;
            try {
                await ddb.send(new UpdateCommand({
                    TableName: TABLE,
                    Key: { id: item.id },
                    UpdateExpression: "SET publicFeed = :k",
                    // **走査後に消えた・非公開になった行を蘇らせない／載せない。**
                    // UpdateItem はキーが無ければ行を作る（`photoUpdate.ts` が
                    // 同じ理由で `attribute_exists(id)` を付けている。あちらは
                    // 所有権を Get で確かめたあとなので条件はそれだけ）。
                    //
                    // **`published <> :f`（false でない）で書く。`= :t` ではない。**
                    // 上の `isPublicPhoto` は `published !== false` で見ているので、
                    // `= :t` だと boolean の true 以外（文字列の "true"・数値・null）を
                    // 持つ古い行で**判定と条件がずれる**——ドライランでは「印が必要」と
                    // 数えるのに apply では条件で弾かれ、「走査後に消えた」という
                    // **一時的な競合として報告される**（恒久的に印が付かないのに）。
                    // しかもドライランは条件式を評価しないので事前に検知できない。
                    // `scripts/diagnose-aws.js` が同じ理由で同じ形を使っている。
                    ConditionExpression:
                        "attribute_exists(id) AND attribute_exists(src) "
                        + "AND (attribute_not_exists(published) OR published <> :f) "
                        + "AND (attribute_not_exists(story) OR story <> :t)",
                    ExpressionAttributeValues: { ":k": PUBLIC_FEED_KEY, ":f": false, ":t": true },
                }));
                updated++;
            } catch (e) {
                if (e?.name === "ConditionalCheckFailedException") { vanished++; continue; }
                // **数える。** 握って先へ進むと、取りこぼしがあっても緑になる
                failed.push(item.id);
                console.warn(`[public-feed] ${item.id} の更新に失敗:`, e?.name ?? e);
            }
        }
        lastKey = res.LastEvaluatedKey;
    } while (lastKey);

    console.log(`[public-feed] 走査 ${scanned} 件 / 印が必要な公開写真 ${target} 件`);
    if (apply) console.log(`[public-feed] 書き込み ${updated} 件（走査後に消えた・非公開になった: ${vanished} 件）`);

    // **ここを見てから読む側を切り替えること**
    if (missingCreatedAt.length > 0) {
        console.log(`\n[public-feed] ⚠️ createdAt を持たない公開写真が ${missingCreatedAt.length} 件あります:`);
        for (const id of missingCreatedAt.slice(0, 20)) console.log(`  - ${id}`);
        if (missingCreatedAt.length > 20) console.log(`  … ほか ${missingCreatedAt.length - 20} 件`);
        console.log("  GSI はキーが揃った項目しか載せないので、この写真は**索引に載りません**。");
        console.log("  読む側を Query に切り替えると一覧から消えます。先に createdAt を埋めてください。");
    } else {
        console.log("[public-feed] createdAt を持たない公開写真: 0 件（読む側を切り替えても落ちる行はありません）");
    }

    if (failed.length > 0) {
        console.log(`\n[public-feed] ⚠️ 想定外の失敗が ${failed.length} 件（スロットリング等）。もう一度流してください。`);
    }
    if (!apply) console.log("\n[public-feed] ドライランのため何も変更していません。");

    // **判定は終了コードに出す。** この道具の目的は「読む側を Query に
    // 切り替えてよいか」を答えることなので、答えが「まだ駄目」なら
    // ステップを赤にする。ログに書くだけだと、Actions は緑のまま
    // 誰も読まずに次へ進む（このリポジトリで何度も起きた形）。
    if (missingCreatedAt.length > 0 || failed.length > 0) process.exitCode = 1;
}

module.exports = { indexState, createIndexInput, isPublicPhoto, INDEX_NAME, PUBLIC_FEED_KEY };

if (require.main === module) {
    main().catch((e) => {
        console.error("[public-feed] 失敗:", e);
        process.exit(1);
    });
}
