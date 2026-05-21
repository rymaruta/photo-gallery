import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE, USER_INDEX } from "./dynamodb";
import type { Photo } from "./types";

export async function putPhoto(photo: Photo): Promise<void> {
    await ddb.send(new PutCommand({ TableName: PHOTOS_TABLE, Item: photo }));
}

export async function countUserPhotos(userId: string): Promise<number> {
    const res = await ddb.send(new QueryCommand({
        TableName: PHOTOS_TABLE,
        IndexName: USER_INDEX,
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: { ":uid": userId },
        Select: "COUNT",
    }));
    return res.Count ?? 0;
}
