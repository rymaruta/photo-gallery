import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { putPhoto, countUserPhotos } from "./ddb-photos";
import type { Photo } from "./types";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
const UPLOAD_BUCKET = process.env.UPLOAD_BUCKET!;
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL ?? "";
const JSON_HEADERS = { "Content-Type": "application/json" };

function getUserId(event: Parameters<APIGatewayProxyHandlerV2WithJWTAuthorizer>[0]): string {
    return String(event.requestContext.authorizer.jwt.claims.sub ?? "unknown");
}

function isAdmin(event: Parameters<APIGatewayProxyHandlerV2WithJWTAuthorizer>[0]): boolean {
    const groups = event.requestContext.authorizer.jwt.claims["cognito:groups"];
    if (!groups) return false;
    let list: string[];
    if (Array.isArray(groups)) {
        list = groups as string[];
    } else {
        const str = String(groups).trim();
        if (str.startsWith("[")) {
            try { list = JSON.parse(str) as string[]; } catch { list = [str]; }
        } else {
            list = str.split(",").map((g) => g.trim());
        }
    }
    return list.includes("admin");
}

const PHOTO_LIMIT_PER_USER = 100;

export const presignedUrl: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);

    // 100枚制限チェック（adminは除外）
    if (!isAdmin(event)) {
        try {
            const count = await countUserPhotos(userId);
            if (count >= PHOTO_LIMIT_PER_USER) {
                return {
                    statusCode: 403,
                    headers: JSON_HEADERS,
                    body: JSON.stringify({ error: `アップロード上限（${PHOTO_LIMIT_PER_USER}枚）に達しています` }),
                };
            }
        } catch (e) {
            console.error("photo count check error:", e);
        }
    }

    let body: { fileName?: string; fileType?: string; fileSize?: number };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const { fileName, fileType, fileSize } = body;
    if (!fileName || !fileType) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "ファイル名とファイルタイプが必要です" }) };
    }
    if (fileSize && fileSize > 50 * 1024 * 1024) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "ファイルサイズが大きすぎます（最大50MB）" }) };
    }
    if (!fileType.startsWith("image/")) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "画像ファイルを選択してください" }) };
    }

    const photoId = uuidv4();
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "jpg";
    const key = `uploads/${photoId}.${ext}`;

    const presigned = await getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: UPLOAD_BUCKET, Key: key, ContentType: fileType, CacheControl: "max-age=31536000" }),
        { expiresIn: 900 }
    );

    const publicUrl = CLOUDFRONT_URL
        ? `${CLOUDFRONT_URL}/${key}`
        : `https://${UPLOAD_BUCKET}.s3.${process.env.AWS_REGION ?? "ap-northeast-1"}.amazonaws.com/${key}`;

    return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ presignedUrl: presigned, key, publicUrl, photoId }),
    };
};

export const savePhoto: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);

    let body: {
        key?: string;
        publicUrl?: string;
        photoId?: string;
        title?: Photo["title"];
        description?: Photo["description"];
        location?: string;
        category?: string;
        tags?: string[];
        exif?: Photo["exif"];
    };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const { key, publicUrl, photoId, title, description, location, category, tags, exif } = body;
    if (!key || !publicUrl) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "ファイル情報が必要です" }) };
    }

    // 100枚制限の二重チェック（adminは除外）
    if (!isAdmin(event)) {
        try {
            const count = await countUserPhotos(userId);
            if (count >= PHOTO_LIMIT_PER_USER) {
                return {
                    statusCode: 403,
                    headers: JSON_HEADERS,
                    body: JSON.stringify({ error: `アップロード上限（${PHOTO_LIMIT_PER_USER}枚）に達しています` }),
                };
            }
        } catch (e) {
            console.error("photo count check error:", e);
        }
    }

    const photo: Photo = {
        id: photoId ?? uuidv4(),
        src: publicUrl,
        title: title ?? { ja: "無題", en: "Untitled" },
        ...(description ? { description } : {}),
        ...(location ? { location } : {}),
        ...(category ? { category } : {}),
        tags: Array.isArray(tags) ? tags : [],
        ...(exif && Object.keys(exif).length > 0 ? { exif } : {}),
        userId,
        uploadedBy: userId,
        published: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    try {
        await putPhoto(photo);
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true, photo }) };
    } catch (e) {
        console.error("savePhoto error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "保存に失敗しました" }) };
    }
};
