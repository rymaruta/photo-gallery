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

    let body: { displayName?: string; bio?: string; instagram?: string; website?: string };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: "不正なリクエスト" }) };
    }

    const displayName = body.displayName?.trim().slice(0, 100) || undefined;
    const bio = body.bio?.trim().slice(0, 300) || undefined;
    const instagram = body.instagram?.trim().slice(0, 100) || undefined;
    const website = body.website?.trim().slice(0, 200) || undefined;

    const profile: UserProfile = {
        userId,
        ...(displayName ? { displayName } : {}),
        ...(bio ? { bio } : {}),
        ...(instagram ? { instagram } : {}),
        ...(website ? { website } : {}),
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
