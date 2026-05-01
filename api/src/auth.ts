import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";

const ADMIN_GROUP = "admin";

/**
 * JWT クレームから管理者かどうかを確認する
 * API Gateway JWT Authorizer によって検証済みのトークンを前提とする
 */
export function isAdmin(event: APIGatewayProxyEventV2WithJWTAuthorizer): boolean {
    const claims = event.requestContext.authorizer.jwt.claims;
    const groups = claims["cognito:groups"];
    if (!groups) return false;
    // API Gateway HTTP API は配列クレームを JSON 文字列として渡す: '["admin"]'
    // カンマ区切り文字列や実配列にも対応
    let groupList: string[];
    if (Array.isArray(groups)) {
        groupList = groups as string[];
    } else {
        const str = String(groups).trim();
        if (str.startsWith("[")) {
            try {
                groupList = JSON.parse(str) as string[];
            } catch {
                groupList = [str];
            }
        } else {
            groupList = str.split(",").map((g) => g.trim());
        }
    }
    return groupList.includes(ADMIN_GROUP);
}

export function requireAdmin(
    event: APIGatewayProxyEventV2WithJWTAuthorizer
): { statusCode: 403; body: string } | null {
    if (!isAdmin(event)) {
        return {
            statusCode: 403,
            body: JSON.stringify({ error: "管理者権限が必要です" }),
        };
    }
    return null;
}
