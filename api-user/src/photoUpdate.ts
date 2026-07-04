import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId } from "./http";

export const updatePhotoVisibility: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const id = event.pathParameters?.id;
    if (!id) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "IDが必要です" }) };
    }

    let body: { published?: boolean };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    if (typeof body.published !== "boolean") {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "publishedはboolean必須" }) };
    }

    try {
        // 所有権チェック
        const existing = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id } }));
        if (!existing.Item) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "写真が見つかりません" }) };
        }
        const callerId = getUserId(event);
        const ownerId = (existing.Item.userId ?? existing.Item.uploadedBy) as string | undefined;
        if (!ownerId || ownerId !== callerId) {
            return { statusCode: 403, headers: JSON_HEADERS, body: JSON.stringify({ error: "権限がありません" }) };
        }

        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id },
            UpdateExpression: "SET published = :p, updatedAt = :t",
            ExpressionAttributeValues: { ":p": body.published, ":t": new Date().toISOString() },
        }));
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true }) };
    } catch (e) {
        console.error("updatePhotoVisibility error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "更新に失敗しました" }) };
    }
};
