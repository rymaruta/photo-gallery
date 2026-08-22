import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { putPhoto } from "./ddb-photos";
import { requireAdmin, getCallerUserId } from "./auth";
import type { Photo } from "./types";
import {
    sanitizeCoords as sanitizeCoordsFn, sanitizeExif, sanitizeTags,
    sanitizeTitle, sanitizeDescription, sanitizeText,
} from "./sanitize";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
const UPLOAD_BUCKET = process.env.UPLOAD_BUCKET!;
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL ?? "";
const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * 受け付ける画像の MIME タイプ → 拡張子。
 * api-user/src/uploadPolicy.ts の同名の表と揃えること（別パッケージなので共有できない）。
 * SVG を外すのが目的。SVG は <script> を書ける実行可能な文書で、
 * 配信は写真と同じ CloudFront ディストリビューション（＝サイトと同一オリジン）。
 */
const ALLOWED_IMAGE_TYPES = new Map([
    ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"],
    ["image/avif", "avif"], ["image/gif", "gif"], ["image/heic", "heic"], ["image/heif", "heif"],
]);

// 定義は sanitize.ts に置いてある（1パッケージ1定義）。
// 既存の import 元を壊さないよう、ここから再エクスポートする。
export { sanitizeCoords } from "./sanitize";

/**
 * 自分たちのアップロード領域を指すURLかどうか。
 *
 * 保存された src は削除時にそのまま S3 のキーになるので、ここが最後の砦。
 * 管理者専用の口だが、無検証だと外部URLや profiles/ を src にできてしまう
 * （削除で他人のアイコンが消える）。
 * 判定は api-user/src/uploadPolicy.ts の isOwnUploadUrl と同じ形。
 * あちらは投稿者ごとの接頭辞まで見るが、管理APIのキーは
 * uploads/<uuid> のままなので、ここは uploads/ 配下かどうかまで。
 */
export function isOwnUploadUrl(raw: unknown): boolean {
    if (typeof raw !== "string" || !raw) return false;
    let u: URL;
    try {
        u = new URL(raw);
    } catch {
        return false;
    }
    if (u.protocol !== "https:") return false;
    try {
        if (u.host !== new URL(CLOUDFRONT_URL).host) return false;
    } catch {
        return false; // 配信ドメインが未設定なら検証できない＝通さない
    }
    let pathname: string;
    try {
        pathname = decodeURIComponent(u.pathname);
    } catch {
        return false;
    }
    if (pathname.includes("..")) return false;
    return pathname.startsWith("/uploads/") && pathname.length > "/uploads/".length;
}

export const presignedUrl: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const authError = requireAdmin(event);
    if (authError) return authError;

    let body: { fileName?: string; fileType?: string; fileSize?: number };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const { fileName, fileType, fileSize } = body;
    if (!fileName || !fileType) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "ファイル名とファイルタイプが必要です" }) };
    }
    if (fileSize && fileSize > 50 * 1024 * 1024) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "ファイルサイズが大きすぎます（最大50MB）" }) };
    }
    // 許可リストで判定する。"image/" で始まるかどうかだけだと image/svg+xml が通り、
    // presigned PUT がその Content-Type をオブジェクトに焼き付けるので、
    // サイトと同じ CloudFront から「実行できる文書」が返る。
    // 拡張子もファイル名ではなく種別から決める（api-user/src/uploadPolicy.ts と対）。
    const ext = ALLOWED_IMAGE_TYPES.get(fileType.split(";")[0].trim().toLowerCase());
    if (!ext) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "対応していない形式です（JPEG・PNG・WebP・AVIF・HEIC・GIF）" }) };
    }

    const photoId = uuidv4();
    const key = `uploads/${photoId}.${ext}`;

    const presigned = await getSignedUrl(
        s3,
        new PutObjectCommand({
            Bucket: UPLOAD_BUCKET,
            Key: key,
            ContentType: fileType.split(";")[0].trim().toLowerCase(),
            CacheControl: "max-age=31536000",
        }),
        { expiresIn: 900 }
    );

    const publicUrl = CLOUDFRONT_URL
        ? `${CLOUDFRONT_URL}/${key}`
        : `https://${UPLOAD_BUCKET}.s3.${process.env.AWS_REGION ?? "ap-northeast-1"}.amazonaws.com/${key}`;

    return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({ presignedUrl: presigned, key, publicUrl, photoId }),
    };
};

export const savePhoto: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const authError = requireAdmin(event);
    if (authError) return authError;
    const uploaderId = getCallerUserId(event);
    // sub の無いトークンで進むと userId が空の写真ができる（持ち主のいない
    // 行は本人画面から消せない）。api-user 側の全ハンドラと同じ扱いで止める
    if (!uploaderId) {
        return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "認証が必要です" }) };
    }

    // photoId は受け取らない。ID をリクエストで指定できると、既存の写真や
    // 通知・コメントの文書を同じIDで丸ごと置き換えられる（api-user 側は
    // 同じ理由で既にサーバー採番にしてある）。
    let body: {
        key?: string;
        publicUrl?: string;
        title?: Photo["title"];
        description?: Photo["description"];
        location?: string;
        category?: string;
        tags?: string[];
        exif?: Photo["exif"];
        coords?: unknown;
    };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const { key, publicUrl, title, description, location, category, tags, exif, coords } = body;
    if (!key || !publicUrl) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "ファイル情報が必要です" }) };
    }
    // 保存する src は削除時にそのまま S3 のキーになる。
    // ここが無検証だと、外部URLや profiles/<他人のID> を src にできた。
    if (!isOwnUploadUrl(publicUrl)) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正な画像URLです" }) };
    }
    if (!String(key).startsWith("uploads/")) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なキーです" }) };
    }

    // 保存する値も整える。ここも素通しだったので、GPS 入りの exif や
    // 数千件のタグがそのまま公開データに入った（ユーザーAPI側は通している）。
    const safeCoords = sanitizeCoordsFn(coords);
    const safeTitle = sanitizeTitle(title);
    const safeDescription = sanitizeDescription(description);
    const safeLocation = sanitizeText(location, 200);
    const safeCategory = sanitizeText(category, 100);
    const safeTags = sanitizeTags(tags);
    const safeExif = sanitizeExif(exif);

    const photo: Photo = {
        id: uuidv4(),
        src: publicUrl,
        title: safeTitle ?? { ja: "無題", en: "Untitled" },
        ...(safeDescription ? { description: safeDescription } : {}),
        ...(safeLocation ? { location: safeLocation } : {}),
        ...(safeCategory ? { category: safeCategory } : {}),
        tags: safeTags ?? [],
        ...(safeExif ? { exif: safeExif } : {}),
        ...(safeCoords ? { coords: safeCoords } : {}),
        // 表示名は付けない。
        //
        // 以前はここに個人名が直書きされていて、**誰が上げても同じ名前**が
        // 付いた（そのまま静的HTMLと JSON-LD の author に載る）。
        // 管理者が2人になったら他人の名前で公開される。
        //
        // ユーザーAPI側は lookupDisplayNameIfSet でプロフィールから引くが、
        // こちらは同じことができない——この関数の IAM は usersTable に
        // PutItem しか許していない（serverless.yml:52-57。わざと絞ってある）。
        // 権限を広げてまで付ける価値は無い: この口はクライアントから
        // 呼ばれていない（app/user/upload/page.tsx:308「管理者でも
        // ユーザーAPIを使う」）ので、表示に影響しない。
        // 付けないと写真ページの投稿者導線が出ないが、それは
        // 名前を設定していない利用者と同じ扱いで、既存の写真には影響しない。
        userId: uploaderId,
        uploadedBy: uploaderId,
        published: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    try {
        await putPhoto(photo);
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true, photo }) };
    } catch (e) {
        console.error("savePhoto error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "保存に失敗しました" }) };
    }
};
