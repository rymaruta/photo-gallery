import {
    ScanCommand,
    GetCommand,
    PutCommand,
    UpdateCommand,
    DeleteCommand,
    QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { ddb } from "./dynamodb";
import type { Photo } from "./types";

const TABLE = process.env.PHOTOS_TABLE ?? "prod-photo-gallery-photos";
const USER_INDEX = "userId-createdAt-index";

export async function listPhotos(): Promise<Photo[]> {
    const items: Photo[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
        const res = await ddb.send(new ScanCommand({
            TableName: TABLE,
            ExclusiveStartKey: lastKey,
        }));
        items.push(...((res.Items ?? []) as Photo[]));
        lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    // 作成日時の新しい順に並べる
    return items.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export async function getPhotoById(id: string): Promise<Photo | null> {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { id } }));
    return (res.Item as Photo | undefined) ?? null;
}

export async function putPhoto(photo: Photo): Promise<void> {
    await ddb.send(new PutCommand({ TableName: TABLE, Item: photo }));
}

export async function updatePhotoFields(id: string, updates: Record<string, unknown>): Promise<Photo | null> {
    const setExprs = Object.keys(updates).map((k) => `#${k} = :${k}`).join(", ");
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
        names[`#${k}`] = k;
        values[`:${k}`] = v;
    }
    const res = await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { id },
        UpdateExpression: `SET ${setExprs}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: "attribute_exists(id)",
        ReturnValues: "ALL_NEW",
    }));
    return (res.Attributes as Photo | undefined) ?? null;
}

export async function deletePhotoById(id: string): Promise<void> {
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { id } }));
}

export async function countUserPhotos(userId: string): Promise<number> {
    const res = await ddb.send(new QueryCommand({
        TableName: TABLE,
        IndexName: USER_INDEX,
        KeyConditionExpression: "userId = :uid",
        ExpressionAttributeValues: { ":uid": userId },
        Select: "COUNT",
    }));
    return res.Count ?? 0;
}
