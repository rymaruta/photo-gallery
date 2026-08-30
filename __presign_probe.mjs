import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const client = new S3Client({
  region: "ap-northeast-1",
  credentials: { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
});

async function show(label, cmdInput, opts) {
  const url = await getSignedUrl(client, new PutObjectCommand(cmdInput), opts);
  const u = new URL(url);
  console.log(label, "=> SignedHeaders:", u.searchParams.get("X-Amz-SignedHeaders"));
  return url;
}

// 1. 現状 (このコミット後)
await show("with signableHeaders + ContentType", {
  Bucket: "b", Key: "k.jpg", ContentType: "image/jpeg", CacheControl: "max-age=31536000",
}, { expiresIn: 900, signableHeaders: new Set(["content-type"]) });

// 2. 修正前
await show("no signableHeaders", {
  Bucket: "b", Key: "k.jpg", ContentType: "image/jpeg", CacheControl: "max-age=31536000",
}, { expiresIn: 900 });

// 3. profile.ts と同じ (CacheControl: no-store)
await show("profile no-store", {
  Bucket: "b", Key: "k.jpg", ContentType: "image/jpeg", CacheControl: "no-store",
}, { expiresIn: 900, signableHeaders: new Set(["content-type"]) });

// 4. ContentType が空文字のとき
await show("empty ContentType", {
  Bucket: "b", Key: "k.jpg", ContentType: "", CacheControl: "max-age=31536000",
}, { expiresIn: 900, signableHeaders: new Set(["content-type"]) });

// 5. ContentType 未指定
await show("undefined ContentType", {
  Bucket: "b", Key: "k.jpg", CacheControl: "max-age=31536000",
}, { expiresIn: 900, signableHeaders: new Set(["content-type"]) });
