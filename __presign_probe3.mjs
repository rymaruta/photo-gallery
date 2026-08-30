import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
const client = new S3Client({ region: "ap-northeast-1", credentials: { accessKeyId: "AKIAEX", secretAccessKey: "s" } });
const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: "b", Key: "uploads/u/x.jpg", ContentType: "image/jpeg", CacheControl: "max-age=31536000" }), { expiresIn: 900, signableHeaders: new Set(["content-type"]) });
console.log(url);
console.log([...new URL(url).searchParams.keys()]);
