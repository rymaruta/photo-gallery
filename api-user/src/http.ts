import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";

// 全ハンドラで共有する HTTP / 認証まわりのヘルパー

export const JSON_HEADERS = { "Content-Type": "application/json" };

export type AuthedEvent = Parameters<APIGatewayProxyHandlerV2WithJWTAuthorizer>[0];

/** JWT クレームから呼び出しユーザーの Cognito sub を取得する */
export function getUserId(event: AuthedEvent): string {
    return String(event.requestContext.authorizer.jwt.claims.sub ?? "");
}

/**
 * cognito:groups クレームをグループ名の配列に正規化する。
 * API Gateway (HTTP API) の JWT オーソライザーは配列クレームを
 * "[admin user]"（引用符なし・スペース区切り）という JSON として不正な
 * 文字列に変換して渡すため、JSON.parse だけでは読めない。
 */
export function parseGroupsClaim(groups: unknown): string[] {
    if (!groups) return [];
    if (Array.isArray(groups)) return groups.map(String);
    const str = String(groups).trim();
    if (str.startsWith("[")) {
        try {
            const parsed = JSON.parse(str) as unknown;
            if (Array.isArray(parsed)) return parsed.map(String);
        } catch { /* fall through */ }
        return str.replace(/^\[|\]$/g, "").split(/[\s,]+/).filter(Boolean);
    }
    return str.split(",").map((g) => g.trim()).filter(Boolean);
}

/** 呼び出しユーザーが admin グループに属しているか */
export function isAdmin(event: AuthedEvent): boolean {
    return parseGroupsClaim(event.requestContext.authorizer.jwt.claims["cognito:groups"]).includes("admin");
}

/**
 * JSON エラーレスポンスの短縮形。
 * `code` はアプリが見分けるための**変わらない英字の印**（`error` は画面に出す日本語で、変わりうる）
 */
export function jsonError(statusCode: number, message: string, code?: string) {
    return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(code ? { error: message, code } : { error: message }) };
}
