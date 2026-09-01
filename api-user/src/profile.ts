import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { JSON_HEADERS, getUserId } from "./http";
import { extForType } from "./uploadPolicy";
import { requireEnv } from "./env";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
// `process.env.UPLOAD_BUCKET!` だった。`!` は型を黙らせるだけで、未設定なら
// `Bucket: undefined` のまま署名を作りにいく——落ちるのは利用者が PUT した
// あとで、原因も分からない。他のファイルと同じく起動時に止める。
const UPLOAD_BUCKET = requireEnv("UPLOAD_BUCKET");
// 末尾スラッシュを詰める。付いたまま渡されると `https://cdn//profiles/<uid>`
// になり、S3 のキーとしては `/profiles/...`（先頭に空の階層）を指す別物になる。
// uploadPolicy.ts の canonicalUploadUrl が同じ理由で同じことをしている。
const CLOUDFRONT_URL = (process.env.CLOUDFRONT_URL ?? "").replace(/\/$/, "");

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

    // 署名は落ちうる（資格情報の期限切れ・KMS・S3 の一時障害）。囲っていない頃は
    // Lambda が投げ、API Gateway が **JSON ではない 502 の素の body** を返していた。
    // 呼び出し側は res.json() で落ちるので、画面には何も出ない。
    let presigned: string;
    try {
        presigned = await getSignedUrl(
            s3,
            new PutObjectCommand({
                Bucket: UPLOAD_BUCKET,
                Key: key,
                // クライアントの文字列そのままではなく、許可済みの種別を焼き付ける
                // （**署名対象に戻すのは下の `signableHeaders`**）
                ContentType: safeContentType,
                // 注意: cache-control は SigV4 の ALWAYS_UNSIGNABLE_HEADERS に入っており、
                // presigned URL では効かない（S3 にはクライアントが送った値だけが載る）。
                // ここは意図の記録で、実際に効かせているのはアップロード側が
                // PUT に付ける Cache-Control: no-store。アイコンは profiles/{userId} という
                // ハッシュの付かない固定キーなので、キャッシュさせると変更が反映されない。
                CacheControl: "no-store",
            }),
            {
                expiresIn: 900,
                // **Content-Type を署名対象に戻す**（presigner が既定で外す）。
                // 詳しい理由は upload.ts の同じ指定にある——外れたままだと、
                // 許可済みの種別で presign を取って `text/html` で PUT でき、
                // サイトと同一オリジンで任意のスクリプトが動く。
                signableHeaders: new Set(["content-type"]),
            },
        );
    } catch (e) {
        console.error("profileAvatarPresignedUrl: getSignedUrl failed:", e);
        return { statusCode: 503, headers: JSON_HEADERS, body: JSON.stringify({ error: "アップロードの準備に失敗しました。しばらくしてからお試しください" }) };
    }

    const publicUrl = CLOUDFRONT_URL
        ? `${CLOUDFRONT_URL}/${key}`
        : `https://${UPLOAD_BUCKET}.s3.${process.env.AWS_REGION ?? "ap-northeast-1"}.amazonaws.com/${key}`;

    return {
        statusCode: 200,
        headers: JSON_HEADERS,
        // 署名した種別をそのまま返す（理由は upload.ts の同じ箇所）
        body: JSON.stringify({ presignedUrl: presigned, publicUrl, contentType: safeContentType }),
    };
};
