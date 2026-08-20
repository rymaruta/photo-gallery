import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE, USER_INDEX } from "./dynamodb";
import type { Photo } from "./types";

/**
 * 新規写真を保存する。既存の id には絶対に書き込まない。
 * このテーブルには写真以外（通知・コメント・フォロー関係）も同じキー空間に入っており、
 * 無条件の Put だと他人のレコードを丸ごと置き換えられてしまうため。
 * 既存写真の更新は photoUpdate.ts の UpdateCommand を使うこと。
 */
export async function putPhoto(photo: Photo): Promise<void> {
    await ddb.send(new PutCommand({
        TableName: PHOTOS_TABLE,
        Item: photo,
        ConditionExpression: "attribute_not_exists(id)",
    }));
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
            // ストーリーを除く。ストーリーも src と userId と published:false を
            // 持つので、これが無いと「下書き」として一覧に出る。そこから
            // 「公開する」を押すと永久の写真ページになり、24時間後の期限切れ
            // 掃除が実体だけ消して壊れたページが残った。
            FilterExpression: "attribute_exists(src) AND attribute_not_exists(story)",
            ExpressionAttributeValues: { ":uid": userId },
            ScanIndexForward: false, // createdAt ソートキーの降順（新しい順）
            ExclusiveStartKey: lastKey,
        }));
        items.push(...((res.Items ?? []) as Photo[]));
        lastKey = res.LastEvaluatedKey;
    } while (lastKey);
    return items;
}
