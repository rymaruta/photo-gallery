/**
 * 本番 S3 サイトバケットに本番用の写真一覧（prod-photos.json）をアップロードする。
 * 本番で「写真が0件」になる原因は、このファイルがバケットに無いため。
 *
 * 使い方:
 *   1) npm run convert:photos:prod  … dev-photos.json から prod-photos.json を生成
 *   2) npm run upload:photos:prod   … prod-photos.json を本番 S3 にアップロード
 *
 * prod-photos.json が無い場合は、dev-photos.json を変換してからアップロードします（非推奨: 分離のため convert を推奨）。
 *
 * 前提:
 *   - .env.production に AWS_SECRET_NAME（本番用）と AWS_REGION がある
 *   - ローカルに app/data/dev-photos.json（開発用）がある
 *   - AWS CLI または環境変数で認証済み
 *
 * オプション:
 *   PROD_PHOTOS_SOURCE=app/data/prod-photos.json  … アップロード元ファイル（未指定時は prod-photos.json → 無ければ dev-photos.json を変換）
 *   PROD_SITE_BUCKET=journey-photo.com            … バケット名を直接指定
 */
const fs = require("fs");
const path = require("path");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

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

const region = process.env.AWS_REGION || "ap-northeast-1";
const dataDir = path.join(process.cwd(), "app", "data");
const prodPath = path.join(dataDir, "prod-photos.json");
const devPath = path.join(dataDir, "dev-photos.json");
const photosPath = process.env.PROD_PHOTOS_SOURCE
  ? path.resolve(process.cwd(), process.env.PROD_PHOTOS_SOURCE)
  : fs.existsSync(prodPath)
    ? prodPath
    : devPath;
const key = "app/data/photos.json";

async function getBucketFromSecrets() {
  const secretName = process.env.AWS_SECRET_NAME;
  if (!secretName) return null;
  const client = new SecretsManagerClient({ region });
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretName })
  );
  if (!response.SecretString) return null;
  const secret = JSON.parse(response.SecretString);
  return secret.AWS_S3_SITE_BUCKET_NAME || null;
}

async function main() {
  if (!fs.existsSync(photosPath)) {
    console.error(
      "[upload-photos-to-prod] 本番用の写真ファイルが見つかりません。\n" +
        "  1) npm run convert:photos:prod で app/data/prod-photos.json を生成\n" +
        "  2) または app/data/dev-photos.json（開発用）を用意してから再度実行\n" +
        "  管理画面から本番でアップロードしても構いません。"
    );
    process.exit(1);
  }
  if (photosPath === devPath) {
    console.log("[upload-photos-to-prod] prod-photos.json が無いため dev-photos.json を変換してアップロードします。次回は npm run convert:photos:prod を推奨します。");
  }

  let bucket =
    process.env.PROD_SITE_BUCKET ||
    process.env.AWS_S3_SITE_BUCKET_NAME ||
    (await getBucketFromSecrets());

  if (!bucket) {
    console.error(
      "[upload-photos-to-prod] 本番サイト用バケット名がわかりません。\n" +
        "  1) .env.production に AWS_SECRET_NAME=prod-journey-photo-upload があるか確認\n" +
        "  2) または PROD_SITE_BUCKET=journey-photo.com のように環境変数で指定\n" +
        "  例: PROD_SITE_BUCKET=journey-photo.com npm run upload:photos:prod"
    );
    process.exit(1);
  }

  let body = fs.readFileSync(photosPath, "utf-8");
  // 開発用 dev-photos.json をアップロードするときは、画像 URL を本番用に変換してから送る
  if (photosPath === devPath) {
    const prodBase = process.env.PROD_PHOTO_BASE_URL || "https://journey-photo.com";
    body = body.replace(
      /https:\/\/dev-journey-photo-upload\.s3\.ap-northeast-1\.amazonaws\.com/g,
      prodBase
    );
  }
  const s3 = new S3Client({ region });

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: "application/json",
      })
    );
    console.log(
      `[upload-photos-to-prod] アップロード完了: s3://${bucket}/${key}`
    );
  } catch (err) {
    console.error("[upload-photos-to-prod] アップロード失敗:", err.message);
    process.exit(1);
  }
}

main();
