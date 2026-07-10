/**
 * generate-thumbnails.js — 既存写真のサムネイル一括生成（移行スクリプト）
 *
 * thumbSrc を持たない既存の写真について、S3 の元画像から 512px WebP の
 * サムネイルを生成して同じバケットに保存し、DynamoDB に thumbSrc を書き込む。
 * （新規アップロードはクライアント側で生成されるため、これは過去分の移行用）
 *
 * 使い方:
 *   node scripts/generate-thumbnails.js            # 実行
 *   DRY_RUN=1 node scripts/generate-thumbnails.js  # 対象の確認のみ
 *
 * 環境変数:
 *   AWS_REGION      (default: ap-northeast-1)
 *   PHOTOS_TABLE    (default: prod-photo-gallery-photos)
 *   UPLOAD_BUCKET   (default: prod-journey-photo-upload)
 *   CLOUDFRONT_URL  (default: https://d1s3dwwzgxf5ni.cloudfront.net)
 *
 * 冪等: thumbSrc が既にある写真はスキップするので何度実行しても安全。
 * 1件の失敗は記録して続行する（全体を止めない）。
 */

const fs = require("fs");
const path = require("path");

// .env.local から AWS 認証情報を読み込む（ローカル実行用。CI では環境変数で渡る）
const envLocalPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envLocalPath)) {
    for (const line of fs.readFileSync(envLocalPath, "utf8").split("\n")) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
    }
}

const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
const TABLE = process.env.PHOTOS_TABLE ?? "prod-photo-gallery-photos";
const BUCKET = process.env.UPLOAD_BUCKET ?? "prod-journey-photo-upload";
const CLOUDFRONT_URL = (process.env.CLOUDFRONT_URL ?? "https://d1s3dwwzgxf5ni.cloudfront.net").replace(/\/$/, "");
const DRY_RUN = process.env.DRY_RUN === "1";

const THUMB_MAX_PX = 512;
const THUMB_QUALITY = 75;

// 動画やアニメGIFはサムネ生成の対象外（クライアント側の挙動と揃える）
const SKIP_EXTENSIONS = new Set(["mp4", "webm", "mov", "gif"]);

/** src の URL から S3 キーを取り出す（例: https://cdn/uploads/x.jpg → uploads/x.jpg） */
function keyFromSrc(src) {
    try {
        const pathname = decodeURIComponent(new URL(src).pathname);
        return pathname.replace(/^\/+/, "") || null;
    } catch {
        return null;
    }
}

/** 元キーからサムネイルのキーを作る（例: uploads/x.jpg → uploads/x_thumb.webp） */
function thumbKeyFor(key) {
    const dir = key.includes("/") ? key.slice(0, key.lastIndexOf("/") + 1) : "";
    const base = key.slice(dir.length).replace(/\.[^.]+$/, "");
    return `${dir}${base}_thumb.webp`;
}

/** この写真がサムネ生成の対象か（写真であり、まだ thumbSrc がない） */
function shouldProcess(item) {
    if (!item || typeof item.src !== "string" || !item.src) return false; // like#/go# マーカー等
    if (item.thumbSrc) return false; // 生成済み
    const key = keyFromSrc(item.src);
    if (!key) return false;
    const ext = key.split(".").pop()?.toLowerCase() ?? "";
    return !SKIP_EXTENSIONS.has(ext);
}

async function main() {
    const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
    const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
    const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
    const sharp = require("sharp");

    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
        marshallOptions: { removeUndefinedValues: true },
    });
    const s3 = new S3Client({ region: REGION });

    console.log(`\n[thumbs] table=${TABLE} bucket=${BUCKET} region=${REGION}${DRY_RUN ? " (DRY_RUN)" : ""}`);

    // 全件スキャンして対象を絞る
    const items = [];
    let lastKey;
    do {
        const res = await ddb.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: lastKey }));
        items.push(...(res.Items ?? []));
        lastKey = res.LastEvaluatedKey;
    } while (lastKey);

    const targets = items.filter(shouldProcess);
    console.log(`[thumbs] ${items.length} 件中、生成対象 ${targets.length} 件`);
    if (DRY_RUN) {
        for (const t of targets) console.log(`  - ${t.id}  ${keyFromSrc(t.src)}`);
        console.log("[thumbs] DRY_RUN=1 のため生成せず終了");
        return;
    }

    let ok = 0, failed = 0;
    for (const [i, item] of targets.entries()) {
        const key = keyFromSrc(item.src);
        const thumbKey = thumbKeyFor(key);
        try {
            // 1) 元画像を取得
            const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
            const buf = Buffer.from(await obj.Body.transformToByteArray());

            // 2) 512px WebP を生成（EXIF の向きを反映しつつメタデータは持ち越さない）
            const thumb = await sharp(buf)
                .rotate()
                .resize({ width: THUMB_MAX_PX, height: THUMB_MAX_PX, fit: "inside", withoutEnlargement: true })
                .webp({ quality: THUMB_QUALITY })
                .toBuffer();

            // 3) アップロード
            await s3.send(new PutObjectCommand({
                Bucket: BUCKET,
                Key: thumbKey,
                Body: thumb,
                ContentType: "image/webp",
                CacheControl: "max-age=31536000",
            }));

            // 4) DynamoDB に thumbSrc を記録
            const thumbSrc = `${CLOUDFRONT_URL}/${thumbKey}`;
            await ddb.send(new UpdateCommand({
                TableName: TABLE,
                Key: { id: item.id },
                UpdateExpression: "SET thumbSrc = :t, updatedAt = :u",
                // 再スキャンとの競合や削除済み写真への復活書き込みを防ぐ
                ConditionExpression: "attribute_exists(id) AND attribute_not_exists(thumbSrc)",
                ExpressionAttributeValues: { ":t": thumbSrc, ":u": new Date().toISOString() },
            }));

            ok++;
            console.log(`  [${i + 1}/${targets.length}] ✅ ${item.id}  ${(buf.length / 1024).toFixed(0)}KB → ${(thumb.length / 1024).toFixed(0)}KB`);
        } catch (err) {
            failed++;
            console.error(`  [${i + 1}/${targets.length}] ❌ ${item.id} (${key}): ${err.message ?? err}`);
        }
    }

    console.log(`\n[thumbs] 完了: 成功 ${ok} / 失敗 ${failed}`);
    // 生成対象があったのに1件も成功しなかった場合のみ異常終了
    if (targets.length > 0 && ok === 0) process.exit(1);
}

module.exports = { keyFromSrc, thumbKeyFor, shouldProcess };

if (require.main === module) {
    main().catch((err) => {
        console.error("[thumbs] unexpected error:", err);
        process.exit(1);
    });
}
