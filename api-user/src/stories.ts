import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { ScanCommand, QueryCommand, PutCommand, GetCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { ddb, PHOTOS_TABLE, USER_INDEX, STORY_INDEX, STORY_FEED_KEY } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError, isAdmin } from "./http";
import { lookupDisplayName } from "./notify";
import { mediaKeys } from "./mediaKeys";
import { isOwnUploadUrl } from "./upload";
import { keyFromUploadUrl } from "./uploadPolicy";

const UPLOAD_BUCKET = process.env.UPLOAD_BUCKET ?? "";
const STORY_TTL_MS = 24 * 60 * 60 * 1000; // 24時間
const STORY_DAILY_LIMIT = 20; // 1ユーザーが24時間に投稿できるストーリー数
const STORY_DEFAULT_DURATION_SEC = 5; // 画像ストーリーの既定表示秒数（この値なら保存しない）

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

// ストーリーレコードから S3 オブジェクトキーを導出する
// （key フィールド優先、無ければ src の URL パスから）
function deriveStoryKey(item: Record<string, unknown>): string {
    if (typeof item.key === "string" && item.key) return item.key;
    if (typeof item.src === "string") {
        try {
            const path = new URL(item.src).pathname.replace(/^\//, "");
            if (path.startsWith("uploads/")) return path;
        } catch { /* ignore */ }
    }
    return "";
}

/**
 * ストーリー削除時に消すべき S3 キー。
 *
 * 原本（key / src）だけでは足りない。サムネ生成スクリプトが以前ストーリーも
 * 対象にしていたため、AVIF や小サイズの派生が max-age=31536000 で
 * 残っている個体がある。原本だけ消すと「24時間で消えるはずのものが
 * 公開URLで取得できる」状態になる。退会処理と同じ列挙を使う。
 */
function storyMediaKeys(item: Record<string, unknown>): string[] {
    const keys = new Set(mediaKeys(item));
    const primary = deriveStoryKey(item);
    if (primary) keys.add(primary);
    return [...keys];
}

// 過去24時間にこのユーザーが投稿したストーリー数を数える（レート制限用）
async function countRecentStories(userId: string): Promise<number> {
    const since = new Date(Date.now() - STORY_TTL_MS).toISOString();
    let count = 0;
    let lastKey: Record<string, unknown> | undefined;
    do {
        const res = await ddb.send(new QueryCommand({
            TableName: PHOTOS_TABLE,
            IndexName: USER_INDEX,
            KeyConditionExpression: "userId = :u AND createdAt >= :since",
            FilterExpression: "story = :t",
            ExpressionAttributeValues: { ":u": userId, ":since": since, ":t": true },
            Select: "COUNT",
            ExclusiveStartKey: lastKey,
        }));
        count += res.Count ?? 0;
        lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return count;
}

/**
 * ストーリーを引く。
 *
 * GSI（storyFeed-expiresAt-index）を Query する。以前はテーブル全体の Scan で、
 * 同居しているいいね/フォローのマーカー（退会しても消えない）が増えるほど
 * 重くなり、いずれ実行時間を超えて「ログイン中の全員のストーリー欄が
 * 同時に壊れる」という壊れ方をする作りだった。
 *
 * GSI がまだ無いテーブル（作成直後・移行前）では Scan に落ちる。
 * ここを落とすと機能ごと止まるので、遅くても動く方に倒す。
 * ストーリーは24時間で入れ替わるので、GSI を足せば1日で全件が載る。
 */
async function queryStories(filter: "active" | "expired"): Promise<Record<string, unknown>[]> {
    const now = new Date().toISOString();
    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;
    try {
        do {
            const res = await ddb.send(new QueryCommand({
                TableName: PHOTOS_TABLE,
                IndexName: STORY_INDEX,
                KeyConditionExpression: filter === "active"
                    ? "storyFeed = :k AND expiresAt > :now"
                    : "storyFeed = :k AND expiresAt <= :now",
                ExpressionAttributeValues: { ":k": STORY_FEED_KEY, ":now": now },
                ExclusiveStartKey: lastKey,
            }));
            items.push(...((res.Items ?? []) as Record<string, unknown>[]));
            lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
        } while (lastKey);
        return items;
    } catch (e) {
        const name = (e as { name?: string }).name;
        if (name !== "ValidationException" && name !== "ResourceNotFoundException") throw e;
        console.warn(`queryStories: ${STORY_INDEX} が無いため Scan にフォールバックします`);
    }
    return scanStories(filter);
}

/** GSI が無い環境向けのフォールバック。テーブル全体を読むので遅い */
async function scanStories(filter: "active" | "expired"): Promise<Record<string, unknown>[]> {
    const now = new Date().toISOString();
    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
        const res = await ddb.send(new ScanCommand({
            TableName: PHOTOS_TABLE,
            FilterExpression: filter === "active" ? "story = :t AND expiresAt > :now" : "story = :t AND expiresAt <= :now",
            ExpressionAttributeValues: { ":t": true, ":now": now },
            ExclusiveStartKey: lastKey,
        }));
        items.push(...((res.Items ?? []) as Record<string, unknown>[]));
        lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return items;
}

// GET /stories — 有効期限内のストーリー一覧（ログインユーザー限定）
// ストーリーは「消える・身内向け」の性質上、閲覧もログインユーザーに限定する。
// viewers（閲覧者情報）は本人しか見られないため、レスポンスからは常に除外する。
export const getStories: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");
    try {
        const items = await queryStories("active");
        for (const item of items) {
            delete item.viewers;
        }
        items.sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
        return {
            // 認証済みユーザー個別のレスポンスなので共有キャッシュには載せない
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            body: JSON.stringify(items),
        };
    } catch (e) {
        console.error("getStories error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

// POST /stories — ストーリー投稿（認証必要）。
// 画像/動画は既存の presigned-url フローでアップロード済みであることを前提にレコードだけ作成する。
export const createStory: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) {
        return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "認証が必要です" }) };
    }

    // displayName は受け取らない（なりすまし防止のためサーバーで引く）。
    // key も受け取らない（publicUrl から導く。下のコメント参照）。
    let body: { publicUrl?: string; caption?: string; mediaType?: string; song?: unknown; durationSec?: unknown };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const publicUrl = (body.publicUrl ?? "").trim();
    if (!publicUrl) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "画像URLが必要です" }) };
    }
    // 自分のアップロード領域を指すURLだけを受け付ける。
    // 判定は upload.ts の isOwnUploadUrl に寄せる（未設定なら通さない）。
    // userId を渡して「他人の領域」を弾くのが要（下の key の話と対になる）。
    if (!isOwnUploadUrl(publicUrl, userId)) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正な画像URLです" }) };
    }

    // 削除用のキーはクライアントから受け取らず、検証済みの publicUrl から導く。
    // 受け取っていた頃は、自分の正当な publicUrl と一緒に他人のキーを送り、
    // 直後に自分のストーリーを削除するだけで相手のファイルを消せた。
    const key = keyFromUploadUrl(publicUrl);

    const mediaType = body.mediaType === "video" ? "video" : "image";
    const caption = (body.caption ?? "").trim().slice(0, 200) || undefined;

    // 画像ストーリーの表示秒数。投稿者が選べる（既定5秒）。
    // 3秒未満は読み切れず、15秒を超えると見る側が飽きるため範囲を固定する。
    const durationSec = (() => {
        const n = typeof body.durationSec === "number" ? body.durationSec : Number(body.durationSec);
        if (!Number.isFinite(n)) return undefined;
        const clamped = Math.round(Math.min(15, Math.max(3, n)));
        return clamped === STORY_DEFAULT_DURATION_SEC ? undefined : clamped;
    })();

    // ストーリーBGM: title + https の previewUrl 必須（30秒プレビュー）
    let song: { title: string; artist?: string; artwork?: string; previewUrl: string; trackUrl?: string; startSec?: number } | undefined;
    if (body.song && typeof body.song === "object" && !Array.isArray(body.song)) {
        const o = body.song as Record<string, unknown>;
        const httpsOnly = (v: unknown, max: number): string | undefined => {
            const t = typeof v === "string" ? v.trim().slice(0, max) : "";
            return t && /^https:\/\//.test(t) ? t : undefined;
        };
        const previewUrl = httpsOnly(o.previewUrl, 500);
        const title = typeof o.title === "string" ? o.title.trim().slice(0, 200) : "";
        if (previewUrl && title) {
            const artist = typeof o.artist === "string" ? o.artist.trim().slice(0, 200) : "";
            const artwork = httpsOnly(o.artwork, 500);
            const trackUrl = httpsOnly(o.trackUrl, 500);
            // 「好きな部分」= 30秒プレビュー内の再生開始位置（0〜29秒）
            const rawStart = typeof o.startSec === "number" ? o.startSec : Number(o.startSec);
            const startSec = Number.isFinite(rawStart) && rawStart > 0 ? Math.min(29, Math.round(rawStart)) : undefined;
            song = {
                title,
                previewUrl,
                ...(artist ? { artist } : {}),
                ...(artwork ? { artwork } : {}),
                ...(trackUrl ? { trackUrl } : {}),
                ...(startSec ? { startSec } : {}),
            };
        }
    }

    // 1日の投稿上限チェック（スパム防止）
    try {
        if (await countRecentStories(userId) >= STORY_DAILY_LIMIT) {
            return jsonError(429, `24時間の投稿上限（${STORY_DAILY_LIMIT}件）に達しています`);
        }
    } catch (e) {
        console.error("countRecentStories error:", e); // 数え上げ失敗は投稿を止めない
    }

    // 表示名はサーバーで引く。クライアントの申告を保存していたため、
    // 「Journey 運営」のような名前でストーリーを出せた（ストーリーは
    // ログイン中の全員のトレイに並ぶので、なりすましがそのまま届く）。
    // 閲覧記録（viewStory）は既に同じ方針。
    const displayName = await lookupDisplayName(userId) || undefined;

    const now = Date.now();
    const story = {
        id: `story-${randomUUID()}`,
        story: true,
        // ストーリー一覧用 GSI のパーティションキー。定数なので story 項目だけが
        // この索引に載る（写真もマーカーもコメント文書も載らない）。
        storyFeed: STORY_FEED_KEY,
        published: false, // ギャラリー・photos.json から除外するため
        src: publicUrl,
        ...(key ? { key } : {}), // 期限切れ削除時に S3 オブジェクトを消すために保持
        mediaType,
        ...(caption ? { caption } : {}),
        ...(song ? { song } : {}),
        ...(durationSec ? { durationSec } : {}),
        userId,
        ...(displayName ? { displayName } : {}),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + STORY_TTL_MS).toISOString(),
        updatedAt: new Date(now).toISOString(),
    };

    try {
        await ddb.send(new PutCommand({ TableName: PHOTOS_TABLE, Item: story }));
        return { statusCode: 201, headers: JSON_HEADERS, body: JSON.stringify({ success: true, story }) };
    } catch (e) {
        console.error("createStory error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "投稿に失敗しました" }) };
    }
};

// POST /stories/{id}/view — 閲覧記録（認証必要・投稿者本人の閲覧は記録しない）
export const viewStory: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const viewerId = getUserId(event);
    const storyId = event.pathParameters?.id;
    if (!viewerId || !storyId) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    try {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: storyId } }));
        const item = res.Item as Record<string, unknown> | undefined;
        if (!item || item.story !== true) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "ストーリーが見つかりません" }) };
        }
        if (item.userId === viewerId) {
            return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true, self: true }) };
        }

        // 表示名はサーバーで引く。クライアント申告を保存すると、改造したクライアントから
        // 任意の名前で閲覧履歴に載れてしまう（notify.ts も同じ理由で申告を信用していない）。
        // 記録すると決まってから引く（本人の閲覧や404では無駄に叩かない）。
        const displayName = await lookupDisplayName(viewerId);

        // viewers マップが無ければ作ってから、閲覧者エントリを追加（初回閲覧時刻を保持）
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: storyId },
            UpdateExpression: "SET viewers = if_not_exists(viewers, :empty)",
            ExpressionAttributeValues: { ":empty": {} },
        }));
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: storyId },
            UpdateExpression: "SET viewers.#uid = if_not_exists(viewers.#uid, :v)",
            ExpressionAttributeNames: { "#uid": viewerId },
            ExpressionAttributeValues: {
                ":v": { ...(displayName ? { displayName } : {}), at: new Date().toISOString() },
            },
        }));
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true }) };
    } catch (e) {
        console.error("viewStory error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "記録に失敗しました" }) };
    }
};

// GET /stories/{id}/viewers — 閲覧者リスト（投稿者本人のみ）
export const getStoryViewers: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const callerId = getUserId(event);
    const storyId = event.pathParameters?.id;
    if (!callerId || !storyId) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    try {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: storyId } }));
        const item = res.Item as Record<string, unknown> | undefined;
        if (!item || item.story !== true) {
            return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "ストーリーが見つかりません" }) };
        }
        if (item.userId !== callerId) {
            return { statusCode: 403, headers: JSON_HEADERS, body: JSON.stringify({ error: "権限がありません" }) };
        }

        const viewersMap = (item.viewers ?? {}) as Record<string, { displayName?: string; at?: string }>;
        const viewers = Object.entries(viewersMap)
            .map(([userId, v]) => ({ userId, displayName: v?.displayName, at: v?.at }))
            .sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ viewers, count: viewers.length }) };
    } catch (e) {
        console.error("getStoryViewers error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "取得に失敗しました" }) };
    }
};

// DELETE /stories/{id} — 自分のストーリーを削除（投稿者本人 or 管理者）
// DynamoDB レコードと S3 オブジェクトの両方を消す。
export const deleteStory: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const callerId = getUserId(event);
    const storyId = event.pathParameters?.id;
    if (!callerId || !storyId) return jsonError(400, "不正なリクエスト");

    try {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: storyId } }));
        const item = res.Item as Record<string, unknown> | undefined;
        if (!item || item.story !== true) return jsonError(404, "ストーリーが見つかりません");
        // 見出しどおり「本人 or 管理者」。管理者の分岐が抜けていたため、
        // 全員のトレイに出る不適切なストーリーを消す手段が無かった
        // （AWS コンソールを開くか24時間待つしかなかった）。
        if (item.userId !== callerId && !isAdmin(event)) return jsonError(403, "権限がありません");

        // 原本だけでなく派生画像も消す。過去にサムネ生成がストーリーも対象に
        // していた時期があり、その分が max-age=31536000 で残っている。
        for (const key of storyMediaKeys(item)) {
            if (!UPLOAD_BUCKET) break;
            try {
                await s3.send(new DeleteObjectCommand({ Bucket: UPLOAD_BUCKET, Key: key }));
            } catch (e) {
                console.error(`deleteStory: S3 delete failed for ${key}:`, e); // S3失敗でもレコードは消す
            }
        }
        await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: storyId } }));
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true }) };
    } catch (e) {
        console.error("deleteStory error:", e);
        return jsonError(500, "削除に失敗しました");
    }
};

// 期限切れストーリーの物理削除（毎日スケジュール実行）
// DynamoDB のレコードと S3 の画像/動画本体の両方を削除する。
export const cleanupExpiredStories = async (): Promise<{ deleted: number }> => {
    const expired = await queryStories("expired");
    let deleted = 0;

    for (const item of expired) {
        const id = String(item.id ?? "");
        if (!id) continue;

        for (const key of storyMediaKeys(item)) {
            if (!UPLOAD_BUCKET) break;
            try {
                await s3.send(new DeleteObjectCommand({ Bucket: UPLOAD_BUCKET, Key: key }));
            } catch (e) {
                console.error(`cleanup: S3 delete failed for ${key}:`, e);
            }
        }

        try {
            await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id } }));
            deleted++;
        } catch (e) {
            console.error(`cleanup: DDB delete failed for ${id}:`, e);
        }
    }

    console.log(`cleanupExpiredStories: deleted ${deleted} of ${expired.length} expired stories`);
    return { deleted };
};
