/**
 * 共同アルバム（案C）。作成・一覧・招待リンクの発行と取り消し・招待の閲覧。
 *
 * 判定は `invite.ts`（DynamoDB も HTTP も触らない層）に置いてある。
 * ここは「その判定を、実際の行に当てる」だけ。
 *
 * ## データの形（既存の `<種類>#…` の慣習に沿う）
 *
 *   album#<albumId>                  { ownerId, title, createdAt, memberCount, inviteToken?, inviteExpiresAt? }
 *   albums#<userId>                  { albumIds: [...] }        … その人が作った一覧
 *   albummember#<albumId>#<userId>   { albumId, userId, joinedAt }
 *   invite#<token>                   { albumId, createdBy, expiresAt, revoked? }
 *
 * ## 招待リンクは「アルバムに1本」
 *
 * 発行し直すと**前のリンクは取り消される**。理由は2つ:
 *   - 配ったリンクを数える必要が無くなる（行が無限に増えない）
 *   - 「前に配ったリンクがまだ生きている」を利用者が把握できる形にする
 * 取り消しは行を消さずに `revoked` を立てる——消すと、切れたリンクを開いた人に
 * 「取り消された」と「そもそも無い」の区別を返せない。
 */

import type { APIGatewayProxyHandlerV2WithJWTAuthorizer, APIGatewayProxyHandlerV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { sanitizeText } from "./sanitize";
import {
    newInviteToken, isValidInviteToken, inviteState, inviteRejection,
    inviteKey, albumKey, albumsOfUserKey, inviteExpiryFrom,
    ALBUMS_PER_USER, ALBUM_TITLE_MAX, MEMBERS_PER_ALBUM, PHOTOS_PER_ALBUM, INVITE_PREVIEW_PHOTOS,
    albumMemberKey, type InviteItem,
} from "./invite";

type AlbumItem = {
    id: string;
    photoIds?: unknown;
    ownerId?: string;
    title?: string;
    createdAt?: string;
    memberCount?: number;
    inviteToken?: string;
    inviteExpiresAt?: string;
};

async function getAlbum(albumId: string): Promise<AlbumItem | null> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: albumKey(albumId) } }));
    return (res.Item as AlbumItem | undefined) ?? null;
}

async function listOwnAlbumIds(userId: string): Promise<string[]> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: albumsOfUserKey(userId) } }));
    const ids = res.Item?.albumIds;
    return Array.isArray(ids) ? ids.filter((v): v is string => typeof v === "string") : [];
}

/** POST /albums — アルバムを作る */
export const createAlbum: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");

    let body: { title?: unknown };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return jsonError(400, "不正なリクエスト");
    }
    const title = sanitizeText(body.title, ALBUM_TITLE_MAX);
    if (!title) return jsonError(400, "アルバムの名前を入れてください");

    const existing = await listOwnAlbumIds(userId);
    // **上限は「作る前」に見る。** 作ってから一覧に入れられないと、
    // どこからも辿れないアルバムが残る
    if (existing.length >= ALBUMS_PER_USER) {
        return jsonError(403, `アルバムは${ALBUMS_PER_USER}個までです。使わないものを消してください`);
    }

    const albumId = randomUUID();
    const now = new Date().toISOString();
    const album: AlbumItem = { id: albumKey(albumId), ownerId: userId, title, createdAt: now, memberCount: 1 };
    await ddb.send(new PutCommand({
        TableName: PHOTOS_TABLE,
        Item: album,
        // 新規作成専用。同じキーの行を丸ごと置き換えない（putPhoto と同じ理由）
        ConditionExpression: "attribute_not_exists(id)",
    }));

    // 作った人はそのまま参加者。**アルバムを作ってから一覧に足す**
    // ——逆にすると、作成に失敗したときに存在しない ID が一覧に残る
    await ddb.send(new PutCommand({
        TableName: PHOTOS_TABLE,
        Item: { id: `albummember#${albumId}#${userId}`, albumId, userId, joinedAt: now },
    }));
    await ddb.send(new UpdateCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: albumsOfUserKey(userId) },
        UpdateExpression: "SET albumIds = list_append(if_not_exists(albumIds, :empty), :one)",
        ExpressionAttributeValues: { ":empty": [], ":one": [albumId] },
    }));

    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ album: { id: albumId, title, createdAt: now, memberCount: 1 } }) };
};

/** GET /albums — 自分が作ったアルバム */
export const listAlbums: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");

    const ids = await listOwnAlbumIds(userId);
    // **1件ずつ引く。** 数は ALBUMS_PER_USER で抑えてある。
    // 引けなかった行は落とす（消えたアルバムの ID が一覧に残っていても、
    // 画面に「開けない何か」を出さない）
    const albums = [];
    for (const id of ids) {
        const a = await getAlbum(id);
        if (!a || a.ownerId !== userId) continue;
        albums.push({
            id,
            title: a.title ?? "",
            createdAt: a.createdAt ?? "",
            memberCount: typeof a.memberCount === "number" ? a.memberCount : 1,
            inviteToken: a.inviteToken,
            inviteExpiresAt: a.inviteExpiresAt,
        });
    }
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ albums }) };
};

/** POST /albums/{id}/invite — 招待リンクを発行する（前のリンクは取り消す） */
export const createInvite: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");
    const albumId = event.pathParameters?.id;
    if (!albumId) return jsonError(400, "アルバムが指定されていません");

    const album = await getAlbum(albumId);
    // **持ち主でなければ「無い」と返す。** 403 だと、その ID のアルバムが
    // 実在することを教えてしまう
    if (!album || album.ownerId !== userId) return jsonError(404, "アルバムが見つかりません");

    const token = newInviteToken();
    const now = Date.now();
    const expiresAt = inviteExpiryFrom(now);
    await ddb.send(new PutCommand({
        TableName: PHOTOS_TABLE,
        Item: { id: inviteKey(token), albumId, createdBy: userId, createdAt: new Date(now).toISOString(), expiresAt },
        ConditionExpression: "attribute_not_exists(id)",
    }));

    // **前のリンクを取り消す。** 新しいのを配ったのに古いのが生きていると、
    // 「取り消したつもり」が効かない。行は消さずに印を立てる
    // （消すと「取り消された」と「そもそも無い」を返し分けられない）
    if (album.inviteToken && isValidInviteToken(album.inviteToken)) {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: inviteKey(album.inviteToken) },
            UpdateExpression: "SET revoked = :t",
            ConditionExpression: "attribute_exists(id)",
            ExpressionAttributeValues: { ":t": true },
        })).catch(() => undefined);
    }

    await ddb.send(new UpdateCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: albumKey(albumId) },
        UpdateExpression: "SET inviteToken = :t, inviteExpiresAt = :e",
        ConditionExpression: "attribute_exists(id) AND ownerId = :me",
        ExpressionAttributeValues: { ":t": token, ":e": expiresAt, ":me": userId },
    }));

    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ token, expiresAt }) };
};

/** DELETE /albums/{id}/invite — 招待リンクを取り消す */
export const revokeInvite: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");
    const albumId = event.pathParameters?.id;
    if (!albumId) return jsonError(400, "アルバムが指定されていません");

    const album = await getAlbum(albumId);
    if (!album || album.ownerId !== userId) return jsonError(404, "アルバムが見つかりません");
    // 既に無い場合も成功で返す（押し直しても同じ結果になる）
    if (!album.inviteToken) return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };

    if (isValidInviteToken(album.inviteToken)) {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: inviteKey(album.inviteToken) },
            UpdateExpression: "SET revoked = :t",
            ConditionExpression: "attribute_exists(id)",
            ExpressionAttributeValues: { ":t": true },
        })).catch(() => undefined);
    }
    await ddb.send(new UpdateCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: albumKey(albumId) },
        UpdateExpression: "REMOVE inviteToken, inviteExpiresAt",
        ConditionExpression: "attribute_exists(id) AND ownerId = :me",
        ExpressionAttributeValues: { ":me": userId },
    }));
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };
};

/**
 * GET /invites/{token} — 招待の中身（**未認証で読める**）。
 *
 * 開いた瞬間にログインを求めると拡散の輪がそこで切れるので、閲覧は誰でも。
 * 参加と投稿はログインが要る（S3）。
 *
 * **この口は `PublicReadRole`（`GetItem` だけ）で動く。** 招待の行と
 * アルバムの行を1回ずつ引くだけで済むよう、キーの形をそう決めてある。
 */
export const getInvite: APIGatewayProxyHandlerV2 = async (event) => {
    const token = event.pathParameters?.token;
    // **形を先に見る。** DynamoDB に投げる前に落とせば、未認証の口で
    // 無駄な読み取りを好きなだけ起こされない
    if (!isValidInviteToken(token)) {
        const r = inviteRejection("notfound");
        return jsonError(r.statusCode, r.error);
    }

    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: inviteKey(token) } }));
    const invite = (res.Item as InviteItem | undefined) ?? null;
    const state = inviteState(invite, Date.now());
    if (state !== "ok") {
        const r = inviteRejection(state);
        return jsonError(r.statusCode, r.error);
    }

    const album = await getAlbum(invite!.albumId!);
    if (!album) {
        // 招待は生きているのにアルバムが無い＝掃除の取りこぼし。
        // 利用者には同じ「見つかりません」を返す
        const r = inviteRejection("notfound");
        return jsonError(r.statusCode, r.error);
    }

    // **写真は新しい順に、決まった数だけ返す。**
    // この口は `PublicReadRole`（写真テーブルは GetItem のみ）で動くので
    // Query が使えない——アルバムの行が持つ ID を1件ずつ引く。
    // 全部引くと写真500枚で GetItem 500回になるので、**上限で切る**。
    const ids = Array.isArray(album.photoIds)
        ? album.photoIds.filter((v): v is string => typeof v === "string")
        : [];
    const recent = ids.slice(-INVITE_PREVIEW_PHOTOS).reverse();
    const photos = [];
    for (const pid of recent) {
        const got = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: pid } }));
        const p = got.Item as Record<string, unknown> | undefined;
        if (!p || typeof p.src !== "string") continue;
        // **返すのは表示に要るものだけ。** 原本（GPS 入り）・S3 のキー・
        // 内部の印は外に出さない（`api/src/photos.ts` の PRIVATE_FIELDS と同じ考え）
        photos.push({
            id: String(p.id ?? ""),
            src: p.src,
            thumbSrc: typeof p.thumbSrc === "string" ? p.thumbSrc : undefined,
            width: typeof p.width === "number" ? p.width : undefined,
            height: typeof p.height === "number" ? p.height : undefined,
            blurDataURL: typeof p.blurDataURL === "string" ? p.blurDataURL : undefined,
        });
    }

    return {
        statusCode: 200,
        // **キャッシュさせない。** 取り消しが効かなくなる
        headers: { ...JSON_HEADERS, "Cache-Control": "no-store" },
        body: JSON.stringify({
            album: {
                id: invite!.albumId,
                title: album.title ?? "",
                memberCount: typeof album.memberCount === "number" ? album.memberCount : 1,
                photoCount: ids.length,
            },
            photos,
        }),
    };
};


/**
 * POST /invites/{token}/join — 招待を受けて参加する（**ログインが要る**）。
 *
 * 閲覧は誰でも、参加はログイン。ここが「拡散の輪」の要で、参加した人は
 * 自分のプロフィールを持ち、次の招待者になれる。
 *
 * **何度押しても同じ結果になる**（既に参加していれば成功で返す）。
 * 招待リンクは共有されるものなので、同じ人が二度開くのは普通に起きる。
 */
export const joinAlbum: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");

    const token = event.pathParameters?.token;
    if (!isValidInviteToken(token)) {
        const r = inviteRejection("notfound");
        return jsonError(r.statusCode, r.error);
    }

    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: inviteKey(token) } }));
    const invite = (res.Item as InviteItem | undefined) ?? null;
    const state = inviteState(invite, Date.now());
    if (state !== "ok") {
        const r = inviteRejection(state);
        return jsonError(r.statusCode, r.error);
    }
    const albumId = invite!.albumId!;

    const album = await getAlbum(albumId);
    if (!album) {
        const r = inviteRejection("notfound");
        return jsonError(r.statusCode, r.error);
    }

    // **既に参加していれば、何も書かずに成功で返す。**
    // 書き直すと参加日時が動き、人数も二重に増える
    const already = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE, Key: { id: albumMemberKey(albumId, userId) },
    }));
    if (already.Item) {
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ albumId, joined: true, already: true }) };
    }

    // **人数の上限は「入れる前」に見る。** 超えたら断る（黙って切り捨てない
    // ——`following` の2000人切り捨てと同じ形を作らない）
    const count = typeof album.memberCount === "number" ? album.memberCount : 1;
    if (count >= MEMBERS_PER_ALBUM) {
        return jsonError(403, `このアルバムは${MEMBERS_PER_ALBUM}人までです`);
    }

    await ddb.send(new PutCommand({
        TableName: PHOTOS_TABLE,
        Item: { id: albumMemberKey(albumId, userId), albumId, userId, joinedAt: new Date().toISOString() },
        // **二重に入れない。** 同時に2回押されても印は1つ
        ConditionExpression: "attribute_not_exists(id)",
    }));
    // 人数は原子加算。印を書いてから増やす（逆にすると、印の書き込みが
    // 失敗したときに人数だけ増える）
    await ddb.send(new UpdateCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: albumKey(albumId) },
        UpdateExpression: "SET memberCount = if_not_exists(memberCount, :one) + :one",
        ConditionExpression: "attribute_exists(id)",
        ExpressionAttributeValues: { ":one": 1 },
    })).catch(() => undefined);

    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ albumId, joined: true }) };
};

/**
 * その人がそのアルバムのメンバーか。**GetItem 1回**で分かる形にしてある。
 *
 * `savePhoto` から呼ぶ。ここを通さずに `albumId` を保存できると、
 * **誰でも他人のアルバムに写真を差し込める**。
 */
export async function isAlbumMember(albumId: string, userId: string): Promise<boolean> {
    if (!albumId || !userId) return false;
    const res = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE, Key: { id: albumMemberKey(albumId, userId) },
    }));
    return Boolean(res.Item);
}

/**
 * アルバムに写真の ID を足す。
 *
 * **索引を足さずに「このアルバムの写真」を引けるようにするための形**
 * ——招待の閲覧は `PublicReadRole`（写真テーブルは GetItem のみ）で動くので、
 * Query が使えない。上限を超えたら**足さない**（黙って古いものを押し出さない）。
 */
export async function addPhotoToAlbum(albumId: string, photoId: string): Promise<void> {
    await ddb.send(new UpdateCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: albumKey(albumId) },
        UpdateExpression: "SET photoIds = list_append(if_not_exists(photoIds, :empty), :one)",
        ConditionExpression: "attribute_exists(id) AND (attribute_not_exists(photoIds) OR size(photoIds) < :max)",
        ExpressionAttributeValues: { ":empty": [], ":one": [photoId], ":max": PHOTOS_PER_ALBUM },
    }));
}
