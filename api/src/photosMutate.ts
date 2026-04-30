import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { loadPhotos, savePhotos } from "./s3";
import { requireAdmin } from "./auth";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
const UPLOAD_BUCKET = process.env.UPLOAD_BUCKET!;
const JSON_HEADERS = { "Content-Type": "application/json" };

export const updatePhoto: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const authError = requireAdmin(event);
    if (authError) return authError;

    const id = event.pathParameters?.id;
    if (!id) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "IDが必要です" }) };
    }

    let body: Record<string, unknown>;
    try {
        body = JSON.parse(event.body ?? "{}") as Record<string, unknown>;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    try {
        const photos = await loadPhotos();
        const idx = photos.findIndex((p) => p.id === id);
        if (idx === -1) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
        }

        const updated = { ...photos[idx], ...body, updatedAt: new Date().toISOString() };
        photos[idx] = updated;
        await savePhotos(photos);

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true, photo: updated }) };
    } catch (e) {
        console.error("updatePhoto error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "更新に失敗しました" }) };
    }
};

export const deletePhoto: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const authError = requireAdmin(event);
    if (authError) return authError;

    const id = event.pathParameters?.id;
    if (!id) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "IDが必要です" }) };
    }

    try {
        const photos = await loadPhotos();
        const photo = photos.find((p) => p.id === id);
        if (!photo) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
        }

        // S3 から画像ファイルを削除
        if (photo.src && typeof photo.src === "string" && photo.src.startsWith("http")) {
            try {
                const url = new URL(photo.src);
                const key = url.pathname.substring(1); // 先頭の / を除去
                await s3.send(new DeleteObjectCommand({ Bucket: UPLOAD_BUCKET, Key: key }));
            } catch (s3Err) {
                console.error("S3 delete error:", s3Err);
                return {
                    statusCode: 500,
                    headers: JSON_HEADERS,
                    body: JSON.stringify({ error: "S3からの削除に失敗しました" }),
                };
            }
        }

        // photos.json から削除して保存
        await savePhotos(photos.filter((p) => p.id !== id));

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true }) };
    } catch (e) {
        console.error("deletePhoto error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "削除に失敗しました" }) };
    }
};
