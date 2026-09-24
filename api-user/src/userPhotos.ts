import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { listMyPhotos } from "./ddb-photos";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
// **画像の URL に期限を付ける。** 鍵が無い環境では何もしない（`signedUrl.ts`）
import { signPhotoImages } from "./signedUrl";

// GET /user/photos — 自分の写真一覧（下書き=非公開を含む）。
// 認証必須。公開 GET /photos?userId= は下書きを隠すため、下書き閲覧用にこちらを使う。
export const getMyPhotos: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    // sub 欠落の "" で進むと、GSI を userId="" で引くことになる（notifications.ts と同じ話）
    if (!userId) return jsonError(401, "認証が必要です");
    try {
        const photos = await listMyPhotos(userId);
        // 🔴 **自分の写真こそ署名が要る。**
        //
        // 「フォロワーのみ」に変えた写真は `photoUpdate.ts` が
        // **行の `src` 自体**を `/private/…` に書き換える。owner が
        // CloudFront に「署名必須」を入れると、この口が返す素の URL は
        // **本人にも 403** になる——つまり**自分の写真を自分で見られなく
        // なる**（下書きの一覧・編集画面の入口がここ）。
        //
        // `restrictedFeed.ts` だけ署名していて、ここが抜けていた。
        // **行を `/private/` に書き換える経路がある以上、その行を配る口は
        // すべて署名する**のが筋で、残り（ハイライト・アルバム・保存）は
        // 別の PR で塞ぐ。
        return {
            statusCode: 200,
            headers: JSON_HEADERS,
            body: JSON.stringify(photos.map((p) => signPhotoImages(p as unknown as Record<string, unknown>))),
        };
    } catch (e) {
        console.error("getMyPhotos error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "取得に失敗しました" }) };
    }
};
