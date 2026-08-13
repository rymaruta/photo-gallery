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

// 自分の写真を新しい順で全件取得（下書き=非公開も含む）。
// 公開一覧と違い published フィルタを付けないのが肝（本人だけが自分の下書きを見られる）。
export async function listMyPhotos(userId: string): Promise<Photo[]> {
    const items: Photo[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
        const res = await ddb.send(new QueryCommand({
            TableName: PHOTOS_TABLE,
            IndexName: USER_INDEX,
            KeyConditionExpression: "userId = :uid",
            FilterExpression: "attribute_exists(src)",
            ExpressionAttributeValues: { ":uid": userId },
            ScanIndexForward: false, // createdAt ソートキーの降順（新しい順）
            ExclusiveStartKey: lastKey,
        }));
        items.push(...((res.Items ?? []) as Photo[]));
        lastKey = res.LastEvaluatedKey;
    } while (lastKey);
    return items;
}
