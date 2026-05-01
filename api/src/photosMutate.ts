import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getPhotoById, updatePhotoFields, deletePhotoById } from "./ddb-photos";
import { isAdmin, getCallerUserId } from "./auth";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
const UPLOAD_BUCKET = process.env.UPLOAD_BUCKET!;
const JSON_HEADERS = { "Content-Type": "application/json" };

export const updatePhoto: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
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
        const photo = await getPhotoById(id);
        if (!photo) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
        }

        const callerId = getCallerUserId(event);
        const ownerId = (photo.userId ?? photo.uploadedBy) as string | undefined;
        if (!isAdmin(event) && ownerId !== callerId) {
            return { statusCode: 403, headers: JSON_HEADERS, body: JSON.stringify({ error: "編集権限がありません" }) };
        }

        const updates = { ...body, updatedAt: new Date().toISOString() };
        const updated = await updatePhotoFields(id, updates);
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true, photo: updated }) };
    } catch (e) {
        console.error("updatePhoto error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "更新に失敗しました" }) };
    }
};

export const deletePhoto: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const id = event.pathParameters?.id;
    if (!id) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "IDが必要です" }) };
    }

    try {
        const photo = await getPhotoById(id);
        if (!photo) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
        }

        const callerId = getCallerUserId(event);
        const ownerId = (photo.userId ?? photo.uploadedBy) as string | undefined;
        if (!isAdmin(event) && ownerId !== callerId) {
            return { statusCode: 403, headers: JSON_HEADERS, body: JSON.stringify({ error: "削除権限がありません" }) };
        }

        // S3 から画像ファイルを削除
        if (photo.src && typeof photo.src === "string" && photo.src.startsWith("http")) {
            try {
                const url = new URL(photo.src);
                const key = url.pathname.substring(1);
                await s3.send(new DeleteObjectCommand({ Bucket: UPLOAD_BUCKET, Key: key }));
            } catch (s3Err) {
                console.error("S3 delete error:", s3Err);
                return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "S3からの削除に失敗しました" }) };
            }
        }

        await deletePhotoById(id);
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true }) };
    } catch (e) {
        console.error("deletePhoto error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "削除に失敗しました" }) };
    }
};
