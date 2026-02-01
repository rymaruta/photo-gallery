/**
 * dev-journey-photo.com / dev-journey-photo-upload へアップロード
 *
 * - dev-photos.json → s3://dev-journey-photo.com/app/data/photos.json
 * - 画像 → s3://dev-journey-photo-upload/uploads/<id>.<ext>
 *
 * dev-photos.json の各項目と public/images の対応は、タイトル(ja)で BASE_PHOTOS と照合します。
 * AWS の認証情報は通常の credential チェーン（~/.aws/credentials 等）を利用します。
 *
 * 使用例:
 *   npx tsx scripts/upload-to-dev-s3.ts
 *   npm run dev:upload
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { getLocalized, BASE_PHOTOS } from "../app/data/photos";
import type { Photo } from "../app/data/photos";

// 環境変数で切り替え可能（デフォルトはdev）
const STAGE = process.env.STAGE || "dev";
const REGION = process.env.AWS_REGION || "ap-northeast-1";
const UPLOAD_BUCKET = process.env.UPLOAD_BUCKET || (STAGE === "prod" ? "prod-journey-photo-upload" : "dev-journey-photo-upload");
const SITE_BUCKET = process.env.SITE_BUCKET || (STAGE === "prod" ? "journey-photo.com" : "dev-journey-photo.com");
const PHOTOS_JSON_KEY = "app/data/photos.json";

function getImageContentType(ext: string): string {
  const e = ext.toLowerCase();
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".png") return "image/png";
  if (e === ".gif") return "image/gif";
  if (e === ".webp") return "image/webp";
  return "image/jpeg";
}

/** BASE_PHOTOS から タイトル(ja) → public 内の相対パス のマップを作成 */
function buildTitleToLocalPath(): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of BASE_PHOTOS) {
    const t = getLocalized(p.title, "ja");
    if (!t || !p.src?.startsWith("/images/")) continue;
    const local = path.join(process.cwd(), "public", p.src.replace(/^\//, ""));
    map.set(t, local);
  }
  return map;
}

/** photo.src の URL から拡張子を取得（例: .jpg） */
function getExtFromSrc(src: string): string {
  const p = new URL(src).pathname;
  const ext = path.extname(p);
  return ext || ".jpg";
}

async function main() {
  console.log(`📤 S3 へのアップロードを開始します (stage: ${STAGE})\n`);
  console.log(`  dev-photos.json → s3://${SITE_BUCKET}/${PHOTOS_JSON_KEY}`);
  console.log(`  画像        → s3://${UPLOAD_BUCKET}/uploads/<id>.<ext>\n`);

  const photosJsonPath = path.join(process.cwd(), "app", "data", "dev-photos.json");
  if (!existsSync(photosJsonPath)) {
    console.error("❌ app/data/dev-photos.json が見つかりません");
    process.exit(1);
  }

  const photos: Photo[] = JSON.parse(readFileSync(photosJsonPath, "utf-8"));
  const titleToPath = buildTitleToLocalPath();
  const s3 = new S3Client({ region: REGION });

  let uploaded = 0;
  let skipped = 0;

  // 1. 画像をアップロード用バケットへ
  for (const photo of photos) {
    const titleJa = getLocalized(photo.title, "ja");
    const localPath = titleToPath.get(titleJa);
    if (!localPath || !existsSync(localPath)) {
      console.warn(`⏭️  スキップ（ローカルに未対応）: ${titleJa || photo.id}`);
      skipped++;
      continue;
    }
    const ext = getExtFromSrc(photo.src);
    const key = `uploads/${photo.id}${ext}`;
    const body = readFileSync(localPath);
    const contentType = getImageContentType(ext);
    await s3.send(
      new PutObjectCommand({
        Bucket: UPLOAD_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
    console.log(`  ✅ 画像: ${key}`);
    uploaded++;
  }

  // 2. dev-photos.json を dev-journey-photo.com へ（S3 キーは app/data/photos.json）
  const photosJsonBody = readFileSync(photosJsonPath, "utf-8");
  await s3.send(
    new PutObjectCommand({
      Bucket: SITE_BUCKET,
      Key: PHOTOS_JSON_KEY,
      Body: photosJsonBody,
      ContentType: "application/json",
    })
  );
  console.log(`\n  ✅ メタデータ: ${PHOTOS_JSON_KEY}`);

  console.log("\n📊 結果:");
  console.log(`  画像: アップロード ${uploaded} 件, スキップ ${skipped} 件`);
  console.log(`  メタデータ: 1 件`);
  console.log(`\n✨ 完了 (stage: ${STAGE})。`);
  if (STAGE === "dev") {
    console.log("   ローカルで NEXT_PUBLIC_API_BASE_URL を開発用 API に合わせ、npm run dev で確認できます。");
  }
}

main().catch((e) => {
  console.error("❌ エラー:", e.message);
  process.exit(1);
});
