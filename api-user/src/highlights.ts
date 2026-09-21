import type { APIGatewayProxyHandlerV2WithJWTAuthorizer, APIGatewayProxyHandlerV2 } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { GetCommand, PutCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { sanitizeText } from "./sanitize";
import { isUserId } from "./userId";
import { readUserList, updateUserList } from "./userList";
import { STORY_PUBLIC, storyVisibility } from "./storyVisibility";
import { isStoryExpired } from "./storyExpiry";
import { isDeletedProfile } from "./types";
import { requireEnv } from "./env";

const USERS_TABLE = requireEnv("USERS_TABLE");

/**
 * ハイライト（⑦）。アーカイブのストーリーを束ねて、マイページに輪として置く。
 *
 * ## データの形（アルバムと同じ「本体 ＋ 利用者ごとの一覧」）
 *
 *   highlight#<hid>     { ownerId, title, storyIds: [...], coverStoryId, createdAt, updatedAt }
 *   highlights#<uid>    { list: [...hid], rev }   … `updateUserList`（フォロー・いいねと同じ行の形）
 *
 * **ストーリーの行は写さない。** ハイライトが持つのは ID の並びだけで、
 * 中身は読むときにアーカイブの行（`archive: true` のストーリー）を引く。
 * 写すと、本人がアーカイブから消したあとも写しが残って**消える約束が
 * 破れる**。引くときに無ければ落とす（アルバムの `getInvite` と同じ）。
 *
 * **`highlight#` の行に `userId` を持たせない**（`albumKey` の注記と同じ理由
 * ——`createdAt` と揃うと `userId-createdAt-index` に載り、退会の掃除と
 * フォロー可否の判定が絞り込み無しで引いている索引に混ざる）。持ち主は
 * `ownerId`。
 *
 * ## 誰でも見られる
 *
 * マイページの輪は**訪問者にも出る**（それがハイライトの役目）。だから
 * 入れられるのは**「全員に公開」で投稿したアーカイブだけ**——
 * 「フォロワーのみ」の投稿を入れると、フォローしていない人にも見える
 * ことになる。**黙って公開に変えず、断る**（`postStoryReply` が返信不可を
 * 403 で断るのと同じ向き）。
 *
 * 読む口は未認証（`PublicReadRole`＝写真テーブルは GetItem のみ）なので、
 * Query は使えない。ID を1件ずつ引く——だから1つに入れる数と1人が持てる
 * 数に上限がある（`getInvite` の `INVITE_LOOKUP_BUDGET` と同じ考え）。
 *
 * ## 24時間で消える約束は破らない
 *
 * ハイライトに入るのは、本人が「アーカイブに自動保存」を入にして投稿し、
 * **期限の切れた**分だけ（`getStoryArchive` と同じ定義）。印の無い行は
 * 掃除が実体ごと消すので入れても割れる。期限前の行を通すと、ログインした
 * 人にしか出ないはずの生のストーリーが**未認証の口からその場で読める**。
 * 見た人の名前・返信の数（`viewers` / `replyCount`）は棚入れで消えており、
 * 応答は**表示に要る列だけ**を明示して返す（`getStories` のように「消す列を
 * 列挙する」形だと、列が増えたときに漏れる側へ倒れる）。
 */

/**
 * 1人が持てるハイライトの数。輪の一覧は未認証の口が**1件ずつ引く**ので、
 * この数がそのまま1回の読み取り回数の上限になる
 */
export const HIGHLIGHTS_PER_USER = 20;
/** 1つのハイライトに入れる数。読むときに1件ずつ引くので上限を置く */
export const STORIES_PER_HIGHLIGHT = 100;
/** 題の最大長。輪の下に出す短い名前（画面は1行で切る） */
export const HIGHLIGHT_TITLE_MAX = 30;
/**
 * 表紙が消えていたときに、代わりを探す数。
 * 全部見にいくと1つのハイライトで最大100回の読み取りになる（未認証の口）
 */
const COVER_LOOKUP_BUDGET = 3;

export const highlightKey = (hid: string) => `highlight#${hid}`;
export const highlightsOfUserKey = (userId: string) => `highlights#${userId}`;

/** ハイライトの id（uuid）の形か。形を見てから引く——未認証の口で無駄な読み取りを起こさせない */
const isHighlightId = (v: unknown): v is string => typeof v === "string" && isUserId(v);
/** ストーリーの id の形（`createStory` が `story-<uuid>` で作る） */
const isStoryId = (v: unknown): v is string =>
    typeof v === "string" && /^story-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

type HighlightItem = {
    id: string;
    ownerId?: string;
    title?: string;
    storyIds?: unknown;
    coverStoryId?: string;
    createdAt?: string;
    updatedAt?: string;
};

/** 上限を超えたときに一覧の書き込みから抜けるための印（`updateUserList` は CCF 以外を素通しする） */
class HighlightLimitError extends Error {}

const storyIdsOf = (h: HighlightItem | null): string[] =>
    Array.isArray(h?.storyIds) ? (h!.storyIds as unknown[]).filter((v): v is string => typeof v === "string") : [];

async function getHighlightRow(hid: string, consistent = false): Promise<HighlightItem | null> {
    const res = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: highlightKey(hid) },
        ...(consistent ? { ConsistentRead: true } : {}),
    }));
    return (res.Item as HighlightItem | undefined) ?? null;
}

/**
 * その行を**誰にでも見せてよい**ストーリーか。
 *
 * 作るときの検査（`checkStories`）と読むときの絞り込みで**同じ判定**を使う。
 * 作ったあとに本人が公開範囲を変える口は無いが、行が消えた・別の種類の
 * 行に差し替わった、は起きうるので読む側でも見る（未認証の口の最後の砦）。
 */
function isPublicArchiveStory(row: Record<string, unknown> | undefined, ownerId: string, now: string): row is Record<string, unknown> {
    return !!row
        && row.story === true
        && row.userId === ownerId
        && typeof row.src === "string" && row.src !== ""
        && row.archive === true
        && isStoryExpired(row, now)
        && storyVisibility(row.visibility) === STORY_PUBLIC;
}

/**
 * 退会した人か（users テーブルの墓石）。未認証の口の門——退会の掃除が
 * 転んで一覧が残っても、題（本人の書いた文字列）を返し続けない。
 * 引けなかったときは**退会扱い**（出す側に倒さない。`publicPinnedIds` と同じ）
 */
async function isDeletedUser(userId: string): Promise<boolean> {
    try {
        const res = await ddb.send(new GetCommand({ TableName: USERS_TABLE, Key: { userId }, ProjectionExpression: "deletedAt" }));
        return isDeletedProfile(res.Item);
    } catch (e) {
        console.error("isDeletedUser error:", e);
        return true;
    }
}

/**
 * 訪問者に返す形。**要るものだけを明示する**（`viewers`・`replyCount`・
 * `keptAs`・S3 のキー・座標は出さない）。
 * `allowReplies` は必ず false——期限の切れたストーリーへの返信はサーバーが
 * 404 で断るので、押せない欄を画面に出させない。
 */
function publicStoryShape(row: Record<string, unknown>) {
    const pick = (k: string) => (row[k] === undefined ? {} : { [k]: row[k] });
    return {
        id: row.id,
        src: row.src,
        userId: row.userId,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        archive: true,
        archivedAt: typeof row.archivedAt === "string" ? row.archivedAt : row.expiresAt,
        allowReplies: false,
        ...pick("mediaType"),
        ...pick("caption"),
        ...pick("location"),
        ...pick("song"),
        ...pick("durationSec"),
        ...pick("texts"),
    };
}

/** 入れられない理由（画面にそのまま出す） */
type Rejection = { statusCode: number; error: string };

/**
 * 本人が選んだ ID を検査する。順序は保ち、重複は落とす。
 * 1件でも入れられなければ理由を返す——黙って落として「入れたつもり」を作らない
 */
async function checkStories(userId: string, raw: unknown): Promise<{ ids: string[] } | Rejection> {
    if (!Array.isArray(raw)) return { statusCode: 400, error: "不正なリクエスト" };
    // 形を見てから引く（形の違うものは引きにいかない）
    if (!raw.every(isStoryId)) return { statusCode: 400, error: "不正なリクエスト" };
    const ids = [...new Set(raw as string[])];
    if (ids.length === 0) return { statusCode: 400, error: "ストーリーを1つ以上選んでください" };
    if (ids.length > STORIES_PER_HIGHLIGHT) return { statusCode: 400, error: `1つのハイライトに入れられるのは${STORIES_PER_HIGHLIGHT}件までです` };

    const rows = await Promise.all(ids.map(async (id) => {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id } }));
        return res.Item as Record<string, unknown> | undefined;
    }));
    const now = new Date().toISOString();
    for (const row of rows) {
        // **持ち主でなければ「無い」。** 他人の ID を投げて在るかを探らせない
        if (!row || row.story !== true || row.userId !== userId) {
            return { statusCode: 404, error: "選んだ中に、見つからないストーリーがあります。アーカイブを読み直してください" };
        }
        if (row.archive !== true) {
            return { statusCode: 400, error: "「アーカイブに自動保存」を入にして投稿したストーリーだけをハイライトに入れられます" };
        }
        if (!isStoryExpired(row, now)) {
            return { statusCode: 400, error: "24時間が過ぎてアーカイブに入ったストーリーだけをハイライトに入れられます" };
        }
        if (storyVisibility(row.visibility) !== STORY_PUBLIC) {
            return { statusCode: 400, error: "「フォロワーのみ」で投稿したストーリーはハイライトに入れられません（ハイライトは誰でも見られます）" };
        }
    }
    return { ids };
}

/** 本文（作る・直すで同じ形） */
type Body = { title?: unknown; storyIds?: unknown; coverStoryId?: unknown };

function parseBody(raw: string | undefined): Body | null {
    try {
        const b = JSON.parse(raw ?? "{}") as unknown;
        return b && typeof b === "object" ? (b as Body) : null;
    } catch {
        return null;
    }
}

/** 表紙は選んだ中の1枚。指定が無ければ先頭 */
function pickCover(body: Body, ids: string[]): string | Rejection {
    if (body.coverStoryId === undefined || body.coverStoryId === null) return ids[0];
    if (typeof body.coverStoryId !== "string" || !ids.includes(body.coverStoryId)) {
        return { statusCode: 400, error: "表紙は選んだストーリーの中から選んでください" };
    }
    return body.coverStoryId;
}

const isRejection = (v: unknown): v is Rejection => typeof (v as Rejection)?.statusCode === "number";

/** POST /highlights — ハイライトを作る */
export const createHighlight: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");
    const body = parseBody(event.body);
    if (!body) return jsonError(400, "不正なリクエスト");

    const title = sanitizeText(body.title, HIGHLIGHT_TITLE_MAX);
    if (!title) return jsonError(400, "ハイライトの名前を入れてください");
    const checked = await checkStories(userId, body.storyIds);
    if (isRejection(checked)) return jsonError(checked.statusCode, checked.error);
    const cover = pickCover(body, checked.ids);
    if (isRejection(cover)) return jsonError(cover.statusCode, cover.error);

    // **上限は「作る前」に見る**（アルバムと同じ——作ってから一覧に入れられ
    // ないと、どこからも辿れない行が残る）。同時に2つ作られた場合は
    // 下の `updateUserList` の中でもう一度見る
    const existing = await readUserList(highlightsOfUserKey(userId), isHighlightId, "createHighlight");
    if (existing.length >= HIGHLIGHTS_PER_USER) {
        return jsonError(403, `ハイライトは${HIGHLIGHTS_PER_USER}個までです。使わないものを消してください`);
    }

    const hid = randomUUID();
    const now = new Date().toISOString();
    const row: HighlightItem = { id: highlightKey(hid), ownerId: userId, title, storyIds: checked.ids, coverStoryId: cover, createdAt: now, updatedAt: now };
    await ddb.send(new PutCommand({ TableName: PHOTOS_TABLE, Item: row, ConditionExpression: "attribute_not_exists(id)" }));

    // 本体を作ってから一覧に足す。**足せなければ本体を片付ける**
    // （`createAlbum` と同じ。逆順だと、作成に失敗したとき一覧に無い ID が残る）
    try {
        await updateUserList(highlightsOfUserKey(userId), userId, HIGHLIGHTS_PER_USER, (list) => {
            if (list.includes(hid)) return null;
            if (list.length >= HIGHLIGHTS_PER_USER) throw new HighlightLimitError("limit");
            // 新しいものを先頭に（輪は新しい順に並ぶ）
            return [hid, ...list];
        });
    } catch (e) {
        await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: highlightKey(hid) } })).catch(() => undefined);
        if (e instanceof HighlightLimitError) {
            return jsonError(403, `ハイライトは${HIGHLIGHTS_PER_USER}個までです。使わないものを消してください`);
        }
        console.error(`createHighlight: 一覧に足せませんでした（${hid}）:`, e);
        return jsonError(500, "ハイライトを作れませんでした。もう一度お試しください");
    }

    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ highlight: { id: hid, title, storyIds: checked.ids, coverStoryId: cover, createdAt: now } }) };
};

/** PUT /highlights/{id} — 名前・中身・表紙を置き換える（作る画面をそのまま編集に使う） */
export const updateHighlight: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");
    const hid = event.pathParameters?.id;
    if (!isHighlightId(hid)) return jsonError(404, "ハイライトが見つかりません");
    const body = parseBody(event.body);
    if (!body) return jsonError(400, "不正なリクエスト");

    // **持ち主でなければ「無い」。** 403 だと、その ID の実在を教えてしまう
    const current = await getHighlightRow(hid);
    if (!current || current.ownerId !== userId) return jsonError(404, "ハイライトが見つかりません");

    const title = sanitizeText(body.title, HIGHLIGHT_TITLE_MAX);
    if (!title) return jsonError(400, "ハイライトの名前を入れてください");
    const checked = await checkStories(userId, body.storyIds);
    if (isRejection(checked)) return jsonError(checked.statusCode, checked.error);
    const cover = pickCover(body, checked.ids);
    if (isRejection(cover)) return jsonError(cover.statusCode, cover.error);

    const now = new Date().toISOString();
    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: highlightKey(hid) },
            UpdateExpression: "SET title = :title, storyIds = :ids, coverStoryId = :cover, updatedAt = :now",
            // 読んだあとに消された・持ち主が違う、で書かない（読みと書きの間の穴）
            ConditionExpression: "attribute_exists(id) AND ownerId = :me",
            ExpressionAttributeValues: { ":title": title, ":ids": checked.ids, ":cover": cover, ":now": now, ":me": userId },
        }));
    } catch (e) {
        if ((e as { name?: string }).name === "ConditionalCheckFailedException") return jsonError(404, "ハイライトが見つかりません");
        throw e;
    }
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ highlight: { id: hid, title, storyIds: checked.ids, coverStoryId: cover, createdAt: current.createdAt ?? now } }) };
};

/** DELETE /highlights/{id} — ハイライトを消す（中のストーリーは消えない） */
export const deleteHighlight: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");
    const hid = event.pathParameters?.id;
    if (!isHighlightId(hid)) return jsonError(404, "ハイライトが見つかりません");

    // 「無い」を根拠に一覧から外すので強整合で読む（`pruneMissingAlbumIds` と同じ）
    const current = await getHighlightRow(hid, true);
    if (!current || current.ownerId !== userId) {
        // **本体が無くても、自分の一覧に残っていれば外す。** 前回の削除で
        // 一覧の書き込みだけ転ぶと、幽霊の ID が枠（`HIGHLIGHTS_PER_USER`）を
        // 食い続け、本人には直す手段が無い（読む口は書けない）。
        // 他人の本体の ID が自分の一覧に在ることは無いので、一律に外してよい
        await removeFromList(userId, hid);
        return jsonError(404, "ハイライトが見つかりません");
    }

    try {
        await ddb.send(new DeleteCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: highlightKey(hid) },
            ConditionExpression: "ownerId = :me",
            ExpressionAttributeValues: { ":me": userId },
        }));
    } catch (e) {
        if ((e as { name?: string }).name === "ConditionalCheckFailedException") return jsonError(404, "ハイライトが見つかりません");
        throw e;
    }
    // 本体を消してから一覧から外す。ここが転んでも本体は無いので読む側
    // （`getUserHighlights`）は落とす。枠を食う幽霊は、もう一度この ID で
    // DELETE を呼べば上の分岐が外す
    await removeFromList(userId, hid);

    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };
};

/** 自分の一覧から ID を外す（無ければ書かない・失敗は記録して飲む） */
async function removeFromList(userId: string, hid: string): Promise<void> {
    await updateUserList(highlightsOfUserKey(userId), userId, HIGHLIGHTS_PER_USER, (list) =>
        list.includes(hid) ? list.filter((v) => v !== hid) : null,
    ).catch((e) => console.error(`deleteHighlight: 一覧から外せませんでした（${hid}）:`, e));
}

/** ストーリー1件を引く（無ければ undefined） */
async function getStoryRow(id: string): Promise<Record<string, unknown> | undefined> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id } }));
    return res.Item as Record<string, unknown> | undefined;
}

/**
 * 表紙。指定の1枚が消えていたら、並びの先頭から数枚だけ代わりを探す
 * （全部は見ない——未認証の口なので読み取りに上限を置く）
 */
async function resolveCover(h: HighlightItem, ownerId: string): Promise<{ src: string; mediaType?: string } | null> {
    const ids = storyIdsOf(h);
    const candidates = [
        ...(typeof h.coverStoryId === "string" ? [h.coverStoryId] : []),
        ...ids.filter((id) => id !== h.coverStoryId),
    ].slice(0, COVER_LOOKUP_BUDGET);
    const now = new Date().toISOString();
    for (const id of candidates) {
        if (!isStoryId(id)) continue;
        const row = await getStoryRow(id);
        if (isPublicArchiveStory(row, ownerId, now)) {
            return { src: row.src as string, ...(typeof row.mediaType === "string" ? { mediaType: row.mediaType } : {}) };
        }
    }
    return null;
}

/**
 * GET /highlights/{userId} — その人のハイライトの輪（誰でも読める）。
 *
 * 一覧の行 → 本体を1件ずつ → 表紙を1件ずつ。**持ち主が違う本体は出さない**
 * （一覧の行に他人の ID が紛れても、その人のページに出ない）
 */
export const getUserHighlights: APIGatewayProxyHandlerV2 = async (event) => {
    const userId = event.pathParameters?.userId ?? "";
    // 形を見てから引く（未認証の口で無駄な読み取りを起こさせない）
    if (!isUserId(userId)) return jsonError(404, "見つかりません");

    try {
        if (await isDeletedUser(userId)) return jsonError(404, "見つかりません");
        const ids = (await readUserList(highlightsOfUserKey(userId), isHighlightId, "getUserHighlights")).slice(0, HIGHLIGHTS_PER_USER);
        const rows = await Promise.all(ids.map((hid) => getHighlightRow(hid)));
        const highlights = [];
        for (let i = 0; i < ids.length; i++) {
            const h = rows[i];
            if (!h || h.ownerId !== userId) continue;
            const cover = await resolveCover(h, userId);
            highlights.push({
                id: ids[i],
                title: typeof h.title === "string" ? h.title : "",
                count: storyIdsOf(h).length,
                cover,
            });
        }
        return {
            statusCode: 200,
            // 本人が直した直後に古い輪が出続けないよう、共有キャッシュには短くしか載せない
            headers: { ...JSON_HEADERS, "Cache-Control": "public, s-maxage=30" },
            body: JSON.stringify({ highlights }),
        };
    } catch (e) {
        console.error("getUserHighlights error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

/**
 * GET /highlights/{userId}/{id} — ハイライトの中身（誰でも読める）。
 *
 * 保存した並びのまま返す。消えた・公開でなくなった行は落とす
 * （**ここが未認証の口の最後の砦**——作るときの検査と同じ判定）
 */
export const getHighlight: APIGatewayProxyHandlerV2 = async (event) => {
    const userId = event.pathParameters?.userId ?? "";
    const hid = event.pathParameters?.id;
    if (!isUserId(userId) || !isHighlightId(hid)) return jsonError(404, "ハイライトが見つかりません");

    try {
        if (await isDeletedUser(userId)) return jsonError(404, "ハイライトが見つかりません");
        const h = await getHighlightRow(hid);
        if (!h || h.ownerId !== userId) return jsonError(404, "ハイライトが見つかりません");
        const ids = storyIdsOf(h).filter(isStoryId).slice(0, STORIES_PER_HIGHLIGHT);
        const rows = await Promise.all(ids.map((id) => getStoryRow(id)));
        const now = new Date().toISOString();
        const items = rows.filter((row) => isPublicArchiveStory(row, userId, now)).map((row) => publicStoryShape(row!));
        return {
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "public, s-maxage=30" },
            body: JSON.stringify({
                id: hid,
                title: typeof h.title === "string" ? h.title : "",
                coverStoryId: typeof h.coverStoryId === "string" ? h.coverStoryId : undefined,
                items,
            }),
        };
    } catch (e) {
        console.error("getHighlight error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};
