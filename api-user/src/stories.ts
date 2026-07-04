import type { APIGatewayProxyHandlerV2, APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { ScanCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import { ddb, PHOTOS_TABLE } from "./dynamodb";

const JSON_HEADERS = { "Content-Type": "application/json" };
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL ?? "";
const STORY_TTL_MS = 24 * 60 * 60 * 1000; // 24時間

function getUserId(event: Parameters<APIGatewayProxyHandlerV2WithJWTAuthorizer>[0]): string {
    return String(event.requestContext.authorizer.jwt.claims.sub ?? "");
}

// GET /stories — 有効期限内のストーリー一覧（公開・認証不要）
// ストーリーは photos テーブルに story=true / published=false で保存されるため、
// ギャラリーや photos.json の同期には現れない。
export const getStories: APIGatewayProxyHandlerV2 = async () => {
    try {
        const now = new Date().toISOString();
        const items: Record<string, unknown>[] = [];
        let lastKey: Record<string, unknown> | undefined;
        do {
            const res = await ddb.send(new ScanCommand({
                TableName: PHOTOS_TABLE,
                FilterExpression: "story = :t AND expiresAt > :now",
                ExpressionAttributeValues: { ":t": true, ":now": now },
                ExclusiveStartKey: lastKey,
            }));
            items.push(...((res.Items ?? []) as Record<string, unknown>[]));
            lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
        } while (lastKey);

        items.sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
        return {
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "public, s-maxage=60" },
            body: JSON.stringify(items),
        };
    } catch (e) {
        console.error("getStories error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "取得に失敗しました" }) };
    }
};

// POST /stories — ストーリー投稿（認証必要）。画像は既存の presigned-url フローで
// アップロード済みであることを前提に、レコードだけ作成する。
export const createStory: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) {
        return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "認証が必要です" }) };
    }

    let body: { publicUrl?: string; displayName?: string };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const publicUrl = (body.publicUrl ?? "").trim();
    if (!publicUrl) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "画像URLが必要です" }) };
    }
    // 自サイトの配信ドメイン以外の画像URLは受け付けない
    if (CLOUDFRONT_URL && !publicUrl.startsWith(`${CLOUDFRONT_URL}/`)) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正な画像URLです" }) };
    }

    const displayName = (body.displayName ?? "").trim().slice(0, 100) || undefined;
    const now = Date.now();
    const story = {
        id: `story-${randomUUID()}`,
        story: true,
        published: false, // ギャラリー・photos.json から除外するため
        src: publicUrl,
        userId,
        ...(displayName ? { displayName } : {}),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + STORY_TTL_MS).toISOString(),
        updatedAt: new Date(now).toISOString(),
    };

    try {
        await ddb.send(new PutCommand({ TableName: PHOTOS_TABLE, Item: story }));
        return { statusCode: 201, headers: JSON_HEADERS, body: JSON.stringify({ success: true, story }) };
    } catch (e) {
        console.error("createStory error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "投稿に失敗しました" }) };
    }
};
