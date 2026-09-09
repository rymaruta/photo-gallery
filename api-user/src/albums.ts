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
import { GetCommand, PutCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { sanitizeText } from "./sanitize";
import {
    newInviteToken, isValidInviteToken, inviteState, inviteRejection,
    inviteKey, albumKey, albumsOfUserKey, inviteExpiryFrom,
    ALBUMS_PER_USER, ALBUM_TITLE_MAX, MEMBERS_PER_ALBUM, PHOTOS_PER_ALBUM, INVITE_PREVIEW_PHOTOS, INVITE_LOOKUP_BUDGET,
    albumMemberKey, type InviteItem,
} from "./invite";

type AlbumItem = {
    id: string;
    photoIds?: unknown;
    /**
     * 参加者。**人数はここから数える**（別のカウンタを持たない）。
     *
     * このテーブルはソートキーが無いので `albummember#<albumId>#…` を
     * 前方一致で列挙できない——**アルバムを消すときに参加の印を掃除
     * できるようにする**ために、行にも持つ。上限は `MEMBERS_PER_ALBUM`。
     *
     * 以前は `memberCount` を原子加算していたが、印の書き込みと二重管理に
     * なり、加算だけ失敗するとずれた（しかも減る口が無い）。一本にした。
     */
    memberIds?: unknown;
    ownerId?: string;
    title?: string;
    createdAt?: string;
    memberCount?: number;
    inviteToken?: string;
    inviteExpiresAt?: string;
};

/**
 * アルバム1件。`consistent` を渡すと強整合で読む。
 *
 * **既定は結果整合**（費用と速さのため）。ただし「無い」を根拠に
 * **消しにいく**ときだけは強整合で確かめること——作った直後の行は
 * レプリカに載っておらず、既定の読み取りが `null` を返しうる。
 * `comments.ts:75` が同じ理由で切り替えを持っている。
 */
async function getAlbum(albumId: string, consistent = false): Promise<AlbumItem | null> {
    const res = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: albumKey(albumId) },
        ...(consistent ? { ConsistentRead: true } : {}),
    }));
    return (res.Item as AlbumItem | undefined) ?? null;
}

/**
 * 一覧に残っているが本体を引けない ID を外す。
 *
 * 削除は「本体を消す → 一覧から外す」の順で、後半が落ちると**ID だけが
 * 一覧に残る**。`listAlbums` はその ID を画面に出さないので、**持ち主は
 * 押す対象すら持てないまま** `createAlbum` の上限（生の配列長）を食われる
 * ＝「画面には0個なのに『50個までです』」。一覧を開くたびに掃除する
 * （どのみち1件ずつ引いているので、追加の読み取りは**消えて見えた分だけ**）。
 *
 * **消す前に強整合で確かめる。** 作った直後の行は結果整合の読み取りで
 * `null` に見えることがあり、それを根拠に外すと**生きているアルバムを
 * 迷子にする**（本体・参加の印・招待リンクは残るのに一覧からだけ消える）。
 */
async function pruneMissingAlbumIds(userId: string, ids: string[], missing: string[]): Promise<void> {
    const gone: string[] = [];
    for (const id of missing) {
        if (!await getAlbum(id, true)) gone.push(id);
    }
    if (gone.length === 0) return;
    const next = ids.filter((v) => !gone.includes(v));
    await ddb.send(new UpdateCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: albumsOfUserKey(userId) },
        UpdateExpression: "SET albumIds = :next",
        // 読んだ時点の姿を条件にする（待っている間に増えた分を消さない）
        ConditionExpression: "albumIds = :prev",
        ExpressionAttributeValues: { ":next": next, ":prev": ids },
    })).catch((e) => console.error(`listAlbums: 一覧の掃除に失敗（${userId}）:`, e));
}

/** 参加者の一覧（読めない形なら空とみなす） */
function memberIdsOf(album: AlbumItem | null): string[] {
    return Array.isArray(album?.memberIds)
        ? (album!.memberIds as unknown[]).filter((v): v is string => typeof v === "string")
        : [];
}

/** 画面に返す人数。**一覧から数える**（古い行は memberCount に落とす） */
function memberCountOf(album: AlbumItem | null): number {
    const ids = memberIdsOf(album);
    if (ids.length > 0) return ids.length;
    return typeof album?.memberCount === "number" && album.memberCount > 0 ? album.memberCount : 1;
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
        // 消す口ができたので、案内してよい（`deleteAlbum`）
        return jsonError(403, `アルバムは${ALBUMS_PER_USER}個までです。使わないものを消してください`);
    }

    const albumId = randomUUID();
    const now = new Date().toISOString();
    const album: AlbumItem = { id: albumKey(albumId), ownerId: userId, title, createdAt: now, memberIds: [userId] };
    await ddb.send(new PutCommand({
        TableName: PHOTOS_TABLE,
        Item: album,
        // 新規作成専用。同じキーの行を丸ごと置き換えない（putPhoto と同じ理由）
        ConditionExpression: "attribute_not_exists(id)",
    }));

    // 作った人はそのまま参加者。**アルバムを作ってから一覧に足す**
    // ——逆にすると、作成に失敗したときに存在しない ID が一覧に残る。
    //
    // **途中で失敗したら、作ったアルバムを片付けて 500 を返す。**
    // 参加の印を書けないまま残すと「自分のアルバムなのに自分がメンバーで
    // ない」＝そこに写真を入れられない行ができる（一覧にも出ない）。
    try {
        await ddb.send(new PutCommand({
            TableName: PHOTOS_TABLE,
            Item: { id: albumMemberKey(albumId, userId), albumId, userId, joinedAt: now },
        }));
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: albumsOfUserKey(userId) },
            UpdateExpression: "SET albumIds = list_append(if_not_exists(albumIds, :empty), :one)",
            ExpressionAttributeValues: { ":empty": [], ":one": [albumId] },
        }));
    } catch (e) {
        console.error(`createAlbum: 後片付け（${albumId}）:`, e);
        await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: albumKey(albumId) } }))
            .catch(() => undefined);
        return jsonError(500, "アルバムを作れませんでした。もう一度お試しください");
    }

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
    const missing: string[] = [];
    for (const id of ids) {
        const a = await getAlbum(id);
        // **引けなかった ID はここで覚えて、あとで外す。**
        // 画面に出さないだけだと、枠だけ食われて誰も外せない
        // （持ち主の一覧に出ない＝削除を押す対象が無い）。
        // 持ち主が違う行は外さない（消えたのではなく、読み違えの可能性）
        if (!a) { missing.push(id); continue; }
        if (a.ownerId !== userId) continue;
        albums.push({
            id,
            title: a.title ?? "",
            createdAt: a.createdAt ?? "",
            memberCount: memberCountOf(a),
            inviteToken: a.inviteToken,
            inviteExpiresAt: a.inviteExpiresAt,
        });
    }
    if (missing.length > 0) await pruneMissingAlbumIds(userId, ids, missing);
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

    // **書き戻しに失敗したら、いま作ったトークンを取り消す。**
    // 取り消しは `album.inviteToken` からしか辿れないので、書き戻せないまま
    // 残すと**取り消せない生きたリンクが30日残る**（画面はエラーを出すので
    // 配られはしないが、回収する手段が無い）。
    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: albumKey(albumId) },
            UpdateExpression: "SET inviteToken = :t, inviteExpiresAt = :e",
            ConditionExpression: "attribute_exists(id) AND ownerId = :me",
            ExpressionAttributeValues: { ":t": token, ":e": expiresAt, ":me": userId },
        }));
    } catch (e) {
        console.error(`createInvite: 書き戻しに失敗したので取り消します（${albumId}）:`, e);
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: inviteKey(token) },
            UpdateExpression: "SET revoked = :t",
            ConditionExpression: "attribute_exists(id)",
            ExpressionAttributeValues: { ":t": true },
        })).catch(() => undefined);
        return jsonError(500, "招待リンクを作れませんでした。もう一度お試しください");
    }

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
    // **死んだ ID・非公開で窓を埋めない。** 直近24件だけを見ていた頃は、
    // 消された写真がその窓に並ぶと**生きている写真があるのに空に見えた**
    // （`continue` するだけで埋め直していなかった）。新しい方から遡って、
    // 24枚 見つかるか、読み取りの上限に当たるまで進む。
    // 上限があるのは**未認証で叩ける口**だから（好きなだけ読ませない）。
    const candidates = ids.slice().reverse();
    const photos = [];
    let looked = 0;
    for (const pid of candidates) {
        if (photos.length >= INVITE_PREVIEW_PHOTOS) break;
        if (looked >= INVITE_LOOKUP_BUDGET) break;
        looked++;
        const got = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: pid } }));
        const p = got.Item as Record<string, unknown> | undefined;
        if (!p || typeof p.src !== "string") continue;
        // **非公開・下書きは出さない。** ここが最後の砦。
        //
        // 入る筋が2つある: (1) `/user/upload?album=X` は「下書き保存」でも
        // `albumId` を送る、(2) あとから非公開にしても `photoIds` からは
        // 消えない（`photoUpdate.ts` はアルバムを知らない）。
        // **この口は未認証で叩ける**ので、ここを抜けると
        // 「下書きに入れたつもりの写真が、リンクを持つ誰にでも読める」。
        // 判定は `published !== false`（未指定は公開）——リポジトリ全体の慣習。
        if (p.published === false) continue;
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
                memberCount: memberCountOf(album),
                // **枚数は返さない。** `photoIds` は消された写真の ID を
                // 持ち続けるので、数えると嘘になる（「写真5枚」なのに2枚しか
                // 出ない）。出すなら全件引くことになり、未認証の口では引けない。
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
    if (memberCountOf(album) >= MEMBERS_PER_ALBUM) {
        return jsonError(403, `このアルバムは${MEMBERS_PER_ALBUM}人までです`);
    }

    await ddb.send(new PutCommand({
        TableName: PHOTOS_TABLE,
        Item: { id: albumMemberKey(albumId, userId), albumId, userId, joinedAt: new Date().toISOString() },
        // **二重に入れない。** 同時に2回押されても印は1つ
        ConditionExpression: "attribute_not_exists(id)",
    }));
    // 印を書いてから一覧に足す（逆にすると、印の書き込みが失敗したときに
    // 人数だけ増える）。**上限と重複はここでも条件で見る**——同時に2人が
    // 参加しても、条件付き更新なので上限を超えない
    await ddb.send(new UpdateCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: albumKey(albumId) },
        UpdateExpression: "SET memberIds = list_append(if_not_exists(memberIds, :empty), :one)",
        ConditionExpression:
            "attribute_exists(id) "
            + "AND (attribute_not_exists(memberIds) OR size(memberIds) < :max) "
            + "AND (attribute_not_exists(memberIds) OR NOT contains(memberIds, :uid))",
        ExpressionAttributeValues: { ":empty": [], ":one": [userId], ":uid": userId, ":max": MEMBERS_PER_ALBUM },
    })).catch((e) => {
        // 印は書けているので参加は成立している。一覧に載らないと人数が
        // 1人少なく見えるだけ（黙って握らずログは残す）
        console.error(`joinAlbum: 参加者の一覧に足せませんでした（${albumId}/${userId}）:`, e);
    });

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
        // **同じ写真を二度入れない。** 保存の再送（`overwriteOwnPhoto` の経路）で
        // ここを呼ぶようにしたので、押し直すたびに増える形を塞ぐ。
        // 既に入っていれば条件で落ちる（呼び出し側はそれを成功として扱う）。
        ConditionExpression:
            "attribute_exists(id) "
            + "AND (attribute_not_exists(photoIds) OR size(photoIds) < :max) "
            + "AND (attribute_not_exists(photoIds) OR NOT contains(photoIds, :id))",
        ExpressionAttributeValues: { ":empty": [], ":one": [photoId], ":id": photoId, ":max": PHOTOS_PER_ALBUM },
    }));
}

/**
 * アルバムから写真の ID を取り除く（削除の経路から呼ぶ）。
 *
 * **一覧に死んだ ID が溜まると2つ困る**: 500枚の枠を食う／招待ページが
 * 直近24枚の窓を死んだ ID で埋めて「生きている写真があるのに空」に見える。
 *
 * DynamoDB は値でリストから消せないので、読んで書き直す。**書き直す前の
 * 一覧を条件に入れる**ので、その間に誰かが足していたら何もしない
 * （足された写真を取りこぼさない。次の削除で拾える）。
 */
export async function removePhotoFromAlbum(albumId: string, photoId: string): Promise<void> {
    const album = await getAlbum(albumId);
    const ids = Array.isArray(album?.photoIds)
        ? (album!.photoIds as unknown[]).filter((v): v is string => typeof v === "string")
        : [];
    if (!ids.includes(photoId)) return;
    await ddb.send(new UpdateCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: albumKey(albumId) },
        UpdateExpression: "SET photoIds = :next",
        ConditionExpression: "attribute_exists(id) AND photoIds = :prev",
        ExpressionAttributeValues: { ":next": ids.filter((v) => v !== photoId), ":prev": ids },
    }));
}


/** PATCH /albums/{id} — アルバムの名前を変える（持ち主だけ） */
export const renameAlbum: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");
    const albumId = event.pathParameters?.id;
    if (!albumId) return jsonError(400, "アルバムが指定されていません");

    let body: { title?: unknown };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return jsonError(400, "不正なリクエスト");
    }
    const title = sanitizeText(body.title, ALBUM_TITLE_MAX);
    if (!title) return jsonError(400, "アルバムの名前を入れてください");

    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: albumKey(albumId) },
            UpdateExpression: "SET title = :t",
            // **持ち主だけ。** Get で確かめてから Update すると、その間に
            // 持ち主が変わる筋が残る（`createInvite` と同じ形）
            ConditionExpression: "attribute_exists(id) AND ownerId = :me",
            ExpressionAttributeValues: { ":t": title, ":me": userId },
        }));
    } catch (e) {
        if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
            // **持ち主でなければ「無い」と返す**（実在を教えない）
            return jsonError(404, "アルバムが見つかりません");
        }
        throw e;
    }
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true, title }) };
};

/**
 * DELETE /albums/{id} — アルバムを消す（持ち主だけ）。
 *
 * **写真は消さない。** アルバムは束ねているだけで、写真そのものは
 * 投稿した人のもの。消すのは束ね方（アルバム・参加の印・招待リンク）。
 *
 * 消す順番: **招待を先に取り消す**——アルバムの行を先に消すと、
 * `album.inviteToken` から辿れなくなって**取り消せないリンクが残る**。
 */
export const deleteAlbum: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");
    const albumId = event.pathParameters?.id;
    if (!albumId) return jsonError(400, "アルバムが指定されていません");

    let album = await getAlbum(albumId);
    // **「無い」を根拠に一覧を書き換える前に、強整合で確かめる。**
    // 既定の読み取りは結果整合なので、作った直後のアルバムは `null` に
    // 見えることがある。そのまま下の掃除に入ると、**生きているアルバムを
    // 持ち主の一覧からだけ外す**（本体・参加の印・招待リンクは残るので、
    // 招待を配ってあれば他人は入れるのに、持ち主は二度と開けない）。
    if (!album) album = await getAlbum(albumId, true);

    // **本体がもう無くても、一覧に残っていたら外す。**
    //
    // 削除は「本体を消す → 一覧から外す」の順で、後半が落ちると
    // **ID だけが一覧に残る**。`createAlbum` の上限判定は生の配列長を数える
    // ので、**画面にはアルバムが0個なのに「50個までです」で作れない**
    // ——しかも押し直すと本体がもう無いので 404 になり、**永久に詰む**
    // （`removePinnedPhoto` が「枠を1つ永久に食い潰す」として塞いだのと同じ形）。
    // 押し直しで直せるように、ここで一覧の掃除だけ済ませる。
    if (!album) {
        const ids = await listOwnAlbumIds(userId);
        if (!ids.includes(albumId)) return jsonError(404, "アルバムが見つかりません");
        // **掃除できなかったら成功と言わない。** ここで押されたということは
        // 前回が途中で落ちているので、200 を返すと画面は「消しました」と出して
        // 一覧を読み直す——幽霊 ID は一覧に出ないので、**押す対象が消えたまま
        // 枠だけ食われた状態**になる。落ちたことを伝えて、もう一度押させる。
        try {
            await ddb.send(new UpdateCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: albumsOfUserKey(userId) },
                UpdateExpression: "SET albumIds = :next",
                ConditionExpression: "albumIds = :prev",
                ExpressionAttributeValues: { ":next": ids.filter((v) => v !== albumId), ":prev": ids },
            }));
        } catch (e) {
            console.error(`deleteAlbum: 一覧の掃除に失敗（${albumId}）:`, e);
            return jsonError(500, "アルバムを消せませんでした。もう一度お試しください");
        }
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };
    }
    if (album.ownerId !== userId) return jsonError(404, "アルバムが見つかりません");

    // 1. 招待リンクを取り消す（**アルバムを消す前に**。あとからでは辿れない）
    if (album.inviteToken && isValidInviteToken(album.inviteToken)) {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: inviteKey(album.inviteToken) },
            UpdateExpression: "SET revoked = :t",
            ConditionExpression: "attribute_exists(id)",
            ExpressionAttributeValues: { ":t": true },
        })).catch(() => undefined);
    }

    // 2. 参加の印。**一覧からしか辿れない**（このテーブルはソートキーが無いので
    //    `albummember#<albumId>#…` を前方一致で列挙できない）
    for (const memberId of memberIdsOf(album)) {
        await ddb.send(new DeleteCommand({
            TableName: PHOTOS_TABLE, Key: { id: albumMemberKey(albumId, memberId) },
        })).catch(() => undefined);
    }

    // 3. アルバム本体
    await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: albumKey(albumId) } }));

    // 4. 持ち主の一覧から外す。**本体を消してから**——先に外すと、途中で
    //    失敗したときにどこからも辿れないアルバムが残る
    const ids = await listOwnAlbumIds(userId);
    if (ids.includes(albumId)) {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: albumsOfUserKey(userId) },
            UpdateExpression: "SET albumIds = :next",
            // その間に別のアルバムが増えていたら何もしない（取りこぼさない）
            ConditionExpression: "albumIds = :prev",
            ExpressionAttributeValues: { ":next": ids.filter((v) => v !== albumId), ":prev": ids },
        })).catch((e) => {
            // ここは握ってよい（**本体はもう消えている**ので、失敗を返すと
            // 「消えていない」という別の嘘になる）。残った ID は
            // `pruneMissingAlbumIds` が一覧を開いたときに外す
            console.error(`deleteAlbum: 一覧から外せませんでした（${albumId}）:`, e);
        });
    }

    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };
};
