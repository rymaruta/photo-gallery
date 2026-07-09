import type { APIGatewayProxyHandlerV2WithJWTAuthorizer, APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
const USERS_TABLE = process.env.USERS_TABLE ?? "prod-photo-gallery-users";
import { JSON_HEADERS, getUserId } from "./http";

export type SongEntry = {
    title: string;
    artist?: string;
    artwork?: string;
    previewUrl: string;
    trackUrl?: string;
};

export type UserProfile = {
    userId: string;
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
    ranking?: { title?: string; items: string[] };
    // マイページのパーソナライズ
    themeColor?: string;          // #rrggbb（アバターリング等のアクセント色）
    statusText?: string;          // 名前の下に出る「ひとこと」（絵文字OK・60文字）
    pinnedPhotoIds?: string[];    // ピン留め（投稿タブ先頭に固定・最大3枚）
    updatedAt?: string;
};

async function getProfile(userId: string): Promise<UserProfile | null> {
    const res = await ddb.send(new GetItemCommand({
        TableName: USERS_TABLE,
        Key: marshall({ userId }),
    }));
    if (!res.Item) return null;
    return unmarshall(res.Item) as UserProfile;
}

export const getMyProfile: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    try {
        const profile = await getProfile(userId);
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(profile ?? { userId }) };
    } catch (e) {
        console.error("getMyProfile error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "取得に失敗しました" }) };
    }
};

export const updateMyProfile: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);

    let body: {
        displayName?: string; bio?: string; instagram?: string; website?: string;
        songUrl?: string; songStart?: number; songEnd?: number;
        songTitle?: string; songArtist?: string; songArtwork?: string; songPreviewUrl?: string; songTrackUrl?: string;
        tripTitles?: Record<string, string>;
        tripCovers?: Record<string, string>;
        tripSongs?: unknown;
        themeColor?: string; statusText?: string; pinnedPhotoIds?: string[];
        songs?: unknown; ranking?: unknown;
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
    const httpsOnly = (v: string | undefined, max: number): string | undefined => {
        const s = v?.trim().slice(0, max);
        return s && /^https:\/\//.test(s) ? s : undefined;
    };
    const songPreviewUrl = httpsOnly(body.songPreviewUrl, 500);
    const songArtwork = httpsOnly(body.songArtwork, 500);
    const songTrackUrl = httpsOnly(body.songTrackUrl, 500);
    const songTitle = body.songTitle?.trim().slice(0, 200) || undefined;
    const songArtist = body.songArtist?.trim().slice(0, 200) || undefined;

    // マイBGMプレイリスト: 各曲 previewUrl(https) と title 必須・最大5曲
    let songs: SongEntry[] | undefined;
    if (Array.isArray(body.songs)) {
        const cleaned: SongEntry[] = [];
        for (const raw of body.songs.slice(0, 5)) {
            if (!raw || typeof raw !== "object") continue;
            const o = raw as Record<string, unknown>;
            const previewUrl = httpsOnly(typeof o.previewUrl === "string" ? o.previewUrl : undefined, 500);
            const title = typeof o.title === "string" ? o.title.trim().slice(0, 200) : "";
            if (!previewUrl || !title) continue;
            const artist = typeof o.artist === "string" ? o.artist.trim().slice(0, 200) : "";
            const artwork = httpsOnly(typeof o.artwork === "string" ? o.artwork : undefined, 500);
            const trackUrl = httpsOnly(typeof o.trackUrl === "string" ? o.trackUrl : undefined, 500);
            cleaned.push({
                title,
                previewUrl,
                ...(artist ? { artist } : {}),
                ...(artwork ? { artwork } : {}),
                ...(trackUrl ? { trackUrl } : {}),
            });
        }
        if (cleaned.length > 0) songs = cleaned;
    }

    // マイランキング: タイトル40文字・項目は最大5件・各60文字
    let ranking: { title?: string; items: string[] } | undefined;
    if (body.ranking && typeof body.ranking === "object" && !Array.isArray(body.ranking)) {
        const r = body.ranking as { title?: unknown; items?: unknown };
        const items = Array.isArray(r.items)
            ? r.items
                .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
                .map((x) => x.trim().slice(0, 60))
                .slice(0, 5)
            : [];
        const title = typeof r.title === "string" ? r.title.trim().slice(0, 40) : "";
        if (items.length > 0) ranking = { ...(title ? { title } : {}), items };
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
            const previewUrl = httpsOnly(typeof o.previewUrl === "string" ? o.previewUrl : undefined, 500);
            const title = typeof o.title === "string" ? o.title.trim().slice(0, 200) : "";
            if (!previewUrl || !title) continue;
            const artist = typeof o.artist === "string" ? o.artist.trim().slice(0, 200) : "";
            const artwork = httpsOnly(typeof o.artwork === "string" ? o.artwork : undefined, 500);
            const trackUrl = httpsOnly(typeof o.trackUrl === "string" ? o.trackUrl : undefined, 500);
            out[k] = {
                title,
                previewUrl,
                ...(artist ? { artist } : {}),
                ...(artwork ? { artwork } : {}),
                ...(trackUrl ? { trackUrl } : {}),
            };
        }
        if (Object.keys(out).length > 0) tripSongs = out;
    }

    const profile: UserProfile = {
        userId,
        ...(displayName ? { displayName } : {}),
        ...(bio ? { bio } : {}),
        ...(instagram ? { instagram } : {}),
        ...(website ? { website } : {}),
        // 貼ったリンク（独立）
        ...(songUrl ? { songUrl } : {}),
        ...(songStart ? { songStart } : {}),
        ...(songEnd && (!songStart || songEnd > songStart) ? { songEnd } : {}),
        // 検索で選んだ曲（独立）
        ...(songPreviewUrl ? { songPreviewUrl } : {}),
        ...(songArtwork ? { songArtwork } : {}),
        ...(songTitle ? { songTitle } : {}),
        ...(songArtist ? { songArtist } : {}),
        ...(songTrackUrl ? { songTrackUrl } : {}),
        ...(songs ? { songs } : {}),
        ...(ranking ? { ranking } : {}),
        ...(tripTitles ? { tripTitles } : {}),
        ...(tripCovers ? { tripCovers } : {}),
        ...(tripSongs ? { tripSongs } : {}),
        ...(themeColor ? { themeColor } : {}),
        ...(statusText ? { statusText } : {}),
        ...(pinnedPhotoIds ? { pinnedPhotoIds } : {}),
        updatedAt: new Date().toISOString(),
    };

    try {
        await ddb.send(new PutItemCommand({
            TableName: USERS_TABLE,
            Item: marshall(profile),
        }));
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(profile) };
    } catch (e) {
        console.error("updateMyProfile error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "更新に失敗しました" }) };
    }
};

export const getPublicProfile: APIGatewayProxyHandlerV2 = async (event) => {
    const userId = event.pathParameters?.userId;
    if (!userId) {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "userIdが必要です" }) };
    }
    try {
        const profile = await getProfile(userId);
        if (!profile) return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ userId }) };
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(profile) };
    } catch (e) {
        console.error("getPublicProfile error:", e);
        return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: "取得に失敗しました" }) };
    }
};
