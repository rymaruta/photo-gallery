import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
const UPLOAD_BUCKET = process.env.UPLOAD_BUCKET!;
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL ?? "";
import { JSON_HEADERS, getUserId } from "./http";

export const profileAvatarPresignedUrl: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);

    let body: { fileType?: string; type?: string };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const { fileType, type } = body;
    if (!fileType || !fileType.startsWith("image/")) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "画像ファイルを選択してください" }) };
    }

    // type: "cover" → profiles/{userId}/cover, それ以外 → profiles/{userId}
    const key = type === "cover" ? `profiles/${userId}/cover` : `profiles/${userId}`;

    const presigned = await getSignedUrl(
        s3,
        new PutObjectCommand({
            Bucket: UPLOAD_BUCKET,
            Key: key,
            ContentType: fileType,
            // 注意: cache-control は SigV4 の ALWAYS_UNSIGNABLE_HEADERS に入っており、
            // presigned URL では効かない（S3 にはクライアントが送った値だけが載る）。
            // ここは意図の記録で、実際に効かせているのはアップロード側が
            // PUT に付ける Cache-Control: no-store。アイコンは profiles/{userId} という
            // ハッシュの付かない固定キーなので、キャッシュさせると変更が反映されない。
            CacheControl: "no-store",
        }),
        { expiresIn: 900 }
    );

    const publicUrl = CLOUDFRONT_URL
        ? `${CLOUDFRONT_URL}/${key}`
        : `https://${UPLOAD_BUCKET}.s3.${process.env.AWS_REGION ?? "ap-northeast-1"}.amazonaws.com/${key}`;

    return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ presignedUrl: presigned, publicUrl }),
    };
};
