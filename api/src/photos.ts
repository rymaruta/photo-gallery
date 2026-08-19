import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { listPhotos, listPhotosByUser, getPhotoById } from "./ddb-photos";

const JSON_HEADERS = {
    "Content-Type": "application/json",
    "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
};

export const getPhotos: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const userId = event.queryStringParameters?.userId;
        const photos = userId ? await listPhotosByUser(userId) : await listPhotos();
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(photos) };
    } catch (e) {
        console.error("getPhotos error:", e);
        return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "写真の取得に失敗しました" }) };
    }
};

export const getPhoto: APIGatewayProxyHandlerV2 = async (event) => {
    const id = event.pathParameters?.id;
    if (!id) {
        return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "IDが必要です" }) };
    }
    // このテーブルには写真以外（通知 notifs#... / コメント comments#... /
    // フォロー関係 following#... など）も同じキー空間に入っている。
    // それらは published を持たないため、published のチェックだけでは素通りし、
    // 認証なしで他人の通知やフォロー関係が読めてしまう。
    if (id.includes("#")) {
        return { statusCode: 404, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "写真が見つかりません" }) };
    }
    try {
        const photo = await getPhotoById(id);
        // src を持つものだけが写真（listPhotos も同じ条件で絞っている）
        if (!photo || !photo.src || photo.published === false) {
            return { statusCode: 404, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "写真が見つかりません" }) };
        }
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(photo) };
    } catch (e) {
        console.error("getPhoto error:", e);
        return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "写真の取得に失敗しました" }) };
    }
};
