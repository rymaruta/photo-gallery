/**
 * S3の uploads/ 配下から、dev-photos.json で参照されていないオブジェクトを削除するスクリプト。
 *
 * 安全策:
 * - 削除対象は uploads/ プレフィックス配下のみ
 * - 削除対象一覧を ./scripts/_artifacts/_cleanup-orphans-*.json に保存
 *
 * 前提:
 * - AWS認証情報は Secrets Manager or 環境変数 or デフォルト認証チェーン（~/.aws/credentials 等）
 * - .env.local に AWS_SECRET_NAME / AWS_REGION / AWS_S3_BUCKET_NAME 等が設定されていること
 *
 * 実行:
 *   npx tsx scripts/cleanup-s3-orphans.ts
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  type _Object,
  type ListObjectsV2CommandOutput,
} from "@aws-sdk/client-s3";
import { getConfig } from "../lib/aws/secrets";

function loadEnvFile() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    if (!key || valueParts.length === 0) continue;
    const value = valueParts.join("=").trim().replace(/^["']|["']$/g, "");
    process.env[key.trim()] = value;
  }
}

loadEnvFile();

type CleanupPlan = {
  bucket: string;
  region: string;
  prefix: string;
  referencedKeys: string[];
  s3Keys: string[];
  deleteKeys: string[];
};

function keyFromUrl(src: string): string | null {
  try {
    const u = new URL(src);
    const key = u.pathname.replace(/^\/+/, "");
    return key || null;
  } catch {
    return null;
  }
}

async function listAllObjects(client: S3Client, bucket: string, prefix: string): Promise<_Object[]> {
  const out: _Object[] = [];
  let token: string | undefined = undefined;

  while (true) {
    const res: ListObjectsV2CommandOutput = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      })
    );
    if (res.Contents) out.push(...res.Contents);
    if (!res.IsTruncated) break;
    token = res.NextContinuationToken;
  }

  return out;
}

async function deleteInBatches(client: S3Client, bucket: string, keys: string[]) {
  const BATCH = 1000;
  for (let i = 0; i < keys.length; i += BATCH) {
    const chunk = keys.slice(i, i + BATCH);
    const res = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: chunk.map((Key) => ({ Key })),
          Quiet: false,
        },
      })
    );

    const deleted = res.Deleted?.length ?? 0;
    const errors = res.Errors?.length ?? 0;
    console.log(`🗑️  deleted batch: ${deleted}, errors: ${errors}`);

    if (res.Errors && res.Errors.length > 0) {
      console.error("Delete errors:", res.Errors.slice(0, 10));
      throw new Error(`DeleteObjects failed for ${res.Errors.length} objects (showing first 10).`);
    }
  }
}

async function main() {
  const prefix = "uploads/";

  const config = await getConfig();
  if (!config.awsS3BucketName) {
    throw new Error("AWS_S3_BUCKET_NAME が未設定です（Secrets Manager または環境変数）。");
  }

  const s3ClientConfig: { region: string; credentials?: { accessKeyId: string; secretAccessKey: string } } = { region: config.awsRegion };
  if (!config.useIamRole && config.awsAccessKeyId && config.awsSecretAccessKey) {
    s3ClientConfig.credentials = {
      accessKeyId: config.awsAccessKeyId,
      secretAccessKey: config.awsSecretAccessKey,
    };
  }
  const client = new S3Client(s3ClientConfig);

  const photosPath = path.join(process.cwd(), "app", "data", "dev-photos.json");
  const photos = JSON.parse(readFileSync(photosPath, "utf-8")) as Array<{ src?: string }>;

  const referenced = new Set<string>();
  for (const p of photos) {
    if (!p.src || typeof p.src !== "string") continue;
    const key = keyFromUrl(p.src);
    if (key) referenced.add(key);
  }

  // 安全: uploads/配下のみが対象
  const referencedUploads = new Set([...referenced].filter((k) => k.startsWith(prefix)));

  const objects = await listAllObjects(client, config.awsS3BucketName, prefix);
  const s3Keys = objects.map((o) => o.Key).filter((k): k is string => !!k);

  const deleteKeys = s3Keys.filter((k) => !referencedUploads.has(k));

  const plan: CleanupPlan = {
    bucket: config.awsS3BucketName,
    region: config.awsRegion,
    prefix,
    referencedKeys: [...referencedUploads].sort(),
    s3Keys: [...s3Keys].sort(),
    deleteKeys: [...deleteKeys].sort(),
  };

  const outPath = path.join(
    process.cwd(),
    "scripts",
    "_artifacts",
    `_cleanup-orphans-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  writeFileSync(outPath, JSON.stringify(plan, null, 2), "utf-8");

  console.log("✅ scanned");
  console.log({ photosJsonReferenced: referencedUploads.size, s3Objects: s3Keys.length, delete: deleteKeys.length });
  console.log(`📝 plan saved: ${outPath}`);

  if (deleteKeys.length === 0) {
    console.log("✨ 削除対象なし");
    return;
  }

  console.log("⚠️  deleting orphan objects in S3 (uploads/ only) ...");
  await deleteInBatches(client, config.awsS3BucketName, deleteKeys);
  console.log("✨ 完了");
}

main().catch((e) => {
  console.error("❌ cleanup failed:", e?.message || e);
  process.exit(1);
});

