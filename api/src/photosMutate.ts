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

        // S3 から画像ファイルを削除（失敗してもDynamoDBレコードは削除する）。
        // 本体だけでなく派生画像も消す。特に srcOriginal は EXIF を落とす前の原本で
        // GPS が入ったままなので、消し残すと削除後も公開URLで取得できてしまう。
        const mediaFields = [
            "src", "srcOriginal", "srcAvif", "src256",
            "thumbSrc", "thumbSm", "thumbAvif", "thumbSmAvif",
        ] as const;
        const keys = new Set<string>();
        for (const field of mediaFields) {
            const v = (photo as Record<string, unknown>)[field];
            if (typeof v !== "string" || !v.startsWith("http")) continue;
            try {
                const key = new URL(v).pathname.substring(1);
                // 消してよいのはアップロード領域だけ。src は過去に検証なしで保存された
                // ものがあり、そのままキーにすると他人のアイコン（profiles/...）まで
                // 消せてしまう。
                if (key.startsWith("uploads/")) keys.add(key);
                else console.warn(`deletePhoto: skip S3 delete for unexpected key ${key}`);
            } catch { /* URL でなければ無視 */ }
        }
        for (const key of keys) {
            try {
                await s3.send(new DeleteObjectCommand({ Bucket: UPLOAD_BUCKET, Key: key }));
            } catch (s3Err) {
                console.error("S3 delete error (non-fatal):", s3Err);
            }
        }

        await deletePhotoById(id);
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true }) };
    } catch (e) {
        console.error("deletePhoto error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "削除に失敗しました" }) };
    }
};
