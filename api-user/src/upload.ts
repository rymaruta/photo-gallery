import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { putPhoto, countUserPhotos } from "./ddb-photos";
import { checkGoFulfillment } from "./go";
import type { Photo } from "./types";
import { JSON_HEADERS, getUserId, isAdmin } from "./http";
import { sanitizeExif, sanitizeCoords, sanitizeBlurDataURL } from "./sanitize";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
const UPLOAD_BUCKET = process.env.UPLOAD_BUCKET!;
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL ?? "";

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
    };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const { key, publicUrl, photoId, title, description, location, category, tags, exif, displayName, coords, dominantColor, thumbUrl, blurDataURL } = body;
    // 下書き保存: published === false のときだけ非公開。既定（未指定/true）は従来通り公開。
    const isPublished = body.published !== false;
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

    const photo: Photo = {
        id: photoId ?? uuidv4(),
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
        ...(resolvedDisplayName ? { displayName: resolvedDisplayName } : {}),
        userId,
        uploadedBy: userId,
        published: isPublished,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    try {
        await putPhoto(photo);
        // 「行った」成立判定: 行きたいリストの場所に到達していれば、
        // 元写真の投稿者へ「あなたの写真が旅立たせました」通知が飛ぶ。
        // 下書き（非公開）では通知を出さない（公開時に改めて判定される）。
        let inspired = 0;
        if (isPublished) {
            try {
                inspired = await checkGoFulfillment(userId, photo, resolvedDisplayName);
            } catch (err) {
                console.error("checkGoFulfillment error:", err);
            }
        }
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true, photo, inspired }) };
    } catch (e) {
        console.error("savePhoto error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "保存に失敗しました" }) };
    }
};
