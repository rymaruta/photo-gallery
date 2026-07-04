import type { APIGatewayProxyHandlerV2, APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { ScanCommand, PutCommand, GetCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { ddb, PHOTOS_TABLE } from "./dynamodb";

const JSON_HEADERS = { "Content-Type": "application/json" };
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL ?? "";
const UPLOAD_BUCKET = process.env.UPLOAD_BUCKET ?? "";
const STORY_TTL_MS = 24 * 60 * 60 * 1000; // 24時間

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

function getUserId(event: Parameters<APIGatewayProxyHandlerV2WithJWTAuthorizer>[0]): string {
    return String(event.requestContext.authorizer.jwt.claims.sub ?? "");
}

async function scanStories(filter: "active" | "expired"): Promise<Record<string, unknown>[]> {
    const now = new Date().toISOString();
    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
        const res = await ddb.send(new ScanCommand({
            TableName: PHOTOS_TABLE,
            FilterExpression: filter === "active" ? "story = :t AND expiresAt > :now" : "story = :t AND expiresAt <= :now",
            ExpressionAttributeValues: { ":t": true, ":now": now },
            ExclusiveStartKey: lastKey,
        }));
        items.push(...((res.Items ?? []) as Record<string, unknown>[]));
        lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return items;
}

// GET /stories — 有効期限内のストーリー一覧（公開・認証不要）
// viewers（閲覧者情報）は本人しか見られないため、公開レスポンスからは除外する。
export const getStories: APIGatewayProxyHandlerV2 = async () => {
    try {
        const items = await scanStories("active");
        for (const item of items) {
            delete item.viewers;
        }
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

// POST /stories — ストーリー投稿（認証必要）。
// 画像/動画は既存の presigned-url フローでアップロード済みであることを前提にレコードだけ作成する。
export const createStory: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) {
        return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "認証が必要です" }) };
    }

    let body: { publicUrl?: string; key?: string; displayName?: string; caption?: string; mediaType?: string };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const publicUrl = (body.publicUrl ?? "").trim();
    if (!publicUrl) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "画像URLが必要です" }) };
    }
    // 自サイトの配信ドメイン以外のURLは受け付けない
    if (CLOUDFRONT_URL && !publicUrl.startsWith(`${CLOUDFRONT_URL}/`)) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正な画像URLです" }) };
    }

    const key = (body.key ?? "").trim();
    if (key && !key.startsWith("uploads/")) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なキーです" }) };
    }

    const mediaType = body.mediaType === "video" ? "video" : "image";
    const caption = (body.caption ?? "").trim().slice(0, 200) || undefined;
    const displayName = (body.displayName ?? "").trim().slice(0, 100) || undefined;

    const now = Date.now();
    const story = {
        id: `story-${randomUUID()}`,
        story: true,
        published: false, // ギャラリー・photos.json から除外するため
        src: publicUrl,
        ...(key ? { key } : {}), // 期限切れ削除時に S3 オブジェクトを消すために保持
        mediaType,
        ...(caption ? { caption } : {}),
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

// POST /stories/{id}/view — 閲覧記録（認証必要・投稿者本人の閲覧は記録しない）
export const viewStory: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const viewerId = getUserId(event);
    const storyId = event.pathParameters?.id;
    if (!viewerId || !storyId) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    let body: { displayName?: string };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        body = {};
    }
    const displayName = (body.displayName ?? "").trim().slice(0, 100) || undefined;

    try {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: storyId } }));
        const item = res.Item as Record<string, unknown> | undefined;
        if (!item || item.story !== true) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "ストーリーが見つかりません" }) };
        }
        if (item.userId === viewerId) {
            return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true, self: true }) };
        }

        // viewers マップが無ければ作ってから、閲覧者エントリを追加（初回閲覧時刻を保持）
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: storyId },
            UpdateExpression: "SET viewers = if_not_exists(viewers, :empty)",
            ExpressionAttributeValues: { ":empty": {} },
        }));
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: storyId },
            UpdateExpression: "SET viewers.#uid = if_not_exists(viewers.#uid, :v)",
            ExpressionAttributeNames: { "#uid": viewerId },
            ExpressionAttributeValues: {
                ":v": { ...(displayName ? { displayName } : {}), at: new Date().toISOString() },
            },
        }));
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true }) };
    } catch (e) {
        console.error("viewStory error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "記録に失敗しました" }) };
    }
};

// GET /stories/{id}/viewers — 閲覧者リスト（投稿者本人のみ）
export const getStoryViewers: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const callerId = getUserId(event);
    const storyId = event.pathParameters?.id;
    if (!callerId || !storyId) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    try {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: storyId } }));
        const item = res.Item as Record<string, unknown> | undefined;
        if (!item || item.story !== true) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "ストーリーが見つかりません" }) };
        }
        if (item.userId !== callerId) {
            return { statusCode: 403, headers: JSON_HEADERS, body: JSON.stringify({ error: "権限がありません" }) };
        }

        const viewersMap = (item.viewers ?? {}) as Record<string, { displayName?: string; at?: string }>;
        const viewers = Object.entries(viewersMap)
            .map(([userId, v]) => ({ userId, displayName: v?.displayName, at: v?.at }))
            .sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ viewers, count: viewers.length }) };
    } catch (e) {
        console.error("getStoryViewers error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "取得に失敗しました" }) };
    }
};

// 期限切れストーリーの物理削除（毎日スケジュール実行）
// DynamoDB のレコードと S3 の画像/動画本体の両方を削除する。
export const cleanupExpiredStories = async (): Promise<{ deleted: number }> => {
    const expired = await scanStories("expired");
    let deleted = 0;

    for (const item of expired) {
        const id = String(item.id ?? "");
        if (!id) continue;

        // S3 オブジェクトの削除（key フィールド優先、無ければ src の URL パスから導出）
        let key = typeof item.key === "string" ? item.key : "";
        if (!key && typeof item.src === "string") {
            try {
                const path = new URL(item.src).pathname.replace(/^\//, "");
                if (path.startsWith("uploads/")) key = path;
            } catch { /* ignore */ }
        }
        if (key && UPLOAD_BUCKET) {
            try {
                await s3.send(new DeleteObjectCommand({ Bucket: UPLOAD_BUCKET, Key: key }));
            } catch (e) {
                console.error(`cleanup: S3 delete failed for ${key}:`, e);
            }
        }

        try {
            await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id } }));
            deleted++;
        } catch (e) {
            console.error(`cleanup: DDB delete failed for ${id}:`, e);
        }
    }

    console.log(`cleanupExpiredStories: deleted ${deleted} of ${expired.length} expired stories`);
    return { deleted };
};
