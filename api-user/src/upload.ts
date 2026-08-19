import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { putPhoto, countUserPhotos } from "./ddb-photos";
import type { Photo } from "./types";
import { JSON_HEADERS, getUserId, isAdmin } from "./http";
import { sanitizeExif, sanitizeCoords, sanitizeBlurDataURL, sanitizeDate } from "./sanitize";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
const UPLOAD_BUCKET = process.env.UPLOAD_BUCKET!;
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL ?? "";

/**
 * 自分のアップロード領域（uploads/ 配下）を指すURLかどうか。
 * 配信ドメインが設定されていればホストも照合する。
 * 保存された src は削除時にそのまま S3 のキーになるため、ここが最後の砦になる。
 */
export function isOwnUploadUrl(raw: unknown): boolean {
    if (typeof raw !== "string" || !raw) return false;
    let u: URL;
    try {
        u = new URL(raw);
    } catch {
        return false;
    }
    if (u.protocol !== "https:") return false;
    if (!u.pathname.startsWith("/uploads/")) return false;
    // 配信ドメインの照合。CLOUDFRONT_URL は serverless.yml で既定値が入るので
    // デプロイ環境では必ず設定されている。未設定なら「検証できない」ので通さない
    // （安全側に倒す。ここは他人のファイルを消せるかどうかを分ける境界）。
    try {
        if (u.host !== new URL(CLOUDFRONT_URL).host) return false;
    } catch {
        return false;
    }
    return true;
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
    // 画像に加えて動画も許可（ストーリー用。mp4 / webm / QuickTime）
    const ALLOWED_VIDEO = new Set(["video/mp4", "video/webm", "video/quicktime"]);
    if (!fileType.startsWith("image/") && !ALLOWED_VIDEO.has(fileType)) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "画像または動画ファイルを選択してください" }) };
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
        displayName?: string;
        coords?: unknown;
        dominantColor?: string;
        thumbUrl?: string;
        published?: boolean;
        blurDataURL?: string;
        date?: unknown;
    };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const { key, publicUrl, title, description, location, category, tags, exif, displayName, coords, dominantColor, thumbUrl, blurDataURL } = body;
    // 下書き保存: published === false のときだけ非公開。既定（未指定/true）は従来通り公開。
    const isPublished = body.published !== false;
    if (!key || !publicUrl) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "ファイル情報が必要です" }) };
    }
    // アップロード領域を指すURLだけを受け付ける。
    //
    // ここを検証しないと、他人のアイコン（profiles/<相手のID>）のURLを保存させたうえで
    // 自分のその写真を削除でき、相手のファイルを S3 から消せてしまう
    // （削除は保存された src のパスをそのまま S3 のキーとして使うため）。
    //
    // key は保存されず削除にも使われないので、要になるのは publicUrl の方。
    // CLOUDFRONT_URL が未設定の環境でも効くよう、パスは常に検証する。
    if (!isOwnUploadUrl(publicUrl)) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正な画像URLです" }) };
    }
    if (!String(key).startsWith("uploads/")) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なキーです" }) };
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

    const resolvedDisplayName = (displayName?.trim() ?? "").slice(0, 100) || undefined;
    const safeCoords = sanitizeCoords(coords);
    // 代表色: グリッドのプレースホルダー用。#rrggbb 形式のみ受け付ける
    const safeDominantColor = typeof dominantColor === "string" && /^#[0-9a-fA-F]{6}$/.test(dominantColor)
        ? dominantColor.toLowerCase()
        : undefined;
    // サムネイルURL: 一覧グリッド配信用の軽量版（publicUrl と同じ信頼レベル）。https のみ
    const safeThumbSrc = typeof thumbUrl === "string" && thumbUrl.startsWith("https://") && thumbUrl.length <= 500
        ? thumbUrl
        : undefined;
    // ぼかしプレビュー（data:image/webp;base64,...）: 画像 data URI のみ許可
    const safeBlurDataURL = sanitizeBlurDataURL(blurDataURL);
    // 撮影日（EXIF 由来）。年表を「撮った順」で並べるために保存する。
    const safeDate = sanitizeDate(body.date);

    const photo: Photo = {
        // ID は必ずサーバーで採番する。リクエストから受け取ると、他人の写真IDを
        // 指定して丸ごと上書きできてしまう（通知やコメントの文書も同じテーブルにある）。
        // 既存写真の更新は photoUpdate.ts が担当する。
        id: uuidv4(),
        src: publicUrl,
        title: title ?? { ja: "無題", en: "Untitled" },
        ...(description ? { description } : {}),
        ...(location ? { location } : {}),
        ...(category ? { category } : {}),
        tags: Array.isArray(tags) ? tags : [],
        ...(() => { const safeExif = sanitizeExif(exif); return safeExif ? { exif: safeExif } : {}; })(),
        ...(safeCoords ? { coords: safeCoords } : {}),
        ...(safeDominantColor ? { dominantColor: safeDominantColor } : {}),
        ...(safeThumbSrc ? { thumbSrc: safeThumbSrc } : {}),
        ...(safeBlurDataURL ? { blurDataURL: safeBlurDataURL } : {}),
        ...(safeDate ? { date: safeDate } : {}),
        ...(resolvedDisplayName ? { displayName: resolvedDisplayName } : {}),
        userId,
        uploadedBy: userId,
        published: isPublished,
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
