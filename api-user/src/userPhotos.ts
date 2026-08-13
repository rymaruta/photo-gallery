import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { listMyPhotos } from "./ddb-photos";
import { JSON_HEADERS, getUserId } from "./http";

// GET /user/photos — 自分の写真一覧（下書き=非公開を含む）。
// 認証必須。公開 GET /photos?userId= は下書きを隠すため、下書き閲覧用にこちらを使う。
export const getMyPhotos: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    try {
        const photos = await listMyPhotos(userId);
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(photos) };
    } catch (e) {
        console.error("getMyPhotos error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "取得に失敗しました" }) };
    }
};
