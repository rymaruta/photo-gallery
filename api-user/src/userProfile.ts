import type { APIGatewayProxyHandlerV2WithJWTAuthorizer, APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
const USERS_TABLE = process.env.USERS_TABLE ?? "prod-photo-gallery-users";
import { JSON_HEADERS, getUserId } from "./http";

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
