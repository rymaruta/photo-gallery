import type { APIGatewayProxyHandlerV2, APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { PutCommand, DeleteCommand, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { notifsId, pushNotification, lookupDisplayName, type Notif } from "./notify";

// 「行く」= いいねの上位互換となる本アプリの中核メカニクス。
//   1. 誰かの写真に「行く」を押す → 行きたいリストに入る（goマーカー + golist文書）
//   2. 後日その場所の近くで写真を投稿すると「行った」が成立
//   3. 元の写真の投稿者に「あなたの写真が◯◯さんを旅立たせました」通知が届き、
//      写真の movedCount（動かした人数）が増える
//
// ストレージ（すべて PHOTOS_TABLE・単一キー id で完結、GSI は汚さない）:
//   - "go#<photoId>#<uid>"   … 二重防止マーカー
//   - "golist#<uid>"         … 行きたいリスト文書 { list: GoEntry[] }
//   - "notifs#<uid>"         … 通知文書 { items: Notif[], unread: number }
//   - 写真 item の goCount / movedCount … 集計値

export type GoEntry = {
    photoId: string;
    src: string;
    title?: unknown;
    location?: string;
    coords?: { lat: number; lng: number };
    ownerId?: string;
    t: string;              // 「行く」を押した日時
    fulfilled?: boolean;    // 行った！
    fulfilledAt?: string;
};

const GOLIST_MAX = 200;
const NOTIFS_MAX = 50;
const FULFILL_RADIUS_KM = 30;

const golistId = (uid: string) => `golist#${uid}`;
const markerId = (photoId: string, uid: string) => `go#${photoId}#${uid}`;

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 「行った」成立判定: 座標が近い、または地名テキストが重なる */
export function goMatches(
    entry: { coords?: { lat: number; lng: number }; location?: string },
    photo: { coords?: { lat: number; lng: number }; location?: string },
): boolean {
    if (entry.coords && photo.coords) {
        if (haversineKm(entry.coords, photo.coords) <= FULFILL_RADIUS_KM) return true;
    }
    const a = (entry.location ?? "").trim().toLowerCase();
    const b = (photo.location ?? "").trim().toLowerCase();
    if (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a))) return true;
    return false;
}

async function readGoList(uid: string): Promise<GoEntry[]> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: golistId(uid) } }));
    const list = res.Item?.list;
    return Array.isArray(list) ? (list as GoEntry[]) : [];
}

async function writeGoList(uid: string, list: GoEntry[]): Promise<void> {
    await ddb.send(new PutCommand({
        TableName: PHOTOS_TABLE,
        Item: { id: golistId(uid), uid, list: list.slice(0, GOLIST_MAX), updatedAt: new Date().toISOString() },
    }));
}

async function readCounters(photoId: string): Promise<{ goCount: number; moved: number }> {
    const res = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: photoId },
        ProjectionExpression: "goCount, movedCount",
    }));
    const g = res.Item?.goCount;
    const m = res.Item?.movedCount;
    return {
        goCount: typeof g === "number" && g > 0 ? g : 0,
        moved: typeof m === "number" && m > 0 ? m : 0,
    };
}

// GET /photos/{id}/go — 「行く」数と「動かした」数（公開）
export const getGoStatus: APIGatewayProxyHandlerV2 = async (event) => {
    const photoId = event.pathParameters?.id;
    if (!photoId) return jsonError(400, "IDが必要です");
    try {
        return {
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "public, s-maxage=30" },
            body: JSON.stringify(await readCounters(photoId)),
        };
    } catch (e) {
        console.error("getGoStatus error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

// POST /photos/{id}/go — 行きたい（認証必要・冪等）
export const goPhoto: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    const photoId = event.pathParameters?.id;
    if (!uid || !photoId) return jsonError(400, "不正なリクエスト");

    try {
        // 対象写真のスナップショット（成立判定・リスト表示・通知に使う）
        const photoRes = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: photoId } }));
        const photo = photoRes.Item as (GoEntry & { id: string; userId?: string; src?: string; thumbSrc?: string; title?: unknown }) | undefined;
        if (!photo || !photo.src) return jsonError(404, "写真が見つかりません");

        // マーカー（既にあれば冪等リターン）
        try {
            await ddb.send(new PutCommand({
                TableName: PHOTOS_TABLE,
                Item: { id: markerId(photoId, uid), go: true, photoId, uid, createdAt: new Date().toISOString() },
                ConditionExpression: "attribute_not_exists(id)",
            }));
        } catch (e) {
            if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
                return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ going: true, ...(await readCounters(photoId)) }) };
            }
            throw e;
        }

        // goCount +1
        const upd = await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: photoId },
            UpdateExpression: "SET goCount = if_not_exists(goCount, :z) + :one",
            ExpressionAttributeValues: { ":z": 0, ":one": 1 },
            ReturnValues: "UPDATED_NEW",
        }));

        // 行きたいリストに追加（先頭）
        const list = await readGoList(uid);
        if (!list.some((x) => x.photoId === photoId)) {
            list.unshift({
                photoId,
                src: String(photo.src),
                ...(photo.title !== undefined ? { title: photo.title } : {}),
                ...(photo.location ? { location: photo.location } : {}),
                ...(photo.coords ? { coords: photo.coords } : {}),
                ...(photo.userId ? { ownerId: String(photo.userId) } : {}),
                t: new Date().toISOString(),
            });
            await writeGoList(uid, list);
        }

        // 投稿者へ「行きたいリストに追加されました」通知（自分の写真は除く）
        const owner = photo.userId ? String(photo.userId) : undefined;
        if (owner && owner !== uid) {
            await pushNotification(owner, {
                type: "go",
                photoId,
                photoSrc: String(photo.thumbSrc ?? photo.src),
                byName: await lookupDisplayName(uid),
                ...(photo.location ? { atLocation: photo.location } : {}),
                t: new Date().toISOString(),
            });
        }

        const goCount = (upd.Attributes?.goCount as number | undefined) ?? 1;
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ going: true, goCount }) };
    } catch (e) {
        console.error("goPhoto error:", e);
        return jsonError(500, "保存に失敗しました");
    }
};

// DELETE /photos/{id}/go — 行きたい解除（認証必要・冪等）
export const ungoPhoto: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    const photoId = event.pathParameters?.id;
    if (!uid || !photoId) return jsonError(400, "不正なリクエスト");

    try {
        try {
            await ddb.send(new DeleteCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: markerId(photoId, uid) },
                ConditionExpression: "attribute_exists(id)",
            }));
        } catch (e) {
            if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
                return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ going: false, ...(await readCounters(photoId)) }) };
            }
            throw e;
        }

        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: photoId },
            UpdateExpression: "SET goCount = goCount - :one",
            ConditionExpression: "attribute_exists(id) AND goCount > :z",
            ExpressionAttributeValues: { ":z": 0, ":one": 1 },
        })).catch(() => { /* カウンタ0や写真消滅は無視 */ });

        const list = await readGoList(uid);
        const next = list.filter((x) => x.photoId !== photoId);
        if (next.length !== list.length) await writeGoList(uid, next);

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ going: false, ...(await readCounters(photoId)) }) };
    } catch (e) {
        console.error("ungoPhoto error:", e);
        return jsonError(500, "解除に失敗しました");
    }
};

// GET /user/go — 自分の行きたいリスト（認証必要）
export const getMyGoList: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    try {
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ items: await readGoList(uid) }) };
    } catch (e) {
        console.error("getMyGoList error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

// GET /user/notifications — 通知一覧（認証必要）
export const getNotifications: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    try {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: notifsId(uid) } }));
        // 書き込みは list_append の追記のみなので、上限の切り詰めは取得時に行う
        const items = (Array.isArray(res.Item?.items) ? res.Item.items : []).slice(0, NOTIFS_MAX);
        const unread = typeof res.Item?.unread === "number" ? res.Item.unread : 0;
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ items, unread }) };
    } catch (e) {
        console.error("getNotifications error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

// PUT /user/notifications — 既読化（認証必要）
export const readNotifications: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: notifsId(uid) },
            UpdateExpression: "SET unread = :z",
            ConditionExpression: "attribute_exists(id)",
            ExpressionAttributeValues: { ":z": 0 },
        })).catch((e) => {
            if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;
        });
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };
    } catch (e) {
        console.error("readNotifications error:", e);
        return jsonError(500, "更新に失敗しました");
    }
};

/**
 * 写真アップロード時に呼ぶ「行った」成立判定。
 * アップローダーの行きたいリストのうち、今回の写真の場所と一致する未成立エントリを成立させ、
 * 元写真の movedCount を増やし、元写真の投稿者へ通知を積む。成立数を返す。
 */
export async function checkGoFulfillment(
    uid: string,
    photo: { id: string; coords?: { lat: number; lng: number }; location?: string },
    byName?: string,
): Promise<number> {
    const list = await readGoList(uid);
    if (list.length === 0) return 0;

    const now = new Date().toISOString();
    let fulfilled = 0;

    for (const entry of list) {
        if (fulfilled >= 5) break; // 1回の投稿で成立させる上限
        if (entry.fulfilled) continue;
        if (!goMatches(entry, photo)) continue;

        entry.fulfilled = true;
        entry.fulfilledAt = now;
        fulfilled++;

        // 元写真の movedCount +1
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: entry.photoId },
            UpdateExpression: "SET movedCount = if_not_exists(movedCount, :z) + :one",
            ConditionExpression: "attribute_exists(id)",
            ExpressionAttributeValues: { ":z": 0, ":one": 1 },
        })).catch(() => { /* 元写真が削除済みなら数えない */ });

        // 元写真の投稿者に通知（自分自身の写真は除く）
        if (entry.ownerId && entry.ownerId !== uid) {
            const notif: Notif = {
                type: "inspired",
                photoId: entry.photoId,
                photoSrc: entry.src,
                byName: (byName ?? "").trim() || "旅人",
                ...(entry.location ? { atLocation: entry.location } : {}),
                t: now,
            };
            await pushNotification(entry.ownerId, notif);
        }
    }

    if (fulfilled > 0) await writeGoList(uid, list);
    return fulfilled;
}
