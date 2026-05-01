import type { APIGatewayProxyHandlerV2, APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand, PutCommand, UpdateCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, USERS_TABLE, USERNAME_INDEX } from "./dynamodb";
import type { User } from "./types";

const JSON_HEADERS = { "Content-Type": "application/json" };
const PUBLIC_HEADERS = { ...JSON_HEADERS, "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" };

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const RESERVED_USERNAMES = new Set([
    "admin", "root", "api", "users", "user", "login", "logout", "signup", "signin",
    "about", "favorites", "history", "photo", "photos", "upload", "settings", "me", "you",
]);

function getCallerSub(event: Parameters<APIGatewayProxyHandlerV2WithJWTAuthorizer>[0]): string {
    return String(event.requestContext.authorizer.jwt.claims.sub ?? "");
}

function isAdmin(event: Parameters<APIGatewayProxyHandlerV2WithJWTAuthorizer>[0]): boolean {
    const groups = event.requestContext.authorizer.jwt.claims["cognito:groups"];
    if (!groups) return false;
    const list = Array.isArray(groups) ? groups : String(groups).split(",").map((g) => g.trim());
    return list.includes("admin");
}

async function getUserByUsername(username: string): Promise<User | null> {
    const r = await ddb.send(new QueryCommand({
        TableName: USERS_TABLE,
        IndexName: USERNAME_INDEX,
        KeyConditionExpression: "username = :u",
        ExpressionAttributeValues: { ":u": username },
        Limit: 1,
    }));
    return (r.Items?.[0] as User | undefined) ?? null;
}

async function getUserById(userId: string): Promise<User | null> {
    const r = await ddb.send(new GetCommand({ TableName: USERS_TABLE, Key: { userId } }));
    return (r.Item as User | undefined) ?? null;
}

// GET /users/{username} - 公開プロフィール取得
export const getUserPublic: APIGatewayProxyHandlerV2 = async (event) => {
    const username = event.pathParameters?.username;
    if (!username) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "ユーザー名が必要です" }) };
    }
    try {
        const user = await getUserByUsername(username.toLowerCase());
        if (!user) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "ユーザーが見つかりません" }) };
        }
        // 公開情報のみ返す（emailは隠す）
        const { email: _email, ...publicUser } = user;
        void _email;
        return { statusCode: 200, headers: PUBLIC_HEADERS, body: JSON.stringify(publicUser) };
    } catch (e) {
        console.error("getUserPublic error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "取得に失敗しました" }) };
    }
};

// GET /users/me - 自分のプロフィール取得（認証必要）
export const getMe: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const sub = getCallerSub(event);
    if (!sub) {
        return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "認証が必要です" }) };
    }
    try {
        const user = await getUserById(sub);
        if (!user) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "プロフィール未作成" }) };
        }
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(user) };
    } catch (e) {
        console.error("getMe error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "取得に失敗しました" }) };
    }
};

// POST /users - プロフィール新規作成（confirmSignUp 後に呼ぶ）
export const createUser: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const sub = getCallerSub(event);
    const email = String(event.requestContext.authorizer.jwt.claims.email ?? "");
    if (!sub) {
        return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "認証が必要です" }) };
    }

    let body: { username?: string; displayName?: string; bio?: string };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const username = (body.username ?? "").trim().toLowerCase();
    const displayName = (body.displayName ?? "").trim();
    const bio = (body.bio ?? "").trim();

    if (!USERNAME_RE.test(username)) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "usernameは3-20文字の半角英数字とアンダースコアで入力してください" }) };
    }
    if (RESERVED_USERNAMES.has(username)) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "このusernameは使用できません" }) };
    }
    if (displayName.length === 0 || displayName.length > 50) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "表示名は1-50文字で入力してください" }) };
    }
    if (bio.length > 160) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "自己紹介は160文字以内で入力してください" }) };
    }

    try {
        // 既存チェック
        if (await getUserById(sub)) {
            return { statusCode: 409, headers: JSON_HEADERS, body: JSON.stringify({ error: "プロフィールは既に作成されています" }) };
        }
        if (await getUserByUsername(username)) {
            return { statusCode: 409, headers: JSON_HEADERS, body: JSON.stringify({ error: "このusernameは既に使われています" }) };
        }

        const now = new Date().toISOString();
        const user: User = {
            userId: sub, username, displayName, email, bio,
            role: "user", createdAt: now, updatedAt: now,
        };
        await ddb.send(new PutCommand({
            TableName: USERS_TABLE,
            Item: user,
            ConditionExpression: "attribute_not_exists(userId)",
        }));
        return { statusCode: 201, headers: JSON_HEADERS, body: JSON.stringify(user) };
    } catch (e) {
        console.error("createUser error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "作成に失敗しました" }) };
    }
};

// PUT /users/me - プロフィール編集
export const updateMe: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const sub = getCallerSub(event);
    if (!sub) {
        return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "認証が必要です" }) };
    }

    let body: { displayName?: string; bio?: string; avatarKey?: string };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const updates: Record<string, unknown> = {};
    if (body.displayName !== undefined) {
        const dn = body.displayName.trim();
        if (dn.length === 0 || dn.length > 50) {
            return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "表示名は1-50文字で入力してください" }) };
        }
        updates.displayName = dn;
    }
    if (body.bio !== undefined) {
        if (body.bio.length > 160) {
            return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "自己紹介は160文字以内で入力してください" }) };
        }
        updates.bio = body.bio;
    }
    if (body.avatarKey !== undefined) {
        updates.avatarKey = body.avatarKey;
    }
    if (Object.keys(updates).length === 0) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "更新項目がありません" }) };
    }
    updates.updatedAt = new Date().toISOString();

    try {
        const setExprs = Object.keys(updates).map((k) => `#${k} = :${k}`).join(", ");
        const exprAttrNames: Record<string, string> = {};
        const exprAttrValues: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(updates)) {
            exprAttrNames[`#${k}`] = k;
            exprAttrValues[`:${k}`] = v;
        }
        const r = await ddb.send(new UpdateCommand({
            TableName: USERS_TABLE,
            Key: { userId: sub },
            UpdateExpression: `SET ${setExprs}`,
            ExpressionAttributeNames: exprAttrNames,
            ExpressionAttributeValues: exprAttrValues,
            ConditionExpression: "attribute_exists(userId)",
            ReturnValues: "ALL_NEW",
        }));
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(r.Attributes) };
    } catch (e) {
        const name = (e as { name?: string }).name;
        if (name === "ConditionalCheckFailedException") {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "プロフィールが見つかりません" }) };
        }
        console.error("updateMe error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "更新に失敗しました" }) };
    }
};

// 内部使用: API/Lambda経由で呼び出されるユーティリティを公開
// (isAdmin/getUserById をエクスポートして他ハンドラから利用可能にする)
export { getUserById, getUserByUsername, isAdmin };
