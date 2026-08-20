import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
const UPLOAD_BUCKET = process.env.UPLOAD_BUCKET!;
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL ?? "";
import { JSON_HEADERS, getUserId } from "./http";
import { extForType } from "./uploadPolicy";

export const profileAvatarPresignedUrl: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) {
        return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "認証が必要です" }) };
    }

    let body: { fileType?: string; type?: string };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const { fileType, type } = body;
    // 許可リストで判定する。"image/" で始まるかどうかだけだと image/svg+xml が通り、
    // SVG の中の <script> がサイトと同じオリジンで実行される（配信は同じ
    // CloudFront ディストリビューション）。しかもアイコンのキーは
    // profiles/{userId} 固定なので、保存の一手すら要らなかった。
    if (!extForType(fileType, false)) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "対応していない形式です（JPEG・PNG・WebP・AVIF・HEIC・GIF）" }) };
    }
    const safeContentType = String(fileType).split(";")[0].trim().toLowerCase();

    // type: "cover" → profiles/{userId}/cover, それ以外 → profiles/{userId}
    const key = type === "cover" ? `profiles/${userId}/cover` : `profiles/${userId}`;

    const presigned = await getSignedUrl(
        s3,
        new PutObjectCommand({
            Bucket: UPLOAD_BUCKET,
            Key: key,
            // クライアントの文字列そのままではなく、許可済みの種別を焼き付ける
            ContentType: safeContentType,
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
