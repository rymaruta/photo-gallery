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
import { requireEnv } from "./env";

const TABLE = requireEnv("PHOTOS_TABLE");
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
            //
            // ストーリーも除く。ストーリーは src と userId を持ち published:false で
            // 保存されるので、何かの拍子に published:true になると
            // （実際に PUT /photos/{id} から書けた）そのまま公開一覧に出て、
            // photos.json に載り、静的ページとサイトマップの項目までできた。
            // 24時間後の掃除は実体しか消さないので、壊れたページが残る。
            // ハンドラ側でも弾いているが、ここでも保証する。
            FilterExpression: "(attribute_not_exists(published) OR published = :pub) AND attribute_exists(src) AND attribute_not_exists(story)",
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
    // 新規作成専用。条件を付けないと、同じIDの既存レコードを丸ごと置き換える。
    // このテーブルには通知（notifs#...）やコメント（comments#...）も同居しているので、
    // ID を指定できるだけで他人の通知を全部消せてしまう（元に戻せない）。
    // 更新は updatePhotoFields を使うこと。
    await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: photo,
        ConditionExpression: "attribute_not_exists(id)",
    }));
}

export async function updatePhotoFields(id: string, updates: Record<string, unknown>): Promise<Photo | null> {
    // undefined は「その項目を空にする」指定。SET に混ぜてはいけない。
    //
    // DocumentClient は removeUndefinedValues: true なので、
    // ExpressionAttributeValues から :location ごと落ちる。式には
    // `SET #location = :location` が残るため DynamoDB は ValidationException を
    // 返し、ハンドラは 500 になる——つまり /admin/edit で撮影地や説明を
    // 空にして保存すると、必ず「更新に失敗しました」になっていた。
    // ユーザーAPI側（api-user/src/photoUpdate.ts）は REMOVE を組み立てている。
    const sets: string[] = [];
    const removes: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
        names[`#${k}`] = k;
        if (v === undefined || v === null) {
            removes.push(`#${k}`);
        } else {
            sets.push(`#${k} = :${k}`);
            values[`:${k}`] = v;
        }
    }
    if (sets.length === 0 && removes.length === 0) return getPhotoById(id);
    let expr = sets.length ? `SET ${sets.join(", ")}` : "";
    if (removes.length) expr += `${expr ? " " : ""}REMOVE ${removes.join(", ")}`;
    const res = await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { id },
        UpdateExpression: expr,
        ExpressionAttributeNames: names,
        ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
        ConditionExpression: "attribute_exists(id)",
        ReturnValues: "ALL_NEW",
    }));
    return (res.Attributes as Photo | undefined) ?? null;
}

/**
 * 写真そのものと、その写真にぶら下がる文書を消す。
 *
 * 以前は写真の item だけを消していた。コメントは写真ごとに
 * `comments#<photoId>` という別文書に溜まっており、そちらが残るので、
 * **写真を消してもコメント本文・投稿者名・投稿者IDが誰でも読めるまま**
 * だった（一覧APIは公開で、写真の存在確認もしていない）。
 * 「不適切なコメントが付いたので写真を消してほしい」に応えられていない。
 *
 * いいねマーカー（like#<photoId>#<uid>）は per-photo に引く手段が無く、
 * 全件 Scan が要るので今回は対象外。中身を持たないので実害は軽い。
 */
export async function deletePhotoById(id: string): Promise<void> {
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { id } }));
    try {
        await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { id: `comments#${id}` } }));
    } catch (e) {
        // 写真本体は消えているので、ここで失敗しても全体は失敗にしない
        console.error(`deletePhotoById: comments#${id} の削除に失敗:`, e);
    }
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
            // listPhotos と同じ条件。ストーリーもここから出さない
            FilterExpression: "(attribute_not_exists(published) OR published = :pub) AND attribute_exists(src) AND attribute_not_exists(story)",
            ExpressionAttributeValues: { ":uid": userId, ":pub": true },
            ExclusiveStartKey: lastKey,
        }));
        items.push(...((res.Items ?? []) as Photo[]));
        lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return items.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}
