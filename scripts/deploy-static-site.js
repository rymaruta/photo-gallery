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

console.log(`\n[deploy] Uploading ${outDir} → s3://${bucket}/`);

// Sync HTML files with no-cache
execSync(
    `aws s3 sync "${outDir}" "s3://${bucket}" --delete --cache-control "no-cache, no-store, must-revalidate" --exclude "*" --include "*.html" --include "*.txt"`,
    { stdio: "inherit", cwd: root }
);

// Sync static assets with long-lived cache
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
