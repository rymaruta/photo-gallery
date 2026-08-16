/**
 * generate-thumbnails.js — 既存写真のサムネイル生成＋表示メタデータ補完（移行スクリプト）
 *
 * S3 の元画像から次を生成して DynamoDB に書き戻す:
 *   - thumbSrc        : 512px WebP サムネイル（同バケットに保存）
 *   - width / height  : 元画像の表示寸法（EXIF 回転を反映）
 *   - aspectRatio     : width / height
 *   - dominantColor   : 支配的な色（#rrggbb）… グリッドの色プレースホルダ(LQIP)に使用
 * （新規アップロードはクライアント側で thumbSrc 等を生成するため、これは過去分の移行用）
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
 * 冪等: thumbSrc とメタデータが揃っている写真はスキップするので何度実行しても安全。
 * サムネだけ在ってメタが無い写真は、サムネ再生成せずメタのみ補完する。
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

// サムネ以外に補完する表示メタデータのフィールド
const META_FIELDS = ["dominantColor", "width", "height", "aspectRatio", "blurDataURL"];

// ぼかしプレビューの元サイズ（長辺px）。極小にして base64 を軽く保つ
const BLUR_MAX_PX = 20;
const BLUR_QUALITY = 40;

const isBlank = (v) => v === undefined || v === null || v === "";

/** サムネ生成対象になり得る「写真」か（src を持ち、動画/GIF でない） */
function isProcessableImage(item) {
    if (!item || typeof item.src !== "string" || !item.src) return false; // like#/go# マーカー等
    const key = keyFromSrc(item.src);
    if (!key) return false;
    const ext = key.split(".").pop()?.toLowerCase() ?? "";
    return !SKIP_EXTENSIONS.has(ext);
}

/** サムネイル未生成か */
function needsThumb(item) {
    return isProcessableImage(item) && isBlank(item.thumbSrc);
}

/** 表示メタデータ（寸法・支配色）が未補完か */
function needsMeta(item) {
    return isProcessableImage(item) && META_FIELDS.some((f) => isBlank(item[f]));
}

/** この写真に対して何らかの処理（サムネ or メタ補完）が必要か */
function shouldProcess(item) {
    return needsThumb(item) || needsMeta(item);
}

/** 0-255 のチャンネル値を 2 桁 16 進に */
function hexFromChannel(c) {
    return Math.max(0, Math.min(255, Math.round(c ?? 0))).toString(16).padStart(2, "0");
}

/**
 * sharp の metadata()/stats() の生値から DynamoDB に書く表示メタを作る（純関数・テスト可能）。
 * EXIF orientation 5-8 は 90/270 度回転のため、表示上の幅・高さを入れ替える。
 */
function buildMetaFields({ width, height, orientation, dominant } = {}) {
    let w = width, h = height;
    if (orientation && orientation >= 5) { const t = w; w = h; h = t; }
    const out = {};
    if (typeof w === "number" && w > 0) out.width = w;
    if (typeof h === "number" && h > 0) out.height = h;
    if (out.width && out.height) out.aspectRatio = Number((out.width / out.height).toFixed(4));
    if (dominant) out.dominantColor = `#${hexFromChannel(dominant.r)}${hexFromChannel(dominant.g)}${hexFromChannel(dominant.b)}`;
    return out;
}

/** 元画像バッファから表示メタを算出する（寸法・支配色・ぼかしプレビュー） */
async function computeMetaFromBuffer(sharp, buf) {
    const meta = await sharp(buf).metadata();
    const stats = await sharp(buf).stats();
    const out = buildMetaFields({
        width: meta.width,
        height: meta.height,
        orientation: meta.orientation,
        dominant: stats.dominant,
    });
    // 極小ぼかしプレビュー（blur-up 用）。EXIF 回転を反映しつつ 20px WebP に。
    const blur = await sharp(buf)
        .rotate()
        .resize({ width: BLUR_MAX_PX, height: BLUR_MAX_PX, fit: "inside", withoutEnlargement: true })
        .webp({ quality: BLUR_QUALITY })
        .toBuffer();
    out.blurDataURL = `data:image/webp;base64,${blur.toString("base64")}`;
    return out;
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
    console.log(`[thumbs] ${items.length} 件中、処理対象 ${targets.length} 件`);
    if (DRY_RUN) {
        for (const t of targets) {
            const jobs = [needsThumb(t) && "thumb", needsMeta(t) && "meta"].filter(Boolean).join("+");
            console.log(`  - ${t.id}  ${keyFromSrc(t.src)}  [${jobs}]`);
        }
        console.log("[thumbs] DRY_RUN=1 のため生成せず終了");
        return;
    }

    let ok = 0, failed = 0;
    for (const [i, item] of targets.entries()) {
        const key = keyFromSrc(item.src);
        const doThumb = needsThumb(item);
        const doMeta = needsMeta(item);
        try {
            // 1) 元画像を取得（サムネ・メタどちらにも必要）
            const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
            const buf = Buffer.from(await obj.Body.transformToByteArray());

            // 書き込むフィールドを組み立てる
            const fields = {};
            let thumbInfo = "";

            if (doThumb) {
                // 512px WebP を生成（EXIF の向きを反映しつつメタデータは持ち越さない）
                const thumbKey = thumbKeyFor(key);
                const thumb = await sharp(buf)
                    .rotate()
                    .resize({ width: THUMB_MAX_PX, height: THUMB_MAX_PX, fit: "inside", withoutEnlargement: true })
                    .webp({ quality: THUMB_QUALITY })
                    .toBuffer();
                await s3.send(new PutObjectCommand({
                    Bucket: BUCKET,
                    Key: thumbKey,
                    Body: thumb,
                    ContentType: "image/webp",
                    CacheControl: "max-age=31536000",
                }));
                fields.thumbSrc = `${CLOUDFRONT_URL}/${thumbKey}`;
                thumbInfo = ` ${(buf.length / 1024).toFixed(0)}KB → ${(thumb.length / 1024).toFixed(0)}KB`;
            }

            if (doMeta) {
                Object.assign(fields, await computeMetaFromBuffer(sharp, buf));
            }

            // 2) DynamoDB へ動的 SET（更新するフィールドだけ書く）
            const names = {}, values = { ":u": new Date().toISOString() };
            const sets = ["updatedAt = :u"];
            for (const [k, v] of Object.entries(fields)) {
                names[`#${k}`] = k;
                values[`:${k}`] = v;
                sets.push(`#${k} = :${k}`);
            }
            await ddb.send(new UpdateCommand({
                TableName: TABLE,
                Key: { id: item.id },
                UpdateExpression: "SET " + sets.join(", "),
                // 削除済み写真への復活書き込みを防ぐ
                ConditionExpression: "attribute_exists(id)",
                ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
                ExpressionAttributeValues: values,
            }));

            ok++;
            const jobs = [doThumb && "thumb", doMeta && "meta"].filter(Boolean).join("+");
            console.log(`  [${i + 1}/${targets.length}] ✅ ${item.id}  [${jobs}]${thumbInfo}`);
        } catch (err) {
            failed++;
            console.error(`  [${i + 1}/${targets.length}] ❌ ${item.id} (${key}): ${err.message ?? err}`);
        }
    }

    console.log(`\n[thumbs] 完了: 成功 ${ok} / 失敗 ${failed}`);
    // 生成対象があったのに1件も成功しなかった場合のみ異常終了
    if (targets.length > 0 && ok === 0) process.exit(1);
}

module.exports = {
    keyFromSrc, thumbKeyFor, shouldProcess,
    needsThumb, needsMeta, buildMetaFields, hexFromChannel,
};

if (require.main === module) {
    main().catch((err) => {
        console.error("[thumbs] unexpected error:", err);
        process.exit(1);
    });
}
