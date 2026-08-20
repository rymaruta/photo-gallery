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
            // 未公開写真を除外し、写真以外の管理レコードも除外する。
            // このテーブルには写真のほかに like#/go# マーカーや golist#/notifs# 文書が
            // 同居しており、それらには published が無いため published 条件だけでは素通りする。
            // 写真は必ず src を持つので attribute_exists(src) で写真だけに絞る。
            FilterExpression: "(attribute_not_exists(published) OR published = :pub) AND attribute_exists(src)",
            ExpressionAttributeValues: { ":pub": true },
        }));
        items.push(...((res.Items ?? []) as Photo[]));
        lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return items.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/**
 * 下書き（published:false）も含めた全写真。管理画面専用。
 *
 * 公開APIは下書きを隠すため、管理画面が公開APIだけを見ていると
 * 「非公開にした瞬間に管理画面からも消えて、二度と戻せない」状態になっていた
 * （他人の写真を非公開にすると AWS コンソール以外に復旧手段が無かった）。
 * ストーリーは管理対象ではないので除く。
 */
export async function listAllPhotosForAdmin(): Promise<Photo[]> {
    const items: Photo[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
        const res = await ddb.send(new ScanCommand({
            TableName: TABLE,
            ExclusiveStartKey: lastKey,
            // published は見ない（下書きも欲しい）。写真以外のレコードだけ除く。
            FilterExpression: "attribute_exists(src) AND attribute_not_exists(story)",
        }));
        items.push(...((res.Items ?? []) as Photo[]));
        lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
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

export async function listPhotosByUser(userId: string): Promise<Photo[]> {
    const items: Photo[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
        const res = await ddb.send(new QueryCommand({
            TableName: TABLE,
            IndexName: USER_INDEX,
            KeyConditionExpression: "userId = :uid",
            FilterExpression: "(attribute_not_exists(published) OR published = :pub) AND attribute_exists(src)",
            ExpressionAttributeValues: { ":uid": userId, ":pub": true },
            ExclusiveStartKey: lastKey,
        }));
        items.push(...((res.Items ?? []) as Photo[]));
        lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return items.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}
