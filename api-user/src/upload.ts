import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { putPhoto, getPhotoById, countUserPhotos, listMyMediaItems } from "./ddb-photos";
import type { Photo } from "./types";
import { JSON_HEADERS, getUserId, isAdmin } from "./http";
import { lookupDisplayNameIfSet } from "./notify";
import { sanitizeExif, sanitizeCoords, sanitizeBlurDataURL, sanitizeDate, sanitizeTitle, sanitizeDescription, sanitizeText, sanitizeTags } from "./sanitize";
import { extForType, uploadPrefix, canonicalUploadUrl, idFromUploadKey, isOwnUploadUrl as isOwnUploadUrlFor } from "./uploadPolicy";
import { mediaKeys } from "./mediaKeys";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
const UPLOAD_BUCKET = process.env.UPLOAD_BUCKET!;
const CLOUDFRONT_URL = process.env.CLOUDFRONT_URL ?? "";

/**
 * 自分のアップロード領域を指すURLかどうか。
 *
 * 保存された src は削除時にそのまま S3 のキーになるため、ここが最後の砦になる。
 * `userId` を渡すと「その人の領域か」まで見る。新しくURLを結び付ける場面
 * （写真の保存・ストーリーの作成）では必ず渡すこと。判定の中身は
 * uploadPolicy.ts にある。
 */
export function isOwnUploadUrl(raw: unknown, userId?: string): boolean {
    return isOwnUploadUrlFor(raw, CLOUDFRONT_URL, userId);
}

const PHOTO_LIMIT_PER_USER = 100;

/**
 * 100枚の上限を確かめる。超えていれば断る理由を返す。
 *
 * **数えられなかったら通さない。** 以前は console.error だけ出して
 * そのまま保存していたので、スロットリングを起こせば上限を超えられた。
 * これは容量と費用の上限なので、「分からないなら通す」ではなく
 * 「分からないなら止める」に倒す
 * （CLAUDE.md の「設定ミスは『本番を触る』ではなく『動かない』に倒す」と同じ）。
 *
 * 入口が2つある（presignedUrl と savePhoto）ので、判定はここ1か所に置く。
 * 片方だけ直しても、もう片方から素通りする。
 */
async function photoLimitError(userId: string, admin: boolean) {
    if (admin) return null;
    let count: number;
    try {
        count = await countUserPhotos(userId);
    } catch (e) {
        console.error("photo count check error:", e);
        return {
            statusCode: 503,
            headers: JSON_HEADERS,
            body: JSON.stringify({ error: "枚数を確認できませんでした。時間をおいてもう一度お試しください" }),
        };
    }
    if (count >= PHOTO_LIMIT_PER_USER) {
        return {
            statusCode: 403,
            headers: JSON_HEADERS,
            body: JSON.stringify({ error: `アップロード上限（${PHOTO_LIMIT_PER_USER}枚）に達しています` }),
        };
    }
    return null;
}

export const presignedUrl: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    // sub が取れないと領域を切れない（uploads// になって全員が同じ場所を共有する）
    if (!userId) {
        return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "認証が必要です" }) };
    }

    // 100枚制限チェック（adminは除外）
    const limitError = await photoLimitError(userId, isAdmin(event));
    if (limitError) return limitError;

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
    // 画像に加えて動画も許可（ストーリー用。mp4 / webm / QuickTime）。
    // 許可リストで判定する（"image/" で始まるかどうかでは svg が通ってしまう）。
    // 拡張子もファイル名からではなく種別から決める。ファイル名由来だと
    // "a.svg" のような名前がそのまま S3 のキーになっていた。
    const ext = extForType(fileType, true);
    if (!ext) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "対応していない形式です（JPEG・PNG・WebP・AVIF・HEIC・GIF、動画は MP4・WebM・MOV）" }) };
    }

    const photoId = uuidv4();
    // 投稿者ごとの領域に置く。URL だけで持ち主が分かるようにして、
    // 他人のファイルを自分の写真として登録・削除できないようにする。
    const key = `${uploadPrefix(userId)}${photoId}.${ext}`;

    const presigned = await getSignedUrl(
        s3,
        new PutObjectCommand({
            Bucket: UPLOAD_BUCKET,
            Key: key,
            // クライアントが送ってきた文字列ではなく、許可済みの種別だけを焼き付ける
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
    const userId = getUserId(event);
    if (!userId) {
        return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "認証が必要です" }) };
    }

    let body: {
        key?: string;
        publicUrl?: string;
        photoId?: string;
        title?: Photo["title"];
        description?: Photo["description"];
        location?: string;
        category?: string;
        tags?: string[];
        exif?: Photo["exif"];
        coords?: unknown;
        dominantColor?: string;
        thumbUrl?: string;
        published?: boolean;
        blurDataURL?: string;
        date?: unknown;
    };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const { key, publicUrl, title, description, location, category, tags, exif, coords, dominantColor, thumbUrl, blurDataURL } = body;
    // 下書き保存: published === false のときだけ非公開。既定（未指定/true）は従来通り公開。
    const isPublished = body.published !== false;
    if (!key || !publicUrl) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "ファイル情報が必要です" }) };
    }
    // 「自分のアップロード領域」を指すURLだけを受け付ける。
    //
    // uploads/ 配下かどうかしか見ていなかった頃は、他人の写真の公開URLを
    // 自分の写真の src として登録でき、そのままその写真を削除すると
    // 相手の実ファイルが S3 から消えた（削除は src のパスをそのまま
    // キーとして使うため。元に戻せない）。投稿者ごとの接頭辞まで確かめる。
    if (!isOwnUploadUrl(publicUrl, userId)) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正な画像URLです" }) };
    }
    if (!String(key).startsWith(uploadPrefix(userId))) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なキーです" }) };
    }

    // 100枚制限の二重チェック（adminは除外）
    const limitError = await photoLimitError(userId, isAdmin(event));
    if (limitError) return limitError;

    // 表示名は**サーバーで引く**。本文の値を信用してはいけない。
    //
    // 保存された displayName は静的HTMLと JSON-LD の author に焼き込まれる
    // （lib/utils/seo.ts:131・PhotoPageClient:618）ので、受け取ると
    // 「運営」や他人の名前を写真ごとに名乗れる。
    // 同じことをストーリーでは既に禁じている——stories.ts:155 に
    // 「displayName は受け取らない（なりすまし防止のためサーバーで引く）」
    // と書かれていて、写真だけが例外だった。
    const resolvedDisplayName = await lookupDisplayNameIfSet(userId);
    const safeCoords = sanitizeCoords(coords);
    // 代表色: グリッドのプレースホルダー用。#rrggbb 形式のみ受け付ける
    const safeDominantColor = typeof dominantColor === "string" && /^#[0-9a-fA-F]{6}$/.test(dominantColor)
        ? dominantColor.toLowerCase()
        : undefined;
    // サムネイルURL: 一覧グリッド配信用の軽量版。
    // 「https で始まる」しか見ていなかったので、外部の任意URLを入れて
    // ギャラリーを見た人全員の IP を集めることができたし、他人の
    // uploads/ を指すこともできた（退会時にその実ファイルが消える）。
    // publicUrl とまったく同じ判定にする。
    const safeThumbSrc = isOwnUploadUrl(thumbUrl, userId) && String(thumbUrl).length <= 500
        ? canonicalUploadUrl(String(thumbUrl), CLOUDFRONT_URL)
        : undefined;
    // ぼかしプレビュー（data:image/webp;base64,...）: 画像 data URI のみ許可
    const safeBlurDataURL = sanitizeBlurDataURL(blurDataURL);
    // 撮影日（EXIF 由来）。年表を「撮った順」で並べるために保存する。
    const safeDate = sanitizeDate(body.date);

    const photo: Photo = {
        // **IDは presign が採番したものを鍵から取り出す。** ここで毎回
        // 採番し直していたので、保存の再送が**同じ写真をもう1枚**作っていた:
        // 「公開」を押す → サーバーには届いたが応答が失われる（モバイル回線・
        // API Gateway の 29 秒）→ 画面は error になる → 押し直すと、S3 に上げた
        // 分は使い回すのに save だけもう一度飛び、新しいIDで2枚目の行ができる。
        // 100枚の枠を2つ食い、片方を消すと共有している S3 の実体が消えて
        // **もう片方が割れた画像になる**。comments.ts は同じ形の再送を
        // 「前回の追記が通っていたら、もう足さない」で既に塞いでいる。
        //
        // リクエストの値をそのまま使うわけではない。鍵は既に
        // `uploadPrefix(userId)` で始まることを確かめてあるので、取り出せる
        // のは**自分の領域に presign したID**だけ。他人のIDを狙って書いても
        // putPhoto の `attribute_not_exists(id)` で弾かれる（下の catch）。
        id: idFromUploadKey(String(key)) ?? uuidv4(),
        // 検証したときに見ていた形で保存する（デコード済みのパスで組み直す）。
        // 生のまま保存すると、削除や派生生成で見る側と表記が食い違い、
        // 対象から漏れる余地が残る。
        src: canonicalUploadUrl(publicUrl, CLOUDFRONT_URL),
        // 保存時にもサニタイズを通す。photoUpdate.ts は通しているのにここだけ
        // 素通しで、任意の長さ・任意の構造の値が静的HTMLまで届いていた。
        title: sanitizeTitle(title) ?? { ja: "無題", en: "Untitled" },
        ...(() => { const d = sanitizeDescription(description); return d ? { description: d } : {}; })(),
        ...(() => { const l = sanitizeText(location, 200); return l ? { location: l } : {}; })(),
        ...(() => { const c = sanitizeText(category, 100); return c ? { category: c } : {}; })(),
        // **タグ無しは「属性を持たない」に揃える。** ここだけ `tags: []` を
        // 必ず書いていたので、「タグ無し」の保存形が2通りあった。
        // photoUpdate.ts は空配列を REMOVE に倒すので、そちらとずれる。
        // 実害: この経路で上げた写真を /user/edit で初めて保存すると、
        // sameStoredValue(undefined, []) が false になって「変わった」と
        // 判定され、**中身を1文字も変えていないのに静的サイトの作り直しが
        // 走る**（Actions の枠を1枚につき1回無駄に使う）。
        ...(() => { const t = sanitizeTags(tags); return t && t.length > 0 ? { tags: t } : {}; })(),
        ...(() => { const safeExif = sanitizeExif(exif); return safeExif ? { exif: safeExif } : {}; })(),
        ...(safeCoords ? { coords: safeCoords } : {}),
        ...(safeDominantColor ? { dominantColor: safeDominantColor } : {}),
        ...(safeThumbSrc ? { thumbSrc: safeThumbSrc } : {}),
        ...(safeBlurDataURL ? { blurDataURL: safeBlurDataURL } : {}),
        ...(safeDate ? { date: safeDate } : {}),
        ...(resolvedDisplayName ? { displayName: resolvedDisplayName } : {}),
        userId,
        uploadedBy: userId,
        published: isPublished,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    try {
        await putPhoto(photo);
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true, photo }) };
    } catch (e) {
        if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
            // 既にその ID がある。**前回の保存が通っていた再送なら成功を返す。**
            // 中身まで見るのは、他人のIDを狙って書いた場合に「成功しました」と
            // 返さないため（存在を教えることにもなる）。
            const existing = await getPhotoById(photo.id);
            if (existing && (existing.userId ?? existing.uploadedBy) === userId && existing.src === photo.src) {
                console.log(`savePhoto: 同じ写真の再送を受け取りました（${photo.id}）`);
                return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true, photo: existing }) };
            }
            return { statusCode: 409, headers: JSON_HEADERS, body: JSON.stringify({ error: "この画像はすでに登録されています" }) };
        }
        console.error("savePhoto error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "保存に失敗しました" }) };
    }
};

/**
 * DELETE /user/uploads — 保存に至らなかった自分のアップロードを消す。
 *
 * 投稿の流れは「S3 に上げる → DynamoDB に書く」の2段。保存に失敗した項目は
 * 画面上 `error` になるが、そこで捨てる（× を押す／タブを閉じる）と
 * **実体だけが S3 に残る**。どの削除経路も DynamoDB の項目からキーを引くので、
 * 項目の無いオブジェクトには誰も手が届かない——退会しても、写真を消しても
 * 残り続ける（原本 srcOriginal は GPS 入りのまま公開URLで取れる）。
 *
 * 消してよいのは「自分の領域にあって、まだどの写真にも使われていない」キーだけ。
 * 使用中かどうかを確かめるのが要点で、これが無いと利用者は自分の**保存済みの**
 * 写真の実体だけを消せてしまう（DynamoDB には行が残るので、一覧に
 * 割れた画像が並び、本人にも直せない）。
 */
export const discardUpload: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) {
        return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "認証が必要です" }) };
    }

    let body: { key?: unknown };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const key = typeof body.key === "string" ? body.key : "";
    // 自分の領域のキーだけ。".." は扱わない（S3 のキーとしては正当だが、
    // 別の場所を指す形になっていないかを確かめる術が無い）。
    // 前置きの判定は uploadPolicy.uploadPrefix に寄せる（保存側と同じ根拠）。
    if (!key || !key.startsWith(uploadPrefix(userId)) || key.includes("..")) {
        return { statusCode: 403, headers: JSON_HEADERS, body: JSON.stringify({ error: "このファイルは削除できません" }) };
    }

    // 保存済みの写真**とストーリー**が使っているキーは消さない。
    // listMyPhotos（ストーリー除外）で判定していた頃は、自分の生きている
    // ストーリーの実体を消せた——item は残るので、全員のトレイに壊れた
    // 画像が最大24時間出続ける。
    // 数えられなかったら**消さない**（photoLimitError と同じ考え方——
    // 分からないなら止める。ここで通すと、取り返しのつかない削除になる）。
    let mine: Photo[];
    try {
        mine = await listMyMediaItems(userId);
    } catch (e) {
        console.error("discardUpload: listMyMediaItems failed:", e);
        return { statusCode: 503, headers: JSON_HEADERS, body: JSON.stringify({ error: "確認できませんでした。時間をおいてもう一度お試しください" }) };
    }
    const inUse = mine.some((p) => mediaKeys(p as unknown as Record<string, unknown>).includes(key));
    if (inUse) {
        return { statusCode: 409, headers: JSON_HEADERS, body: JSON.stringify({ error: "この画像は保存済みの写真で使われています" }) };
    }

    try {
        await s3.send(new DeleteObjectCommand({ Bucket: UPLOAD_BUCKET, Key: key }));
    } catch (e) {
        console.error("discardUpload: S3 delete failed:", e);
        return { statusCode: 503, headers: JSON_HEADERS, body: JSON.stringify({ error: "削除に失敗しました" }) };
    }
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true }) };
};
