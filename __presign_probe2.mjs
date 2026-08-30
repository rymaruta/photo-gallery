import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { SignatureV4 } from "@smithy/signature-v4";

// 署名時に実際に見えているヘッダを覗く
const origPresign = SignatureV4.prototype.presign;
SignatureV4.prototype.presign = async function (req, opts) {
  console.log("   headers at presign:", JSON.stringify(req.headers));
  console.log("   opts.signableHeaders:", opts?.signableHeaders && [...opts.signableHeaders], "unsignable:", opts?.unsignableHeaders && [...opts.unsignableHeaders]);
  return origPresign.call(this, req, opts);
};

const client = new S3Client({
  region: "ap-northeast-1",
  credentials: { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
});

async function show(label, cmdInput, opts) {
  console.log("---", label);
  const url = await getSignedUrl(client, new PutObjectCommand(cmdInput), opts);
  const u = new URL(url);
  console.log("   SignedHeaders:", u.searchParams.get("X-Amz-SignedHeaders"));
}

await show("ContentType image/jpeg", { Bucket: "b", Key: "k.jpg", ContentType: "image/jpeg", CacheControl: "max-age=31536000" }, { expiresIn: 900, signableHeaders: new Set(["content-type"]) });
await show("ContentType ''", { Bucket: "b", Key: "k.jpg", ContentType: "", CacheControl: "max-age=31536000" }, { expiresIn: 900, signableHeaders: new Set(["content-type"]) });
await show("ContentType undefined", { Bucket: "b", Key: "k.jpg", CacheControl: "max-age=31536000" }, { expiresIn: 900, signableHeaders: new Set(["content-type"]) });
await show("ContentType image/heic", { Bucket: "b", Key: "k.heic", ContentType: "image/heic", CacheControl: "max-age=31536000" }, { expiresIn: 900, signableHeaders: new Set(["content-type"]) });
