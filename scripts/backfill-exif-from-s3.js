/**
 * backfill-exif-from-s3.js
 *
 * EXIF が欠けている写真について、S3 の「オリジナル画像」からサーバー側で EXIF を
 * 再抽出し、DynamoDB に書き戻す（部分更新 = 他のフィールドは保持）。
 * アップロード時にブラウザ側 exifr が取りこぼした（HEIC・特定メーカーノート・端末制約 等）
 * ケースを、元画像から確実に復元するための保守スクリプト。
 *
 * 既定は DRY-RUN（読み取りのみ・DynamoDB は変更しない）。実際に書き込むには APPLY=1。
 *
 * 環境変数:
 *   AWS_REGION     (default: ap-northeast-1)
 *   PHOTOS_TABLE   (default: prod-photo-gallery-photos)
 *   UPLOAD_BUCKET  (default: prod-journey-photo-upload)
 *   APPLY=1        書き込みを実行（未指定なら dry-run）
 *   ONLY_ID=<id>   特定の写真だけ対象にする（任意）
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const exifr = require("exifr");

const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
const TABLE = process.env.PHOTOS_TABLE ?? "prod-photo-gallery-photos";
const BUCKET = process.env.UPLOAD_BUCKET ?? "prod-journey-photo-upload";
const APPLY = process.env.APPLY === "1";
const ONLY_ID = process.env.ONLY_ID || "";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
    marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({ region: REGION });

// src / key から uploads/ 配下の S3 キーを導出する（account.ts / stories.ts と同じ考え方）
function deriveKey(item) {
    if (typeof item.key === "string" && item.key.startsWith("uploads/")) return item.key;
    if (typeof item.src === "string") {
        try {
            const p = new URL(item.src).pathname.replace(/^\//, "");
            if (p.startsWith("uploads/")) return p;
        } catch { /* not a URL */ }
        if (item.src.startsWith("uploads/")) return item.src;
    }
    return "";
}

function hasExif(item) {
    return item.exif && typeof item.exif === "object" && Object.keys(item.exif).length > 0;
}

function formatCameraName(make, model) {
    const mk = (make ?? "").trim();
    const md = (model ?? "").trim();
    if (!mk && !md) return undefined;
    if (!md) return mk;
    if (!mk || md.toLowerCase().startsWith(mk.toLowerCase())) return md;
    return `${mk} ${md}`;
}
function formatExposure(t) {
    if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) return undefined;
    if (t >= 1) return `${Number(t.toFixed(1))}s`;
    return `1/${Math.round(1 / t)}s`;
}

// lib/utils/exif.ts の extractCameraExif と同じマッピング（サーバー版）
function mapExif(data) {
    if (!data) return {};
    const out = {};
    const camera = formatCameraName(
        typeof data.Make === "string" ? data.Make : undefined,
        typeof data.Model === "string" ? data.Model : undefined,
    );
    if (camera) out.camera = camera;
    if (typeof data.LensModel === "string" && data.LensModel.trim()) out.lens = data.LensModel.trim();
    if (typeof data.FNumber === "number" && data.FNumber > 0) out.aperture = `f/${Number(data.FNumber.toFixed(1))}`;
    const exposure = formatExposure(typeof data.ExposureTime === "number" ? data.ExposureTime : undefined);
    if (exposure) out.exposure = exposure;
    if (typeof data.ISO === "number" && data.ISO > 0) out.iso = Math.round(data.ISO);
    if (typeof data.FocalLength === "number" && data.FocalLength > 0) out.focalLength = `${Math.round(data.FocalLength)}mm`;
    if (data.WhiteBalance === 0 || data.WhiteBalance === "Auto") out.whiteBalance = "Auto";
    else if (data.WhiteBalance === 1 || data.WhiteBalance === "Manual") out.whiteBalance = "Manual";
    if (typeof data.ExifImageWidth === "number" && typeof data.ExifImageHeight === "number") {
        out.imageSize = `${data.ExifImageWidth}x${data.ExifImageHeight}`;
    }
    const dt = data.DateTimeOriginal ?? data.CreateDate;
    if (dt instanceof Date && !isNaN(dt.getTime())) out.dateTimeOriginal = dt.toISOString();
    return out;
}

const PICK = ["Make", "Model", "LensModel", "FNumber", "ExposureTime", "ISO",
    "FocalLength", "WhiteBalance", "ExifImageWidth", "ExifImageHeight", "DateTimeOriginal", "CreateDate"];

async function streamToBuffer(stream) {
    const chunks = [];
    for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return Buffer.concat(chunks);
}

async function scanAll() {
    const items = [];
    let lastKey;
    do {
        const res = await ddb.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: lastKey }));
        items.push(...(res.Items ?? []));
        lastKey = res.LastEvaluatedKey;
    } while (lastKey);
    return items;
}

async function main() {
    console.log(`\n[backfill-exif] table=${TABLE} bucket=${BUCKET} mode=${APPLY ? "APPLY" : "DRY-RUN"}`);
    const all = await scanAll();
    // 写真のみ（src あり・公開）で EXIF が欠けているもの
    let targets = all.filter((it) => it.src && it.published !== false && !hasExif(it));
    if (ONLY_ID) targets = all.filter((it) => it.id === ONLY_ID);
    console.log(`[backfill-exif] photos total=${all.filter((i) => i.src && i.published !== false).length}, missing exif=${targets.length}`);

    let recovered = 0, empty = 0, failed = 0;
    for (const item of targets) {
        const key = deriveKey(item);
        const id = String(item.id).slice(0, 8);
        if (!key) { console.log(`  - ${id}: S3キーを導出できず (src=${item.src})`); failed++; continue; }
        try {
            const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
            const buf = await streamToBuffer(obj.Body);
            const data = await exifr.parse(buf, { pick: PICK }).catch(() => undefined);
            const exif = mapExif(data);
            if (Object.keys(exif).length === 0) {
                console.log(`  - ${id}: 元画像に EXIF なし (${key}, ${(buf.length / 1024 / 1024).toFixed(1)}MB)`);
                empty++;
                continue;
            }
            console.log(`  ✓ ${id}: 復元可 → ${JSON.stringify(exif)}`);
            recovered++;
            if (APPLY) {
                await ddb.send(new UpdateCommand({
                    TableName: TABLE,
                    Key: { id: item.id },
                    UpdateExpression: "SET exif = :e, updatedAt = :t",
                    ExpressionAttributeValues: { ":e": exif, ":t": new Date().toISOString() },
                    ConditionExpression: "attribute_exists(id)",
                }));
                console.log(`      → DynamoDB に書き込みました`);
            }
        } catch (e) {
            console.log(`  - ${id}: 取得/解析に失敗 (${key}): ${e.message}`);
            failed++;
        }
    }

    console.log(`\n[backfill-exif] recoverable=${recovered}, original-has-no-exif=${empty}, failed=${failed}`);
    if (!APPLY && recovered > 0) console.log("[backfill-exif] DRY-RUN でした。書き込むには APPLY=1 を付けて再実行してください。");
}

main().catch((e) => { console.error("[backfill-exif] error:", e); process.exit(1); });
