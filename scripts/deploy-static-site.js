/**
 * deploy-static-site.js
 *
 * Deploys the Next.js static export (out/) to an S3 bucket using AWS SDK v3.
 * Usage: node scripts/deploy-static-site.js --bucket <bucket-name>
 *
 * After upload, invalidates the CloudFront distribution (if CLOUDFRONT_DISTRIBUTION_ID is set).
 */

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
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const { CloudFrontClient, CreateInvalidationCommand } = require("@aws-sdk/client-cloudfront");
const { lookup: mimeLookup } = require("mime-types");

// Parse --bucket argument（バリデーションは直接実行時のみ。テストからの
// require では判定関数だけを使うため process.exit しない）
const args = process.argv.slice(2);
const bucketIndex = args.indexOf("--bucket");
const bucket = bucketIndex !== -1 ? args[bucketIndex + 1] : undefined;
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "out");

if (require.main === module) {
    if (!bucket) {
        console.error("Usage: node scripts/deploy-static-site.js --bucket <bucket-name>");
        process.exit(1);
    }
    if (!fs.existsSync(outDir)) {
        console.error(`ERROR: out/ directory not found. Run 'npm run build' first.`);
        process.exit(1);
    }
}

// photos.json を out/ にコピー（Lambda が S3 から読む用）
const photosJsonSrc = path.join(root, "app", "data", "photos.json");
const photosJsonDest = path.join(outDir, "app", "data", "photos.json");
if (fs.existsSync(photosJsonSrc)) {
    fs.mkdirSync(path.dirname(photosJsonDest), { recursive: true });
    fs.copyFileSync(photosJsonSrc, photosJsonDest);
    console.log(`[deploy] Copied app/data/photos.json → out/app/data/`);
}

const region = "ap-northeast-1";
const s3 = new S3Client({ region });
const cf = new CloudFrontClient({ region });

/** Recursively collect all files under a directory, returning relative paths. */
function collectFiles(dir, base = dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectFiles(full, base));
        } else {
            files.push(path.relative(base, full));
        }
    }
    return files;
}

function isHtmlOrTxt(filePath) {
    return filePath.endsWith(".html") || filePath.endsWith(".txt");
}

// ハッシュ名でないため内容が変わりうるファイル。ブラウザに長期キャッシュさせない。
// （sw.js が immutable だと Service Worker の更新が届かなくなる）
const NO_CACHE_KEYS = new Set(["sw.js", "manifest.webmanifest", "app/data/photos.json"]);

async function uploadFile(filePath) {
    const fullPath = path.join(outDir, filePath);
    const key = filePath.split(path.sep).join("/"); // S3 uses forward slashes
    const body = fs.readFileSync(fullPath);
    const contentType = mimeLookup(filePath) || "application/octet-stream";
    const cacheControl = isHtmlOrTxt(filePath) || NO_CACHE_KEYS.has(key)
        ? "no-cache, no-store, must-revalidate"
        : "public, max-age=31536000, immutable";

    await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
    }));
}

async function listS3Objects() {
    const objects = [];
    let continuationToken;
    do {
        const res = await s3.send(new ListObjectsV2Command({
            Bucket: bucket,
            ContinuationToken: continuationToken,
        }));
        for (const obj of res.Contents ?? []) {
            if (obj.Key) objects.push({ key: obj.Key, lastModified: obj.LastModified });
        }
        continuationToken = res.NextContinuationToken;
    } while (continuationToken);
    return objects;
}

// 旧アセットの削除猶予期間。
// キャッシュされた古い HTML（ブラウザ・アプリ内ブラウザ・CDNエッジ）は
// 旧ハッシュ名の JS/CSS を参照し続けるため、即削除するとその HTML を持つ
// 端末で JS が 404 になり「表示はされるが一切タップできない」状態になる。
// HTML は no-cache なので即削除してよいが、アセットは猶予期間だけ残す。
const ASSET_GRACE_MS = 30 * 24 * 60 * 60 * 1000; // 30日（コスト僅少・安全側に倒す）

// 削除対象の判定（純関数・テスト対象）。
// - 今回のビルドに含まれるキーは絶対に削除しない
// - ビルドに無い HTML/txt は即削除（HTML は no-store 配信のため安全）
// - ビルドに無いアセットは猶予期間内なら保持（古い HTML を持つ端末の 404 防止）
function classifyStaleObjects(localKeys, remoteObjects, now, graceMs) {
    const localSet = new Set(localKeys.map(k => k.split(path.sep).join("/")));
    const toDelete = [];
    let kept = 0;
    for (const obj of remoteObjects) {
        if (localSet.has(obj.key)) continue;
        const isHtml = isHtmlOrTxt(obj.key);
        const age = obj.lastModified ? now - obj.lastModified.getTime() : Infinity;
        if (isHtml || age > graceMs) {
            toDelete.push(obj.key);
        } else {
            kept++;
        }
    }
    return { toDelete, kept };
}

async function deleteStaleKeys(localKeys, remoteObjects) {
    const { toDelete, kept } = classifyStaleObjects(localKeys, remoteObjects, Date.now(), ASSET_GRACE_MS);
    if (kept > 0) console.log(`[deploy] Keeping ${kept} stale asset(s) within ${ASSET_GRACE_MS / 86400000}-day grace period.`);
    if (toDelete.length === 0) return;
    // DeleteObjects accepts up to 1000 keys at a time
    for (let i = 0; i < toDelete.length; i += 1000) {
        const batch = toDelete.slice(i, i + 1000).map(Key => ({ Key }));
        await s3.send(new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: batch },
        }));
        console.log(`[deploy] Deleted ${batch.length} stale object(s).`);
    }
}

async function main() {
    console.log(`\n[deploy] Uploading ${outDir} → s3://${bucket}/`);

    const allFiles = collectFiles(outDir);
    const assets = allFiles.filter(f => !isHtmlOrTxt(f));
    const htmlFiles = allFiles.filter(f => isHtmlOrTxt(f));

    // Step 1: Upload new hashed assets first (JS/CSS/images), no --delete yet.
    //         Old assets stay so in-flight requests to current HTML still work.
    console.log(`[deploy] Step 1/3: uploading ${assets.length} asset(s)...`);
    await Promise.all(assets.map(uploadFile));

    // Step 2: Swap HTML — users now receive HTML pointing at the new assets.
    console.log(`[deploy] Step 2/3: uploading ${htmlFiles.length} HTML/txt file(s)...`);
    for (const f of htmlFiles) await uploadFile(f);

    // Step 3: Remove stale objects (assets get a grace period; see deleteStaleKeys).
    console.log("[deploy] Step 3/3: removing stale S3 objects...");
    const remoteObjects = await listS3Objects();
    await deleteStaleKeys(allFiles, remoteObjects);

    console.log("\n[deploy] S3 sync complete.");

    // CloudFront invalidation
    const cfDistId = process.env.CLOUDFRONT_DISTRIBUTION_ID;
    if (cfDistId) {
        console.log(`[deploy] Invalidating CloudFront distribution ${cfDistId}...`);
        await cf.send(new CreateInvalidationCommand({
            DistributionId: cfDistId,
            InvalidationBatch: {
                CallerReference: String(Date.now()),
                Paths: { Quantity: 1, Items: ["/*"] },
            },
        }));
        console.log("[deploy] CloudFront invalidation created.");
    } else {
        console.log("[deploy] CLOUDFRONT_DISTRIBUTION_ID not set — skipping invalidation.");
    }

    console.log("\n[deploy] Done.\n");
}

// テストから判定ロジックを検証できるようにエクスポート
module.exports = { classifyStaleObjects, isHtmlOrTxt, ASSET_GRACE_MS };

if (require.main === module) main().catch(err => {
    console.error("[deploy] ERROR:", err.message ?? err);
    process.exit(1);
});
