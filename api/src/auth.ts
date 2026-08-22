import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";

const ADMIN_GROUP = "admin";

/**
 * JWT クレームから管理者かどうかを確認する
 * API Gateway JWT Authorizer によって検証済みのトークンを前提とする
 */
export function isAdmin(event: APIGatewayProxyEventV2WithJWTAuthorizer): boolean {
    const claims = event.requestContext.authorizer.jwt.claims;
    return parseGroupsClaim(claims["cognito:groups"]).includes(ADMIN_GROUP);
}

/**
 * cognito:groups クレームをグループ名の配列に正規化する。
 *
 * API Gateway (HTTP API) の JWT オーソライザーは配列クレームを
 * "[admin user]" という引用符なし・スペース区切りの文字列に変換して渡す
 * （JSON として不正なので JSON.parse では読めない）。
 * この形式に加えて、実配列・JSON文字列・カンマ区切りにも対応する。
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
        // "[admin user]" 形式: ブラケットを外してスペース/カンマで分割
        return str.replace(/^\[|\]$/g, "").split(/[\s,]+/).filter(Boolean);
    }
    return str.split(",").map((g) => g.trim()).filter(Boolean);
}

export function getCallerUserId(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
    // sub 欠落は "" を返す（対の api-user/src/http.ts と同趣旨。あちらは
    // String(sub ?? "") で、非文字列の sub の扱いだけ僅かに違う——こちらが安全側）。
    // 以前は "unknown" を返していて、savePhoto が userId:"unknown" の
    // 写真を作れた——そのIDの持ち主は存在せず、本人画面から消せない。
    // 呼び出し側は "" を見て 401 に倒す（見ずに進まない）。
    const sub = event.requestContext.authorizer.jwt.claims.sub;
    return typeof sub === "string" ? sub : "";
}

export function requireAdmin(
    event: APIGatewayProxyEventV2WithJWTAuthorizer
): { statusCode: 403; headers: Record<string, string>; body: string } | null {
    if (!isAdmin(event)) {
        return {
            statusCode: 403,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "管理者権限が必要です" }),
        };
    }
    return null;
}
