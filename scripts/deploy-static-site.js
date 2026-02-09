/**
 * Deploy static site to S3, optionally invalidate CloudFront.
 * Usage:
 *   node scripts/deploy-static-site.js [--bucket BUCKET] [--distribution-id ID]
 *   Bucket and distribution ID can also come from env or Secrets Manager (AWS_SECRET_NAME).
 *
 * Requires: .env.production (or env) with AWS_SECRET_NAME, AWS_REGION for Secrets Manager.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

// 本番デプロイ時に .env.production を読み込む（AWS_SECRET_NAME / AWS_REGION 用）
function loadEnvProduction() {
  const envPath = path.join(process.cwd(), ".env.production");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvProduction();

const args = process.argv.slice(2);
const getArgValue = (name) => {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : null;
};

// Secrets Managerクライアントを初期化するヘルパー
function getSecretsClient() {
  const region = process.env.AWS_REGION || "ap-northeast-1";
  return new SecretsManagerClient({ region });
}

// Secrets ManagerからCloudFront Distribution IDを取得する関数
async function getCloudFrontDistributionIdFromSecrets() {
  const secretName = process.env.AWS_SECRET_NAME;
  if (!secretName) {
    return null;
  }

  try {
    const client = getSecretsClient();
    const command = new GetSecretValueCommand({
      SecretId: secretName,
    });

    const response = await client.send(command);
    if (response.SecretString) {
      const secret = JSON.parse(response.SecretString);
      return secret.CLOUDFRONT_DISTRIBUTION_ID || null;
    }
    return null;
  } catch (error) {
    console.warn(`[deploy-static-site] Failed to get CLOUDFRONT_DISTRIBUTION_ID from Secrets Manager: ${error.message}`);
    return null;
  }
}

// Secrets Managerからデプロイ先のS3バケット名を取得する関数
async function getBucketNameFromSecrets() {
  const secretName = process.env.AWS_SECRET_NAME;
  if (!secretName) {
    return null;
  }

  try {
    const client = getSecretsClient();
    const command = new GetSecretValueCommand({
      SecretId: secretName,
    });

    const response = await client.send(command);
    if (response.SecretString) {
      const secret = JSON.parse(response.SecretString);
      // 優先順位: AWS_S3_SITE_BUCKET_NAME（静的サイト用） > AWS_S3_BUCKET_NAME
      return secret.AWS_S3_SITE_BUCKET_NAME || secret.AWS_S3_BUCKET_NAME || null;
    }
    return null;
  } catch (error) {
    console.warn(
      `[deploy-static-site] Failed to get bucket name from Secrets Manager: ${error.message}`
    );
    return null;
  }
}

const run = (command) => {
  execSync(command, { stdio: "inherit" });
};

/** コマンドを実行し stdout を返す（検証用）。失敗時は例外。 */
function runCapture(command, opts = {}) {
  return execSync(command, { encoding: "utf-8", ...opts });
}

// CloudFront Distribution IDの取得（優先順位: 引数 > 環境変数 > Secrets Manager）
async function getDistributionId() {
  // 1. コマンドライン引数から取得
  const argDistributionId = getArgValue("--distribution-id");
  if (argDistributionId) {
    return argDistributionId;
  }

  // 2. 環境変数から取得
  if (process.env.CLOUDFRONT_DISTRIBUTION_ID) {
    return process.env.CLOUDFRONT_DISTRIBUTION_ID;
  }

  // 3. Secrets Managerから取得
  const secretDistributionId = await getCloudFrontDistributionIdFromSecrets();
  if (secretDistributionId) {
    return secretDistributionId;
  }

  return null;
}

(async () => {
  // デプロイ先バケット名の取得（優先順位: 引数 > 環境変数 > Secrets Manager）
  let bucket = getArgValue("--bucket") || process.env.S3_BUCKET_NAME;
  if (!bucket) {
    bucket = await getBucketNameFromSecrets();
  }

  if (!bucket) {
    console.error(
      "[deploy-static-site] Missing bucket name.\n" +
        "  To fix this, set one of:\n" +
        "  - --bucket CLI argument\n" +
        "  - S3_BUCKET_NAME environment variable\n" +
        "  - AWS_S3_SITE_BUCKET_NAME or AWS_S3_BUCKET_NAME in the Secrets Manager secret (AWS_SECRET_NAME)"
    );
    process.exit(1);
  }

  console.log("\n==============================");
  console.log("🚀 Starting static site deploy");
  console.log("==============================\n");

  // 本番の app/data/photos.json をローカル prod-photos.json に反映（管理者が本番で登録した写真を上書きしないため）
  const prodPhotosPath = path.join(process.cwd(), "app", "data", "prod-photos.json");
  const dataDir = path.join(process.cwd(), "app", "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  try {
    console.log("[0/3] Pulling app/data/photos.json from production to local prod-photos.json...");
    run(`aws s3 cp s3://${bucket}/app/data/photos.json "${prodPhotosPath}" --only-show-errors`);
    console.log("     → prod-photos.json updated from production.\n");
  } catch (_e) {
    console.log(
      "     → No app/data/photos.json in S3 (or download failed). Using existing local file for upload.\n"
    );
  }

  console.log("[1/3] Building Next.js static site...");
  run("npm run build");

  // /next/ でリクエストが来ても 503 にならないよう、_next を next としても配置する（CloudFront 等で _ が落ちる場合の対策）
  const outNext = path.join(process.cwd(), "out", "next");
  const outUnderNext = path.join(process.cwd(), "out", "_next");
  if (fs.existsSync(outUnderNext)) {
    if (fs.existsSync(outNext)) fs.rmSync(outNext, { recursive: true });
    fs.cpSync(outUnderNext, outNext, { recursive: true });
    console.log("\n[1.5/3] Copied out/_next → out/next (for /next/ requests).");
  }

  // out/ に app/data/photos.json を含め、sync --delete で消えないようにする（本番で「読み込み中」のままになるのを防ぐ）
  const outPhotosDir = path.join(process.cwd(), "out", "app", "data");
  const outPhotosPath = path.join(outPhotosDir, "photos.json");
  if (fs.existsSync(prodPhotosPath)) {
    if (!fs.existsSync(outPhotosDir)) fs.mkdirSync(outPhotosDir, { recursive: true });
    fs.copyFileSync(prodPhotosPath, outPhotosPath);
    console.log("[1.6/3] Copied prod-photos.json → out/app/data/photos.json (for S3 sync).");
  }

  console.log("\n[2/3] Uploading files to S3 bucket:");
  console.log(`      s3://${bucket}/`);
  console.log("      (showing only errors, if any)\n");
  // ファイルごとの詳細ログを抑えて、エラーのみ表示
  run(`aws s3 sync out/ s3://${bucket}/ --delete --only-show-errors --no-progress`);
  console.log("\n✅ S3 upload completed.");

  // index.html を常に再検証させる（古い HTML キャッシュで _next のチャンク名がずれ 503/403 になるのを防ぐ）
  const indexPath = path.join(process.cwd(), "out", "index.html");
  if (fs.existsSync(indexPath)) {
    run(
      `aws s3 cp "${indexPath}" s3://${bucket}/index.html --content-type "text/html; charset=utf-8" --cache-control "no-cache, no-store, must-revalidate, max-age=0"`
    );
    console.log("[2.1/3] Set index.html Cache-Control: no-cache, no-store, must-revalidate, max-age=0");
  }

  // sync --delete で app/data/photos.json が消えるため、本番用を再アップロードする（上で本番から取り直した prod-photos.json をアップロード）
  const devPhotosPath = path.join(process.cwd(), "app", "data", "dev-photos.json");
  if (fs.existsSync(prodPhotosPath) || fs.existsSync(devPhotosPath)) {
    console.log("\n[2.5/3] Restoring app/data/photos.json (sync --delete removes it)...");
    run("node scripts/upload-photos-to-prod.js");
  } else {
    console.warn(
      "\n[2.5/3] ⚠️ app/data/prod-photos.json も dev-photos.json もありません。写真一覧が 0 件になります。\n" +
        "  npm run convert:photos:prod && npm run upload:photos:prod で復元してください。"
    );
  }

  // 再発防止: _next が S3 に存在するか検証（503/403 の多くは _next 未アップロードが原因）
  const region = process.env.AWS_REGION || "ap-northeast-1";
  console.log("\n[2.6/3] Verifying _next/static on S3 (prevent 503/403 on JS/CSS)...");
  try {
    const listOut = runCapture(`aws s3 ls s3://${bucket}/_next/static/chunks/ --region ${region}`);
    const lines = listOut.trim().split("\n").filter(Boolean);
    if (lines.length === 0) {
      console.error(
        "[deploy-static-site] ERROR: s3://" +
          bucket +
          "/_next/static/chunks/ is empty. JS/CSS will 503/403.\n" +
          "  Check that 'out/_next' exists after build and sync completed without errors."
      );
      process.exit(1);
    }
    console.log(`     → _next/static/chunks/ has ${lines.length}+ objects. OK.`);
  } catch (e) {
    console.error(
      "[deploy-static-site] ERROR: Could not list s3://" +
        bucket +
        "/_next/static/chunks/. " +
        (e.stderr || e.message || String(e)) +
        "\n  Fix: ensure build produced out/_next and sync succeeded, then redeploy."
    );
    process.exit(1);
  }

  console.log("\n[3/3] CloudFront cache invalidation (if configured)...");
  const distributionId = await getDistributionId();
  if (distributionId) {
    console.log(
      `[deploy-static-site] Creating CloudFront invalidation for distribution: ${distributionId}`
    );
    run(
      `aws cloudfront create-invalidation --distribution-id ${distributionId} --paths "/*"`
    );
    console.log("✅ CloudFront invalidation completed.");
  } else {
    console.log(
      "[deploy-static-site] Skipped CloudFront invalidation (no distribution id found).\n" +
        "  To enable automatic invalidation, set one of:\n" +
        "  - CLOUDFRONT_DISTRIBUTION_ID environment variable\n" +
        "  - CLOUDFRONT_DISTRIBUTION_ID in Secrets Manager (AWS_SECRET_NAME)\n" +
        "  - --distribution-id command line argument"
    );
  }

  console.log("\n==============================");
  console.log("✅ Deploy finished");
  console.log("==============================\n");
  console.log(
    "※ 古いキャッシュ対策: index.html は no-store、Service Worker は HTML をキャッシュしません。\n" +
      "  それでも 503/403 が出る場合はスーパーリロード（Ctrl+Shift+R）またはサイトデータの削除を試してください。\n"
  );
})();
