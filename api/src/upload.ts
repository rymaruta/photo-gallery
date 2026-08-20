import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { putPhoto } from "./ddb-photos";
import { requireAdmin, getCallerUserId } from "./auth";
import type { Photo } from "./types";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
const UPLOAD_BUCKET = process.env.UPLOAD_BUCKET!;
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL ?? "";
const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * 受け付ける画像の MIME タイプ → 拡張子。
 * api-user/src/uploadPolicy.ts の同名の表と揃えること（別パッケージなので共有できない）。
 * SVG を外すのが目的。SVG は <script> を書ける実行可能な文書で、
 * 配信は写真と同じ CloudFront ディストリビューション（＝サイトと同一オリジン）。
 */
const ALLOWED_IMAGE_TYPES = new Map([
    ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"],
    ["image/avif", "avif"], ["image/gif", "gif"], ["image/heic", "heic"], ["image/heif", "heif"],
]);

// 撮影地座標の検証と丸め。プライバシーのため約1km精度（小数第2位）に丸めて保存する
export function sanitizeCoords(coords: unknown): { lat: number; lng: number } | null {
    if (!coords || typeof coords !== "object") return null;
    const { lat, lng } = coords as { lat?: unknown; lng?: unknown };
    if (typeof lat !== "number" || typeof lng !== "number") return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}

export const presignedUrl: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const authError = requireAdmin(event);
    if (authError) return authError;

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
    // 許可リストで判定する。"image/" で始まるかどうかだけだと image/svg+xml が通り、
    // presigned PUT がその Content-Type をオブジェクトに焼き付けるので、
    // サイトと同じ CloudFront から「実行できる文書」が返る。
    // 拡張子もファイル名ではなく種別から決める（api-user/src/uploadPolicy.ts と対）。
    const ext = ALLOWED_IMAGE_TYPES.get(fileType.split(";")[0].trim().toLowerCase());
    if (!ext) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "対応していない形式です（JPEG・PNG・WebP・AVIF・HEIC・GIF）" }) };
    }

    const photoId = uuidv4();
    const key = `uploads/${photoId}.${ext}`;

    const presigned = await getSignedUrl(
        s3,
        new PutObjectCommand({
            Bucket: UPLOAD_BUCKET,
            Key: key,
            ContentType: fileType.split(";")[0].trim().toLowerCase(),
            CacheControl: "max-age=31536000",
        }),
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
    const authError = requireAdmin(event);
    if (authError) return authError;
    const uploaderId = getCallerUserId(event);

    // photoId は受け取らない。ID をリクエストで指定できると、既存の写真や
    // 通知・コメントの文書を同じIDで丸ごと置き換えられる（api-user 側は
    // 同じ理由で既にサーバー採番にしてある）。
    let body: {
        key?: string;
        publicUrl?: string;
        title?: Photo["title"];
        description?: Photo["description"];
        location?: string;
        category?: string;
        tags?: string[];
        exif?: Photo["exif"];
        coords?: unknown;
    };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const { key, publicUrl, title, description, location, category, tags, exif, coords } = body;
    if (!key || !publicUrl) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "ファイル情報が必要です" }) };
    }

    const safeCoords = sanitizeCoords(coords);
    const photo: Photo = {
        id: uuidv4(),
        src: publicUrl,
        title: title ?? { ja: "無題", en: "Untitled" },
        ...(description ? { description } : {}),
        ...(location ? { location } : {}),
        ...(category ? { category } : {}),
        tags: Array.isArray(tags) ? tags : [],
        ...(exif && Object.keys(exif).length > 0 ? { exif } : {}),
        ...(safeCoords ? { coords: safeCoords } : {}),
        displayName: "丸田 竜平",
        userId: uploaderId,
        uploadedBy: uploaderId,
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
