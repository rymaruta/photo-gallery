/**
 * deploy-static-site.js
 *
 * Deploys the Next.js static export (out/) to an S3 bucket.
 * Usage: node scripts/deploy-static-site.js --bucket <bucket-name>
 *
 * After upload, invalidates the CloudFront distribution (if CLOUDFRONT_DISTRIBUTION_ID is set).
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Parse --bucket argument
const args = process.argv.slice(2);
const bucketIndex = args.indexOf("--bucket");
if (bucketIndex === -1 || !args[bucketIndex + 1]) {
    console.error("Usage: node scripts/deploy-static-site.js --bucket <bucket-name>");
    process.exit(1);
}
const bucket = args[bucketIndex + 1];
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "out");

if (!fs.existsSync(outDir)) {
    console.error(`ERROR: out/ directory not found. Run 'npm run build' first.`);
    process.exit(1);
}

// Lambda APIが /app/data/photos.json から写真一覧を読むため、
// app/data/photos.json が存在すれば out/ にコピーしてS3にデプロイする
const photosJsonSrc = path.join(root, "app", "data", "photos.json");
const photosJsonDest = path.join(outDir, "app", "data", "photos.json");
if (fs.existsSync(photosJsonSrc)) {
    fs.mkdirSync(path.dirname(photosJsonDest), { recursive: true });
    fs.copyFileSync(photosJsonSrc, photosJsonDest);
    console.log(`[deploy] Copied app/data/photos.json → out/`);
}

console.log(`\n[deploy] Uploading ${outDir} → s3://${bucket}/`);

// Step 1: Upload new assets WITHOUT --delete.
// New hashed files (JS/CSS) are added to S3 alongside old ones.
// Old assets are preserved so any in-flight requests to the current HTML still work.
execSync(
    `aws s3 sync "${outDir}" "s3://${bucket}" --cache-control "public, max-age=31536000, immutable" --exclude "*.html" --exclude "*.txt"`,
    { stdio: "inherit", cwd: root }
);

// Step 2: Swap HTML to point at the newly uploaded assets.
// Only now do users receive HTML that references the new hashes, which are already live.
execSync(
    `aws s3 sync "${outDir}" "s3://${bucket}" --delete --cache-control "no-cache, no-store, must-revalidate" --exclude "*" --include "*.html" --include "*.txt"`,
    { stdio: "inherit", cwd: root }
);

// Step 3: Remove stale assets that are no longer referenced by any HTML.
// Safe to delete now because HTML was already swapped in step 2.
execSync(
    `aws s3 sync "${outDir}" "s3://${bucket}" --delete --cache-control "public, max-age=31536000, immutable" --exclude "*.html" --exclude "*.txt"`,
    { stdio: "inherit", cwd: root }
);

console.log("\n[deploy] S3 sync complete.");

// CloudFront invalidation
const cfDistId = process.env.CLOUDFRONT_DISTRIBUTION_ID;
if (cfDistId) {
    console.log(`[deploy] Invalidating CloudFront distribution ${cfDistId}...`);
    execSync(
        `aws cloudfront create-invalidation --distribution-id ${cfDistId} --paths "/*"`,
        { stdio: "inherit", cwd: root }
    );
    console.log("[deploy] CloudFront invalidation created.");
} else {
    console.log("[deploy] CLOUDFRONT_DISTRIBUTION_ID not set — skipping invalidation.");
    console.log("         Set it in your environment and re-run if you need cache busting.");
}

console.log("\n[deploy] Done.\n");
