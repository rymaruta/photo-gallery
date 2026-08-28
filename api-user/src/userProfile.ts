import type { APIGatewayProxyHandlerV2WithJWTAuthorizer, APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { JSON_HEADERS, getUserId } from "./http";
import { safeSongPreviewUrl, safeSongArtworkUrl, safeSongTrackUrl, SONG_URL_MAX } from "./mediaHosts";
import { requireEnv } from "./env";
import { isDeletedProfile } from "./types";

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
const USERS_TABLE = requireEnv("USERS_TABLE");
const PHOTOS_TABLE = requireEnv("PHOTOS_TABLE");

/**
 * その写真が今も在って、自分のものか。
 *
 * ピン留めの上限は配列の長さだけで数えるので、**消えた写真のIDが枠を
 * 食い潰す**。画面は見つからないピンを黙って落とすため、
 * 「3枚留めた → 1枚消した → もう1枚留めようとすると 409。でも画面には
 * 2枚しか出ていない」で詰む（解除ボタンは表示された写真の中にしか無く、
 * 増減方式なので配列を直接送る手も無い）。
 *
 * 削除の側は photoUpdate.ts の removePinnedPhoto で塞いであるが、
 * **逆向き——開きっぱなしの古いタブが、消えた写真をあとから留める——が
 * 空いていた**。スマホで消して PC のタブに戻る、で普通に踏める。
 *
 * 引けなかったときは true（在る扱い）。DynamoDB の一時的な失敗で
 * 「あなたの写真は見つかりません」と言う方が悪い。
 */
async function isLivePhotoOf(photoId: string, ownerId: string): Promise<boolean> {
    try {
        const res = await ddb.send(new GetItemCommand({
            TableName: PHOTOS_TABLE,
            Key: marshall({ id: photoId }),
            // userId は古い行に無いことがある（uploadedBy だけの時代の行）
            ProjectionExpression: "id, userId, uploadedBy",
        }));
        if (!res.Item) return false;
        const photo = unmarshall(res.Item) as { userId?: unknown; uploadedBy?: unknown };
        return (photo.userId ?? photo.uploadedBy) === ownerId;
    } catch (e) {
        console.error("isLivePhotoOf error:", e);
        return true;
    }
}

/** 留まっているIDのうち、今も在って自分のものだけを残す（順序は保つ） */
async function livePinnedIds(ids: string[], ownerId: string): Promise<string[]> {
    const alive = await Promise.all(ids.map((id) => isLivePhotoOf(id, ownerId)));
    return ids.filter((_, i) => alive[i]);
}

/**
 * https の URL として**形が整っている**か。ホストは見ない。
 *
 * ホストの許可判定は safeSongPreviewUrl が持っているので、ここで
 * 重ねてはいけない。「許可ホストでないこと」まで見る実装にすると、
 * 呼び出し側（下の `!isWellFormedHttpsUrl(...)`）が有効な曲を
 * 「形が壊れている」と判定し、**プレイリストの保存が全員で無言の
 * no-op になる**。名前とコメントが実装とずれていたので直した
 * （旧名 isLegacyHostUrl は「ホストを見ている」と読める）。
 *
 * ここで分けたいのは:
 *   形が整っている + ホストが許可外 → 旧ルール時代のデータ
 *   形が壊れている（URLでない・http・空）→ クライアントの不具合
 * 前者は「消したい意思」の判定に数え、後者は何も触らない。
 *
 * 長さの切り詰めは safeSongPreviewUrl と揃える（SONG_URL_MAX）。
 * 揃えないと、500字を超えるURLで「こちらは全文を見て整っている /
 * あちらは先頭500字だけ見て弾く」と食い違い、同じ値の分類がぶれる。
 *
 * なお切り詰めた結果が「整った https の許可外ホスト」になる細工URLは、
 * 本物の旧データと区別できない。これは塞げないが、この判定が効くのは
 * **自分のプロフィールだけ**なので、細工して消せるのも自分の曲だけ。
 */
function isWellFormedHttpsUrl(v: unknown): boolean {
    if (typeof v !== "string" || !v.trim()) return false;
    try {
        return new URL(v.trim().slice(0, SONG_URL_MAX)).protocol === "https:";
    } catch {
        return false;
    }
}

export type SongEntry = {
    title: string;
    artist?: string;
    artwork?: string;
    previewUrl: string;
    trackUrl?: string;
};

export type UserProfile = {
    userId: string;
    /** サイト内のユーザー名（@ハンドル）。表示用で、URLには使わない。全体で一意。 */
    username?: string;
    displayName?: string;
    bio?: string;
    instagram?: string;
    website?: string;
    // テーマソング。設定方法は2通り:
    //  (A) アプリ内検索(iTunes)で選択 → songPreviewUrl(30秒) + メタデータを保存
    //  (B) Spotify / YouTube / Apple Music のURLを貼付 → songUrl + 開始/終了(YouTubeのみ)
    // 貼ったリンク（独立）。曲(検索)が無いときの再生に使う。
    songUrl?: string;
    songStart?: number;
    songEnd?: number;
    // 検索で選んだ曲（独立）。あればこちらを優先再生。songTrackUrl は Apple 等への外部リンク。
    songTitle?: string;
    songArtist?: string;
    songArtwork?: string;
    songPreviewUrl?: string;
    songTrackUrl?: string;
    // マイBGMプレイリスト（最大5曲・順に再生）。従来の単曲フィールドは後方互換用
    songs?: SongEntry[];
    // 旅アルバムのカスタム名（trip-<epoch> → タイトル）。未設定の旅は自動タイトル。
    tripTitles?: Record<string, string>;
    // 旅アルバムのカバー写真（trip-<epoch> → photoId）。未設定は先頭の写真。
    tripCovers?: Record<string, string>;
    // 旅アルバムごとのBGM（trip-<epoch> → 曲）。旅を開くとその曲を再生できる。
    tripSongs?: Record<string, SongEntry>;
    // マイランキング（自由なお題 + 最大5項目）
    // マイページのパーソナライズ
    themeColor?: string;          // #rrggbb（アバターリング等のアクセント色）
    statusText?: string;          // 名前の下に出る「ひとこと」（絵文字OK・60文字）
    pinnedPhotoIds?: string[];    // ピン留め（投稿タブ先頭に固定・最大3枚）
    updatedAt?: string;
};

// サイト内ユーザー名（@ハンドル）の規則。小文字英数字とアンダースコアのみ。
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/** 誰にも取らせないユーザー名（ルート衝突・なりすまし・紛らわしい語）。 */
export const RESERVED_USERNAMES = new Set([
    // 1) サイトのルート名と衝突する語（将来URLに使う可能性も考えて確保）
    "user", "users", "photo", "photos", "tag", "tags", "location", "locations",
    "category", "categories", "camera", "cameras", "lens", "lenses", "map",
    "favorites", "favorite", "wishlist", "drafts", "draft", "edit", "upload",
    "profile", "settings", "search", "login", "signup", "logout", "api",
    "sitemap", "robots", "assets", "static", "public", "new", "me", "home",

    // 2) 運営・公式を騙れてしまう語（なりすまし防止）
    "admin", "administrator", "root", "system", "moderator", "mod", "staff", "official",
    "support", "help", "contact", "info", "team", "owner", "master",
    "journey", "journeyphoto", "journey_photo", "journeyphotocom",

    // 3) 技術的に紛らわしい語（表示やデバッグで事故りやすい）
    "null", "undefined", "true", "false", "none", "nan",
    "anonymous", "guest", "unknown", "deleted", "test",
]);

/** 入力を正規化して検証する。不正なら理由を返す。 */
export function normalizeUsername(raw: unknown): { username?: string; error?: string } {
    if (raw === null || raw === "") return {};            // 明示的なクリア
    if (typeof raw !== "string") return { error: "ユーザー名の形式が不正です" };
    const u = raw.trim().toLowerCase().replace(/^@/, "");
    if (!u) return {};
    if (!USERNAME_RE.test(u)) {
        return { error: "ユーザー名は英小文字・数字・_ の3〜20文字で入力してください" };
    }
    if (RESERVED_USERNAMES.has(u)) return { error: "そのユーザー名は使用できません" };
    return { username: u };
}

/** 一意性の予約アイテムのキー（同じ users テーブルに載せる） */
const usernameKey = (u: string) => `username#${u}`;

/**
 * ユーザー名を予約する。既に他人が使っていれば false。
 * GetItem/PutItem だけで完結するので、既存のIAM権限（Query不要）で動く。
 * 条件付き書き込みなので同時実行でも二重取得しない。
 */
/**
 * 保存が競合したときに読み直してやり直す回数。
 * follow.ts の FOLLOWING_WRITE_RETRIES と同じ考え方。
 */
const PROFILE_WRITE_RETRIES = 3;

async function reserveUsername(username: string, ownerId: string): Promise<boolean> {
    try {
        await ddb.send(new PutItemCommand({
            TableName: USERS_TABLE,
            Item: marshall({ userId: usernameKey(username), ownerId, updatedAt: new Date().toISOString() }),
            ConditionExpression: "attribute_not_exists(userId)",
        }));
        return true;
    } catch (e) {
        // 既に存在する場合、それが自分の予約なら OK（付け直し・再保存）
        if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
            const cur = await ddb.send(new GetItemCommand({
                TableName: USERS_TABLE,
                Key: marshall({ userId: usernameKey(username) }),
            }));
            const owner = cur.Item ? (unmarshall(cur.Item) as { ownerId?: string }).ownerId : undefined;
            return owner === ownerId;
        }
        throw e;
    }
}

/**
 * 古いユーザー名の予約を解放する（自分のものだけ）。
 *
 * **一時的な失敗と「そもそも解放不要」を分けること。** 全部まとめて
 * 握りつぶしていた頃は、スロットリング1回で `username#old` の行が残り、
 * そのあと誰も直せなかった——プロフィール行の username は既に新しい方に
 * なっているので、次の保存でも退会の掃除でも `@old` は対象に入らない。
 * **その @名は誰も取れないまま永久に残る。**
 *
 * 対になる account.ts の releaseOwnUsername は最初からこの形（条件失敗は
 * 成功扱い・それ以外は失敗）で、docstring に「条件まで含めて同じにすること」
 * と書いてある。条件式は揃っていたが、失敗の扱いだけ揃っていなかった。
 *
 * 呼ぶのはプロフィールを保存し終えたあとなので、ここで 500 にはしない
 * （保存は本当に成功している）。代わりに数回やり直し、それでも駄目なら
 * 残ったハンドルをログに残す。
 */
async function releaseUsername(username: string, ownerId: string): Promise<void> {
    for (let attempt = 0; attempt <= PROFILE_WRITE_RETRIES; attempt++) {
        try {
            await ddb.send(new DeleteItemCommand({
                TableName: USERS_TABLE,
                Key: marshall({ userId: usernameKey(username) }),
                ConditionExpression: "ownerId = :o",
                ExpressionAttributeValues: marshall({ ":o": ownerId }),
            }));
            return;
        } catch (e) {
            // 他人のものだった / 既に無い → 解放するものが無い（正常）
            if ((e as { name?: string }).name === "ConditionalCheckFailedException") return;
            if (attempt === PROFILE_WRITE_RETRIES) {
                console.error(`releaseUsername: gave up for ${usernameKey(username)} (owner ${ownerId}):`, e);
            }
        }
    }
}

async function getProfile(userId: string): Promise<UserProfile | null> {
    const res = await ddb.send(new GetItemCommand({
        TableName: USERS_TABLE,
        Key: marshall({ userId }),
    }));
    if (!res.Item) return null;
    return unmarshall(res.Item) as UserProfile;
}

/**
 * 自分のプロフィール行が無ければ作る（空でよい）。
 *
 * api/src/cognitoTrigger.ts の createProfileIfMissing と**対**。
 * あちらは登録直後の1回だけで、失敗しても登録は成功させる設計なので、
 * 行が無い人が残りうる。こちらは本人が自分のプロフィールを開くたびに
 * 効くので、取りこぼしを後から拾える。
 * 既にある行は絶対に上書きしない（attribute_not_exists）。
 */
async function createProfileIfMissing(userId: string): Promise<void> {
    try {
        await ddb.send(new PutItemCommand({
            TableName: USERS_TABLE,
            Item: marshall({ userId, createdAt: new Date().toISOString() }),
            ConditionExpression: "attribute_not_exists(userId)",
        }));
    } catch (e) {
        const name = (e as { name?: string }).name;
        if (name === "ConditionalCheckFailedException") return;   // 競合＝既にある
        console.error("createProfileIfMissing error:", e);
    }
}

/**
 * 消した写真をピン留めから外す。
 *
 * **写真を消してもピンの枠は空かなかった。** `applyPinOp` は上限(3)を
 * `pinnedPhotoIds` の配列長だけで数え、写真の実在は見ない。一方で画面
 * （UserProfileClient の orderedPhotos）は見つからないピンを黙って落とす。
 * その結果「3枚ピン留め → 1枚削除 → もう1枚留めようとすると 409
 * 『3枚までです』。でも画面には2枚しか出ていない」で詰む——解除ボタンは
 * 表示された写真にしか無く、増減方式なので消えたピンを外す手段が無い。
 * 退会はプロフィールごと消え、管理APIは他人のプロフィールを触らないので、
 * **本人の写真削除でだけ起きる**。
 *
 * 書き方は updateMyProfile と同じ rev 方式（新しい機構は作らない）。
 * 触るのは pinnedPhotoIds だけなので、他の項目を巻き込まない。
 * 戻り値は「気にすべき失敗があったか」。呼び出し側は**行を消す前に**
 * 呼び、落ちたら止めること（写真が消えたあとでは、やり直す手がかりが
 * 消えるため）。
 */
export async function removePinnedPhoto(userId: string, photoId: string): Promise<boolean> {
    try {
        for (let attempt = 0; attempt <= PROFILE_WRITE_RETRIES; attempt++) {
            const base = await getProfile(userId);
            // 行が無い / 墓石 / そもそも留めていない → やることが無い
            if (!base || isDeletedProfile(base)) return true;
            const cur = Array.isArray(base.pinnedPhotoIds)
                ? base.pinnedPhotoIds.filter((x): x is string => typeof x === "string")
                : [];
            if (!cur.includes(photoId)) return true;
            const next = cur.filter((id) => id !== photoId);
            const rev = typeof (base as { rev?: unknown }).rev === "number"
                ? (base as unknown as { rev: number }).rev : 0;
            const guard = rev === 0
                ? "attribute_not_exists(userId) OR attribute_not_exists(rev) OR rev = :rev"
                : "rev = :rev";
            const profile = {
                ...mergeProfile(base, userId, { pinnedPhotoIds: next.length > 0 ? next : undefined }),
                rev: rev + 1,
            };
            try {
                await ddb.send(new PutItemCommand({
                    TableName: USERS_TABLE,
                    Item: marshall(profile, { removeUndefinedValues: true }),
                    ConditionExpression: guard,
                    ExpressionAttributeValues: marshall({ ":rev": rev }),
                }));
                return true;
            } catch (e) {
                if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;
                // 競合。読み直して重ね直す（次の周回）
            }
        }
        console.error(`removePinnedPhoto: gave up for ${userId}/${photoId}`);
        return false;
    } catch (e) {
        console.error("removePinnedPhoto error:", e);
        return false;
    }
}

export const getMyProfile: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    // sub 欠落の "" で進むと userId="" のプロフィールを読み書きする
    // （notifications.ts と同じ話。E-5 の横展開でここだけ漏れていた）
    if (!userId) {
        return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "認証が必要です" }) };
    }
    try {
        const profile = await getProfile(userId);
        if (isDeletedProfile(profile)) {
            // 退会済み。行を作り直さない（作ると退会が取り消される）。
            // 410 Gone——「もう無い」であって、通信の失敗でも権限でもない。
            return { statusCode: 410, headers: JSON_HEADERS, body: JSON.stringify({ error: "このアカウントは削除されています" }) };
        }
        if (!profile) {
            // 行が無いまま放置しない。PostConfirmation トリガー
            // （api/src/cognitoTrigger.ts）は失敗しても登録を成功させるので、
            // 行が無い人が生まれる。その人は誰からもフォローできず
            // （follow.ts の実在判定）、本人にも直す手段が無かった。
            // 自分のプロフィールを開いた時点で作れば、そこから回復する。
            // ベストエフォート——失敗しても取得自体は返す。
            await createProfileIfMissing(userId);
        }
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(profile ?? { userId }) };
    } catch (e) {
        console.error("getMyProfile error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "取得に失敗しました" }) };
    }
};

/**
 * 保存済みのプロフィールに、今回指定された項目だけを重ねる。
 *
 * changes に載っているキーだけを触る。値が undefined なら消す。
 * 載っていない項目は既存のまま残す（送り忘れで消えないようにするのが目的）。
 */
export function mergeProfile(
    prev: UserProfile | null,
    userId: string,
    changes: Record<string, unknown>,
): UserProfile {
    const merged: Record<string, unknown> = { ...(prev ?? {}) };
    for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) delete merged[key];
        else merged[key] = value;
    }
    // userId は書き換えさせない。更新時刻は必ず今にする。
    merged.userId = userId;
    merged.updatedAt = new Date().toISOString();
    // 再生区間の整合はマージ後の姿で見る。ハンドラ側の検証は「今回
    // 送られてきた songStart」としか比べられないため、{ songUrl, songEnd }
    // だけ送ると保存済みの songStart=30 と組んで end <= start が保存できた
    // （終了が開始より前の区間は再生されない）。成立しない songEnd は落とす。
    if (typeof merged.songStart === "number" && typeof merged.songEnd === "number"
        && merged.songEnd <= merged.songStart) {
        delete merged.songEnd;
    }
    return merged as UserProfile;
}

export const updateMyProfile: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) {
        return { statusCode: 401, headers: JSON_HEADERS, body: JSON.stringify({ error: "認証が必要です" }) };
    }

    let body: {
        username?: unknown;
        displayName?: string; bio?: string; instagram?: string; website?: string;
        songUrl?: string; songStart?: number; songEnd?: number;
        songTitle?: string; songArtist?: string; songArtwork?: string; songPreviewUrl?: string; songTrackUrl?: string;
        tripTitles?: Record<string, string>;
        tripCovers?: Record<string, string>;
        tripSongs?: unknown;
        themeColor?: string; statusText?: string; pinnedPhotoIds?: string[];
        pinPhotoId?: unknown; pin?: unknown;
        songs?: unknown;
    };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const displayName = body.displayName?.trim().slice(0, 100) || undefined;
    const bio = body.bio?.trim().slice(0, 300) || undefined;
    const instagram = body.instagram?.trim().slice(0, 100) || undefined;
    const website = body.website?.trim().slice(0, 200) || undefined;

    // サイト内ユーザー名（@ハンドル）。形式・予約語を検証し、一意性は予約アイテムで担保する。
    //
    // 検証は「username を指定してきたとき」だけ行う。この API は部分更新なので、
    // キーが無いリクエスト（ピン留めだけ、表示名だけ）が普通に来る。
    // normalizeUsername は null と "" をクリアとして通す一方 undefined は
    // 「形式が不正」として弾くため、無条件に呼ぶとそれらが全部 400 になる。
    const hasUsernameKey = "username" in body;
    const { username, error: usernameError } = hasUsernameKey
        ? normalizeUsername(body.username)
        : {};
    if (usernameError) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: usernameError }) };
    }
    const songUrl = body.songUrl?.trim().slice(0, 500) || undefined;
    // 開始・終了位置は 0〜24時間(秒)の範囲に丸める。songUrl が無ければ無視。
    const clampSec = (v: unknown): number | undefined => {
        const n = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(n) || n <= 0) return undefined;
        return Math.min(Math.floor(n), 86400);
    };
    const songStart = songUrl ? clampSec(body.songStart) : undefined;
    const songEnd = songUrl ? clampSec(body.songEnd) : undefined;

    // アプリ内検索で選んだ曲。プレビュー音源・アートワークは Apple のホストのみ許可。
    //
    // ……とコメントには書いてあったが、実装は https かどうかしか見ていなかった。
    // プロフィールは未認証でも読めるので、任意のURLを1つ入れるだけで
    // 訪問者の IP を集められた。写真の thumbUrl で塞いだのと同じ穴。
    const songPreviewUrl = safeSongPreviewUrl(body.songPreviewUrl);
    const songArtwork = safeSongArtworkUrl(body.songArtwork);
    const songTrackUrl = safeSongTrackUrl(body.songTrackUrl);
    const songTitle = body.songTitle?.trim().slice(0, 200) || undefined;
    const songArtist = body.songArtist?.trim().slice(0, 200) || undefined;

    // マイBGMプレイリスト: 各曲 previewUrl(https) と title 必須・最大5曲
    let songs: SongEntry[] | undefined;
    // 全曲弾かれたときに「送られてきた件数」を覚えておく（0 は該当なし）。
    // 保存済みより少なければ削除の意思とみなす（下の prev 読み込み後）。
    let songsAllRejected = 0;
    // 形そのものが壊れている曲があったか（null・題名なし・音源URLなし）。
    // 「許可ホストでない」とは別に数える——前者はクライアントの不具合、
    // 後者は旧ルール時代のデータで、取るべき対応が正反対だから。
    let songsMalformed = false;
    if (Array.isArray(body.songs)) {
        const cleaned: SongEntry[] = [];
        for (const raw of body.songs.slice(0, 5)) {
            if (!raw || typeof raw !== "object") { songsMalformed = true; continue; }
            const o = raw as Record<string, unknown>;
            const title = typeof o.title === "string" ? o.title.trim().slice(0, 200) : "";
            const previewUrl = safeSongPreviewUrl(o.previewUrl);
            // 「旧ルール時代のデータ」と言えるのは、**ホストだけが許可外**のとき。
            // それ以外（題名が無い・URLでない・https でない）は形が壊れている
            // ＝クライアントの不具合なので、下で「触らない」に倒す。
            //
            // ここも一度間違えた。`if (!previewUrl) continue;` に落ちる経路が
            // 残っていたので、`previewUrl: "undefined"` や `http://...` のような
            // 壊れた文字列が「旧データ」として数えられ、有効な曲を3件持つ人の
            // プレイリストが黙って全部消えた（症状は {songs:[null,null]} と同じ）。
            if (!title || !isWellFormedHttpsUrl(o.previewUrl)) { songsMalformed = true; continue; }
            if (!previewUrl) continue;
            const artist = typeof o.artist === "string" ? o.artist.trim().slice(0, 200) : "";
            const artwork = safeSongArtworkUrl(o.artwork);
            const trackUrl = safeSongTrackUrl(o.trackUrl);
            cleaned.push({
                title,
                previewUrl,
                ...(artist ? { artist } : {}),
                ...(artwork ? { artwork } : {}),
                ...(trackUrl ? { trackUrl } : {}),
            });
        }
        // 全部弾かれたときの扱い。3つの場合を分ける。
        //
        // (a) 形が壊れている曲が混ざっていた → **何も触らない**。
        //     クライアントの不具合や古いバージョンなので、これを
        //     「消したい」と読むと有効な曲まで巻き添えになる。
        // (b) 全部が「許可ホストでない」だけ、かつ保存済みと同じ件数
        //     → 画面がそのまま送り返しただけ。触らない。
        //     （旧ルール時代の曲を持つ人が自己紹介文だけ直して保存すると
        //       これになる。触ると 200 を返しながらプレイリストが丸ごと
        //       消えていた——エラー表示も無く復旧不能。）
        // (c) 全部が「許可ホストでない」だけ、かつ件数が減っている
        //     → 消したい意思。空にする。
        //     （件数の比較には prev が要るので判断は下でする。）
        if (cleaned.length > 0) songs = cleaned;
        else if (body.songs.length === 0) songs = [];
        else if (!songsMalformed) songsAllRejected = body.songs.length;
    }

    // マイページのパーソナライズ
    const themeColor = typeof body.themeColor === "string" && /^#[0-9a-fA-F]{6}$/.test(body.themeColor.trim())
        ? body.themeColor.trim().toLowerCase()
        : undefined;
    const statusText = body.statusText?.trim().slice(0, 60) || undefined;
    let pinnedPhotoIds: string[] | undefined;
    if (Array.isArray(body.pinnedPhotoIds)) {
        const cleaned = body.pinnedPhotoIds
            .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
            .map((x) => x.trim().slice(0, 64));
        const uniq = Array.from(new Set(cleaned)).slice(0, 3);
        if (uniq.length > 0) pinnedPhotoIds = uniq;
    }

    /**
     * ピン留めは**1枚単位の増減**で受ける（`{ pinPhotoId, pin }`）。
     *
     * 配列まるごとの `pinnedPhotoIds` は rev では守れない。rev が防げるのは
     * 「この処理中に他の書き込みが割り込んだ」場合だけで、実際に起きるのは
     * **PC のタブを開きっぱなしにしたまま、スマホでピン留めする**——
     * 数時間後に PC 側で別の写真をピン留めすると、PC が開いた時点の
     * 配列（スマホの1枚を含まない）で丸ごと置き換わり、スマホの分が消える。
     * サーバーは新しい rev を普通に書けるので競合として検出されない。
     *
     * 増減で受け取れば、**その瞬間に読んだ配列**の上で足し引きできる。
     * follow.ts の updateFollowing と同じ「読んだものの上に重ねる」考え方。
     * 配列形式も残す（古いタブが読み込んだままの JS はそちらを送る）。
     */
    const pinPhotoId = typeof body.pinPhotoId === "string" && body.pinPhotoId.trim()
        ? body.pinPhotoId.trim().slice(0, 64)
        : undefined;
    if (pinPhotoId && typeof body.pin !== "boolean") {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }
    const pinOp = pinPhotoId ? { id: pinPhotoId, pin: body.pin === true } : undefined;
    const PIN_MAX = 3;
    /** 保存済みの配列に増減を重ねる。上限超過は null（呼び出し側が 409） */
    const applyPinOp = (stored: unknown): string[] | null => {
        const cur = Array.isArray(stored)
            ? stored.filter((x): x is string => typeof x === "string")
            : [];
        if (!pinOp) return cur;
        if (!pinOp.pin) return cur.filter((id) => id !== pinOp.id);
        if (cur.includes(pinOp.id)) return cur;          // 二度押しは冪等
        if (cur.length >= PIN_MAX) return null;
        return [...cur, pinOp.id];
    };

    // 旅アルバムのカスタム名/カバー: キーは trip-<epoch> 形式のみ・最大100件
    const sanitizeTripMap = (input: unknown, maxLen: number): Record<string, string> | undefined => {
        if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
        const entries = Object.entries(input as Record<string, unknown>)
            .filter(([k, v]) => /^trip-\d+$/.test(k) && typeof v === "string" && (v as string).trim())
            .slice(0, 100)
            .map(([k, v]) => [k, (v as string).trim().slice(0, maxLen)] as const);
        return entries.length > 0 ? Object.fromEntries(entries) : undefined;
    };
    const tripTitles = sanitizeTripMap(body.tripTitles, 80);
    const tripCovers = sanitizeTripMap(body.tripCovers, 64);

    // 旅アルバムのBGM: キーは trip-<epoch>、曲は songs と同じ検証（title + https preview 必須）
    let tripSongs: Record<string, SongEntry> | undefined;
    if (body.tripSongs && typeof body.tripSongs === "object" && !Array.isArray(body.tripSongs)) {
        const out: Record<string, SongEntry> = {};
        for (const [k, raw] of Object.entries(body.tripSongs as Record<string, unknown>).slice(0, 100)) {
            if (!/^trip-\d+$/.test(k) || !raw || typeof raw !== "object") continue;
            const o = raw as Record<string, unknown>;
            const previewUrl = safeSongPreviewUrl(o.previewUrl);
            const title = typeof o.title === "string" ? o.title.trim().slice(0, 200) : "";
            if (!previewUrl || !title) continue;
            const artist = typeof o.artist === "string" ? o.artist.trim().slice(0, 200) : "";
            const artwork = safeSongArtworkUrl(o.artwork);
            const trackUrl = safeSongTrackUrl(o.trackUrl);
            out[k] = {
                title,
                previewUrl,
                ...(artist ? { artist } : {}),
                ...(artwork ? { artwork } : {}),
                ...(trackUrl ? { trackUrl } : {}),
            };
        }
        // songs と同じ扱い。全部弾かれたときに「消す」と読まない。
        //
        // ※ 現時点で tripSongs を送るクライアントは無い（grep 済み。
        //   app/user/profile/page.tsx も UserProfileClient.tsx も型宣言だけで、
        //   送信本文には入れていない）。以前ここに「画面がそのまま送り返すので
        //   全部消えていた」と書いたが、それは songs の話で、こちらは誤り。
        //   つまりこれは実害の記録ではなく、songs と同じ形に揃えておく
        //   ——将来この口を使うときに同じ穴を踏まないための備え。
        //
        // なお songs にある「件数が減っていたら削除の意思」は付けていない。
        // 送る側がいないので確かめようがなく、確かめられない分岐を増やしても
        // 次に誰かが踏むだけになる。使うときに一緒に入れる。
        // 本当に消したいときは空オブジェクトが送られてくる。
        if (Object.keys(out).length > 0) tripSongs = out;
        else if (Object.keys(body.tripSongs as Record<string, unknown>).length === 0) tripSongs = {};
    }

    // 送られてきた項目だけを反映する（部分更新）。
    //
    // 以前はここで作った item をそのまま PutItem していた（全置換）。
    // そのため呼び出し側は毎回すべての項目を送り返す必要があり、1つでも
    // 書き漏らすとその項目が黙って消えた。実際に
    //  - 公開プロフィールAPIが返さなくなった旅アルバムとひとことが、
    //    写真をピン留めするだけで消える
    //  - プロフィール編集画面が statusText を送っておらず、保存すると消える
    // という2つの事故が起きている。呼び出し側の注意力に頼るのをやめる。
    //
    // **画面は今、逆に「変えた項目だけ」を送る**（8e2b424 / eb9b35e）。
    // 全項目を送っていると、rev があっても同じ項目を送った側が後勝ちして
    // 別タブの編集を巻き戻すため。部分更新はその前提でもある。
    //
    // 「body にキーがある」= その項目を指定した、という意味にする。
    // 値が空（サニタイズ後に undefined）なら消す、キーが無ければ触らない。
    // 既存の呼び出し側はクリア時に空文字を送っているのでそのまま動く。
    const changes: Record<string, unknown> = {};
    const apply = (key: string, addressed: boolean, value: unknown) => {
        if (addressed) changes[key] = value; // undefined は「消す」
    };
    apply("username", hasUsernameKey, username);
    apply("displayName", "displayName" in body, displayName);
    apply("bio", "bio" in body, bio);
    apply("instagram", "instagram" in body, instagram);
    apply("website", "website" in body, website);
    // 貼ったリンク（独立）
    apply("songUrl", "songUrl" in body, songUrl);
    // **songUrl を触らないリクエストでは、開始・終了位置も触らない。**
    // songStart は songUrl が無いと undefined に落ちる（曲なしの位置は
    // 意味を持たないため）。その状態で `"songStart" in body` だけを見て
    // apply すると、部分更新APIなのに `{ songStart: 30 }` だけ送った回で
    // **保存済みの songStart が消える**。曲を消す回（songUrl を空で送る）は
    // songUrl キーが body にあるので、位置も一緒に消える——それが正しい。
    const songTouched = "songUrl" in body;
    apply("songStart", songTouched && "songStart" in body, songStart);
    apply("songEnd", songTouched && "songEnd" in body, songEnd && (!songStart || songEnd > songStart) ? songEnd : undefined);
    // 検索で選んだ曲（独立）
    apply("songPreviewUrl", "songPreviewUrl" in body, songPreviewUrl);
    apply("songArtwork", "songArtwork" in body, songArtwork);
    apply("songTitle", "songTitle" in body, songTitle);
    apply("songArtist", "songArtist" in body, songArtist);
    apply("songTrackUrl", "songTrackUrl" in body, songTrackUrl);
    // songs の最終判断は prev を読んだあと（songsAllRejected の扱い）。
    //
    // 「触る」のは songs が決まったときだけ。上の (a)(b)——形が壊れている、
    // そのまま送り返された——では songs は undefined のままで、
    // ここを true にすると apply が「消す」と読んでしまう（実際に一度
    // そうなっていて、{songs:[null,null]} で有効な曲が全部消えた）。
    // 消したいときは必ず空配列が入る。
    let songsAddressed = songs !== undefined;
    apply("tripTitles", "tripTitles" in body, tripTitles);
    apply("tripCovers", "tripCovers" in body, tripCovers);
    // songs と同じく「決まったときだけ触る」。undefined のまま apply すると
    // mergeProfile が「消す」と読む。
    apply("tripSongs", tripSongs !== undefined, tripSongs);
    apply("themeColor", "themeColor" in body, themeColor);
    apply("statusText", "statusText" in body, statusText);
    // 増減（pinOp）で来たときは、**下の書き込みループが必ず上書きする**。
    // ここで `!pinOp &&` のガードを足したくなるが、効かないので置かない
    // （置くと「守っているつもりの死にコード」になる。実際に一度書いて、
    //  レビューで両方消しても全テストが通ることを実測された）。
    // 同じリクエストで配列と増減が両方来たら増減が勝つのは、その帰結。
    apply("pinnedPhotoIds", "pinnedPhotoIds" in body, pinnedPhotoIds);

    // この呼び出しで新しく押さえたユーザー名（失敗したら戻す）
    let usernameReserved: string | null = null;
    try {
        const prev = await getProfile(userId);
        if (isDeletedProfile(prev)) {
            // 読みだけでなく書きも塞ぐ。mergeProfile は prev が無ければ
            // 新しい姿を組むので、ここを通すと保存で行が生き返る。
            return { statusCode: 410, headers: JSON_HEADERS, body: JSON.stringify({ error: "このアカウントは削除されています" }) };
        }

        // 上の (c): 全部が「許可ホストでない」だけで、件数が減っている。
        //
        // 「保存済みが全部いまの規則で保存できない人だけ」に絞ったことがあるが、
        // それだと混ざっている人が消せなくなった。保存済みが
        // [Apple 1件, 旧ホスト2件] の人が Apple の曲だけ画面から消して保存すると、
        // 送られるのは旧ホスト2件で全部弾かれる。「保存済みに有効な曲がある」
        // ので触らない判断になり、200 を返しながら3件とも残っていた
        // ——まさに直そうとした「保存しましたと出るのに元どおり」の再発。
        // 形の壊れた曲は上で弾いてあるので、ここは件数だけを見てよい。
        if (songsAllRejected > 0) {
            const storedCount = Array.isArray(prev?.songs) ? prev.songs.length : 0;
            if (songsAllRejected < storedCount) {
                songs = [];
                songsAddressed = true;
            }
        }
        apply("songs", songsAddressed, songs);

        // ユーザー名の一意性を先に確保する（他人が使っていれば 409 で中断）。
        // 押さえた名前は控えておく。本体の保存が落ちたら戻す（下の catch）。
        if (hasUsernameKey && username && username !== prev?.username) {
            const ok = await reserveUsername(username, userId);
            if (!ok) {
                return { statusCode: 409, headers: JSON_HEADERS, body: JSON.stringify({ error: "そのユーザー名は既に使われています" }) };
            }
            usernameReserved = username;
        }

        // **同時保存で先の変更が消えないようにする。**
        //
        // 以前は「読む → 全置換 Put」を無条件でやっていた。書き手は2つある——
        // プロフィール編集画面（app/user/profile/page.tsx）と、ピン留め・
        // 旅アルバムの設定（app/users/UserProfileClient.tsx）。同時に走ると
        // 後勝ちで、先の変更が黙って消える。このファイルのコメントが挙げている
        // 過去2件の事故（「ピン留めするだけで旅アルバムとひとことが消える」）と
        // 症状が同じで、部分更新に直しても競合経路が残っていた。
        //
        // follow.ts の updateFollowing と同じ rev 方式。新しい機構は作らない。
        // 競合したら**読み直して、この呼び出しの changes を最新の上に重ねる**
        // ので、触っている項目が違えば両方残る。
        // 下のループが必ず1回は回って再代入する。pinOp の経路では
        // ここでの姿は**ピンを含まない**ので、この値のまま返してはいけない
        // （ループの前に早期 return を足すときは注意）。
        // 留める側は**入口で1回だけ**確かめる。ここを通さないと、開きっぱなしの
        // 古いタブが「もう無い写真」を留めて枠を永久に食い潰す。
        // 外す側は確かめない——消えた写真を外せなくなると、詰みが直せない。
        if (pinOp?.pin && !await isLivePhotoOf(pinOp.id, userId)) {
            if (usernameReserved) { await releaseUsername(usernameReserved, userId); }
            return {
                statusCode: 404,
                headers: JSON_HEADERS,
                body: JSON.stringify({ error: "その写真は見つかりません。すでに削除された可能性があります" }),
            };
        }
        let profile = mergeProfile(prev, userId, changes);
        let base = prev;
        let saved = false;
        let pinLimitHit = false;
        // 上限で断るときに返す「今の一覧」。これを返さないと、手元が
        // サーバーとずれているタブは断られ続けるだけで直せない。
        let pinLimitCurrent: string[] = [];
        for (let attempt = 0; attempt <= PROFILE_WRITE_RETRIES; attempt++) {
            // ピン留めの増減は、**いま読んだ配列**の上で決める。
            // 再試行のたびに base が新しくなるので、ここで組み直す。
            if (pinOp) {
                const storedPins = (base as { pinnedPhotoIds?: unknown } | null)?.pinnedPhotoIds;
                let nextPins = applyPinOp(storedPins);
                if (nextPins === null) {
                    // 上限に当たった。**断る前に、死んだピンを掃除する。**
                    // 既に枠を食い潰されている人はここでしか直せない
                    // （この確認を入れる前に消した写真のぶんが残っている）。
                    // 読むのは最大3件で、しかもこの稀な経路だけ。
                    const cur = Array.isArray(storedPins)
                        ? storedPins.filter((x): x is string => typeof x === "string")
                        : [];
                    const alive = await livePinnedIds(cur, userId);
                    nextPins = alive.length < cur.length ? applyPinOp(alive) : null;
                    if (nextPins === null) {
                        pinLimitHit = true;
                        pinLimitCurrent = alive;
                        break;
                    }
                }
                changes.pinnedPhotoIds = nextPins.length > 0 ? nextPins : undefined;
            }
            const rev = typeof (base as { rev?: unknown } | null)?.rev === "number"
                ? (base as unknown as { rev: number }).rev : 0;
            // rev を持たない既存データ（この仕組みを入れる前の item）も通す。
            // DynamoDB は値どうしの比較を許さないので、分岐は JS 側で作る。
            const guard = rev === 0
                ? "attribute_not_exists(userId) OR attribute_not_exists(rev) OR rev = :rev"
                : "rev = :rev";
            profile = { ...mergeProfile(base, userId, changes), rev: rev + 1 } as typeof profile;
            try {
                await ddb.send(new PutItemCommand({
                    TableName: USERS_TABLE,
                    Item: marshall(profile),
                    ConditionExpression: guard,
                    ExpressionAttributeValues: marshall({ ":rev": rev }),
                }));
                saved = true;
                break;
            } catch (e) {
                if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;
                base = await getProfile(userId);   // 競合。読み直して重ね直す
            }
        }
        if (pinLimitHit) {
            // 黙って落とさない。落とすと「ピン留めしました」と出て元どおりになる。
            // 予約だけ残さないのは下の !saved と同じ理由。
            if (usernameReserved) { await releaseUsername(usernameReserved, userId); }
            // 現在の一覧を添える。手元が古いまま断られ続けるのを断ち切る。
            return {
                statusCode: 409,
                headers: JSON_HEADERS,
                body: JSON.stringify({ error: "ピン留めは3枚までです", pinnedPhotoIds: pinLimitCurrent }),
            };
        }
        if (!saved) {
            // **諦めたことを黙って飲み込まない。** ここで 200 を返すと
            // 「保存しましたと出るのに元どおり」になる。
            // ユーザー名を新しく予約していたら、それも戻す（下と同じ理由）。
            if (hasUsernameKey && username && username !== prev?.username) {
                await releaseUsername(username, userId);
            }
            return { statusCode: 409, headers: JSON_HEADERS, body: JSON.stringify({ error: "他の変更と重なりました。もう一度お試しください" }) };
        }

        // 保存できたら古いユーザー名の予約を解放する（付け替え・クリア時）
        if (hasUsernameKey && prev?.username && prev.username !== username) {
            await releaseUsername(prev.username, userId);
        }
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(profile) };
    } catch (e) {
        // **予約だけ残さない。**
        //
        // ユーザー名の一意性は本体の保存より先に押さえる（他人に取られない
        // ため）。そのあと Put が落ちると、以前は `username#<handle>` の
        // 予約行だけが残っていた。本人は ownerId 一致で付け直せるが、そこで
        // **別の名前を選ぶと誰も取れないまま永久に残る**——releaseUsername は
        // 保存済みの旧名しか解放せず、退会の掃除もプロフィール行の username を
        // 見るので拾えない。
        if (usernameReserved) {
            await releaseUsername(usernameReserved, userId);
        }
        console.error("updateMyProfile error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "更新に失敗しました" }) };
    }
};

// 公開プロフィールとして返してよい項目だけを抜き出す。
// テーブルの中身をそのまま返すと、将来追加された内部用の項目まで公開されてしまう。
//
// 注意: ここから項目を外すと、その項目は「消える」。
// PUT /user/profile は全置換で、UserProfileClient はこの戻り値を編集元として
// そのまま送り返すため、返さなかった項目は保存時に body から欠け、
// DynamoDB から削除される。プロフィール画面に出るものは必ずここに含めること。
// （tripTitles / tripCovers / tripSongs / statusText を一度落として、
//   ピン留めするだけで旅アルバムとひとことが消える事故を起こしている）
/**
 * 曲まわりのURLは**返すときにも**確かめる。
 *
 * 書き込み側にホストの許可リストを入れたのは後からなので、それ以前に
 * 保存された外部URLはそのまま残っている。プロフィールは未認証でも読めて、
 * 音源は <audio preload="auto"> で先読みされ、アートワークは <img> で
 * 読み込まれる——つまり入口を塞いだだけでは、既存データが訪問者の IP を
 * 集め続ける。読む側でも落とせば、データの掃除も要らない。
 */
function withCheckedSongUrls(p: Partial<UserProfile>): Partial<UserProfile> {
    const cleanSong = (s: SongEntry): SongEntry | null => {
        const previewUrl = safeSongPreviewUrl(s?.previewUrl);
        if (!previewUrl || !s?.title) return null;
        return {
            ...s,
            previewUrl,
            ...(safeSongArtworkUrl(s.artwork) ? { artwork: safeSongArtworkUrl(s.artwork) } : { artwork: undefined }),
            ...(safeSongTrackUrl(s.trackUrl) ? { trackUrl: safeSongTrackUrl(s.trackUrl) } : { trackUrl: undefined }),
        } as SongEntry;
    };
    const trips = p.tripSongs
        ? Object.fromEntries(
            Object.entries(p.tripSongs)
                .map(([k, v]) => [k, cleanSong(v as SongEntry)])
                .filter(([, v]) => v !== null) as [string, SongEntry][])
        : undefined;
    return {
        ...p,
        songPreviewUrl: safeSongPreviewUrl(p.songPreviewUrl),
        songArtwork: safeSongArtworkUrl(p.songArtwork),
        songTrackUrl: safeSongTrackUrl(p.songTrackUrl),
        ...(Array.isArray(p.songs)
            ? { songs: p.songs.map(cleanSong).filter((x): x is SongEntry => x !== null) }
            : {}),
        ...(trips ? { tripSongs: trips } : {}),
    };
}

export function toPublicProfile(p: UserProfile): Partial<UserProfile> {
    const {
        userId, username, displayName, bio, instagram, website, themeColor,
        songUrl, songStart, songEnd, songTitle, songArtist, songArtwork,
        songPreviewUrl, songTrackUrl, songs, pinnedPhotoIds, updatedAt,
        tripTitles, tripCovers, tripSongs, statusText,
    } = p;
    return withCheckedSongUrls({
        userId, username, displayName, bio, instagram, website, themeColor,
        songUrl, songStart, songEnd, songTitle, songArtist, songArtwork,
        songPreviewUrl, songTrackUrl, songs, pinnedPhotoIds, updatedAt,
        tripTitles, tripCovers, tripSongs, statusText,
    });
}

export const getPublicProfile: APIGatewayProxyHandlerV2 = async (event) => {
    const userId = event.pathParameters?.userId;
    if (!userId) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "userIdが必要です" }) };
    }
    // ユーザー名の予約アイテム（username#<handle>）は引かせない。
    // 予約行の中身（ownerId・作成時刻）を公開APIから読ませないため。
    // userSearch.ts も予約アイテムを結果から除外している。
    //
    // ※ 以前ここには「引けると @ハンドル から Cognito の内部ID が辿れて
    //   しまう」と書いてあったが、**それは辿れる**——`GET /users/search?q=<handle>`
    //   （未認証）が同じことをするし、`/users/<sub>` は公開の静的ページで、
    //   `photos.json` にも `userId` が載る。sub は秘密ではない。
    //   このコメントを信じて「ハンドルから sub は辿れない」を前提に何かを
    //   設計すると誤る。
    if (userId.includes("#")) {
        return { statusCode: 404, headers: JSON_HEADERS, body: JSON.stringify({ error: "見つかりません" }) };
    }
    try {
        const profile = await getProfile(userId);
        // 墓石は「未設定の人」と同じ見え方にする。toPublicProfile に
        // 通しても今は何も漏れないが、項目が増えたときに漏れうるので
        // ここで止める。
        if (!profile || isDeletedProfile(profile)) {
            return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ userId }) };
        }
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(toPublicProfile(profile)) };
    } catch (e) {
        console.error("getPublicProfile error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "取得に失敗しました" }) };
    }
};
