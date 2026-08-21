import type { APIGatewayProxyHandlerV2, APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { listPhotos, listPhotosByUser, getPhotoById, listAllPhotosForAdmin } from "./ddb-photos";
import { isAdmin } from "./auth";

const JSON_HEADERS = {
    "Content-Type": "application/json",
    "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
};

/**
 * 公開一覧の使い回し（同じ Lambda インスタンス内だけ）。
 *
 * この口は未ログインでも叩けて、1回ごとにテーブル全体を読む。
 * しかもこのテーブルには写真だけでなく、いいね・フォローのマーカーや
 * コメント・通知の文書も同居していて、絞り込みは**読んだあと**に効く
 * ——つまり全部の読み取り費用を払っている。マーカーは退会しても
 * 消えないので、増えるほど1回が重くなる。
 *
 * レスポンスには s-maxage=60 を付けているが、API の手前に共有キャッシュは
 * 無いので効いていない（クライアントは execute-api を直接叩く）。
 * 見つからないクエリ文字列を足すだけで何度でも叩ける。
 *
 * 同じ約束（60秒）でサーバー側に持つ。返すものは変わらない。
 */
// 60秒にしていたが、公開アップロードの導線は「保存 → 1.5秒後にトップへ」で、
// 書き込みは api-user・読み取りは api と別サービスなので、書いた側から
// キャッシュを落とせない。上げた本人に最大60秒「無い」ように見え、
// もう一度上げてしまう（同じ写真が2枚。100枚上限も1枚減る）。
// 10秒なら、まとめて叩かれたときの読み取り削減はほぼ変わらず、
// 「反映されない」と感じる窓は普通の配信の遅れと同じ程度に収まる。
/**
 * 公開の読み取りで返してはいけない項目。
 *
 * `srcOriginal` は EXIF を落とす**前**の原本のURL（GPS が入っている）、
 * `key` は S3 のオブジェクトキー（投稿者の sub を含む）。
 * 静的側は2か所で落としている:
 *   - scripts/sync-photos-from-ddb.js（photos.json を書くとき）
 *   - lib/server/photos.ts（読み出すとき。古い photos.json 対策）
 * ところが Lambda の公開読み取り（GET /photos・GET /photos/{id}、
 * どちらも認可なし）は DynamoDB の項目をそのまま返していたので、
 * **静的HTMLから消したURLが API からは取れたまま**だった。
 * restrict-originals はS3側の配信を止める道具で、URLの配布は止められない。
 *
 * **落とすのはここ（ハンドラ側）で、ddb-photos.ts ではない。**
 * photosMutate.ts の deletePhoto は同じ getPhotoById から srcOriginal を
 * 読んで原本を消しているので、データ層で落とすと
 * 「GPS入りの原本が削除されなくなる」——直しに来たものより悪くなる。
 */
const PRIVATE_FIELDS = ["srcOriginal", "key"] as const;

function stripPrivate<T extends Record<string, unknown>>(photo: T): T {
    const out = { ...photo };
    for (const f of PRIVATE_FIELDS) delete out[f];
    return out;
}

const LIST_CACHE_TTL_MS = 10 * 1000;
let listCache: { at: number; json: string } | null = null;

/** テストから状態を消せるようにしておく */
export function resetPhotosCache(): void {
    listCache = null;
}

export const getPhotos: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const userId = event.queryStringParameters?.userId;
        if (userId) {
            // 特定の人の分は GSI の Query なので、その人の枚数で収まる
            const photos = await listPhotosByUser(userId);
            return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(photos.map(stripPrivate)) };
        }
        const now = Date.now();
        if (!listCache || now - listCache.at >= LIST_CACHE_TTL_MS) {
            listCache = { at: now, json: JSON.stringify((await listPhotos()).map(stripPrivate)) };
        }
        return { statusCode: 200, headers: JSON_HEADERS, body: listCache.json };
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
        // src を持つものだけが写真（listPhotos も同じ条件で絞っている）。
        // ストーリーも弾く。一覧の3か所（ddb-photos.ts）は
        // attribute_not_exists(story) で弾いているのに、詳細だけ
        // published:false 経由の間接的な判定しかなく、
        // 何かの拍子に published:true になった story-<id> を直に引くと
        // viewers（閲覧者全員の userId と表示名）ごと返っていた。
        if (!photo || !photo.src || photo.published === false || photo.story === true) {
            return { statusCode: 404, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "写真が見つかりません" }) };
        }
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(stripPrivate(photo)) };
    } catch (e) {
        console.error("getPhoto error:", e);
        return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "写真の取得に失敗しました" }) };
    }
};

/**
 * GET /admin/photos — 下書きも含めた全写真（管理者のみ）。
 *
 * 公開の GET /photos は下書きを隠す。管理画面がそれだけを見ていたため、
 * 写真を非公開にすると一覧からも編集画面からも消え、戻す手段が無かった。
 * 「下書き」フィルタが常に空だったのも同じ理由。
 */
export const getPhotosForAdmin: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    if (!isAdmin(event)) {
        return { statusCode: 403, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "権限がありません" }) };
    }
    try {
        const photos = await listAllPhotosForAdmin();
        return {
            statusCode: 200,
            // 管理者個別のレスポンス。下書きが混ざるので共有キャッシュには載せない
            headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
            body: JSON.stringify(photos),
        };
    } catch (e) {
        console.error("getPhotosForAdmin error:", e);
        return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "写真の取得に失敗しました" }) };
    }
};
