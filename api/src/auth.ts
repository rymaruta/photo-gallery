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
    // groups は文字列（カンマ区切り）または配列の場合がある
    const groupList = Array.isArray(groups)
        ? groups
        : String(groups).split(",").map((g) => g.trim());
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
