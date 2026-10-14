import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { isBlocked } from "./blockCheck";
import { isPublicListPhoto } from "./feed";
import { canViewPhoto } from "./restrictedFeed";
import { pushNotification, lookupDisplayName, lookupListIdentity } from "./notify";

/**
 * **「この写真を見て撮影」**（`inspiredBy`）。
 *
 * owner のめざす姿「写真から、次の旅が始まるSNS」の最初の一歩。人の写真を見て
 * その場所へ行って撮った人が、投稿・編集のときに**元の写真の ID** を付けられる。
 * 詳しい決まりは `docs/inspired-by.md`。
 *
 * ## 守ること（承認制の線）
 *
 *   - **新しい表・新しい GSI を作らない。** 写真の行に `inspiredBy`（元の写真の ID）と、
 *     通知を送った印 `inspiredNotified` が足されるだけ
 *   - **「元の写真から、ここで生まれた写真を並べる」は作らない**（逆引きには
 *     GSI か全表 Scan が要る）
 *   - **既存の写真の行には触らない**（新しく投稿する・編集する写真にだけ書く）
 *
 * ## 判定は既存の関数を使う（2つ目を書かない）
 *
 *   - 元の写真が「公開で見られる」か … `feed.ts` の `isPublicListPhoto`
 *     （公開一覧 `GET /feed` と同じ線。下書き・ストーリー・公開範囲を絞った写真・
 *     `src` の無い行は落ちる）
 *   - ブロック … `blockCheck.ts` の `isBlocked`（印を引く。どちら向きも見る）
 *   - 付けた側の写真を閲覧者に見せてよいか … `restrictedFeed.ts` の `canViewPhoto`
 */

/** 写真の ID の形（uuid。古い行・管理APIの行も読めるよう英数とハイフンだけで見る） */
const PHOTO_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * 送られてきた `inspiredBy` を読む。**形が合わなければ undefined。**
 *
 * `#` は写真以外の文書（`notifs#…`・`block#…`）のキーにしか使わないので、
 * 形の段階で弾く（元の写真として通知の文書を指させない）。
 */
export function sanitizeInspiredBy(v: unknown): string | undefined {
    if (typeof v !== "string") return undefined;
    const s = v.trim();
    return PHOTO_ID.test(s) ? s : undefined;
}

/** 「外す」の指定か（null・空文字）。外すのはこの2つだけ（読めない値で黙って消さない） */
export function isInspiredByClear(v: unknown): boolean {
    return v === null || (typeof v === "string" && v.trim() === "");
}

/** 行の持ち主（`userId` が入る前の古い行は `uploadedBy` だけを持つ） */
function ownerOf(row: Record<string, unknown>): string {
    const o = row.userId ?? row.uploadedBy;
    return typeof o === "string" ? o : "";
}

/**
 * 元の写真を1件読み、**`people` の誰から見ても公開で見られるときだけ**返す。
 *
 *   - 無い（削除された）・下書き・ストーリー・公開範囲を絞った写真 → null
 *   - 元の写真の持ち主と `people` の誰かが、**どちら向きでも**ブロックの関係 → null
 *     （持ち主本人は見ない——自分の写真を自分が付けるのは許す）
 *
 * 読み取り: GetItem 1回 ＋ ブロックの印 2回 × 相手の人数（持ち主本人と空は数えない）。
 * **DynamoDB の失敗は投げる**（呼び手が「付けない／500」を決める）。
 */
export async function readVisibleSource(
    sourceId: string,
    people: readonly string[],
): Promise<Record<string, unknown> | null> {
    if (!sanitizeInspiredBy(sourceId)) return null;
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: sourceId } }));
    const row = res.Item as Record<string, unknown> | undefined;
    if (!row || !isPublicListPhoto(row)) return null;
    const owner = ownerOf(row);
    if (!owner) return null;
    const others = [...new Set(people.filter((p) => p && p !== owner))];
    if (others.length > 0) {
        const blocked = await Promise.all(others.flatMap((p) => [isBlocked(owner, p), isBlocked(p, owner)]));
        if (blocked.some(Boolean)) return null;
    }
    return row;
}

/**
 * 画面に出す元の写真の要約。**写真1枚ぶんの全項目は返さない**（題・小さい画像・
 * 作者・撮影地だけ）。名前は users テーブルの**いまの名前**（`lookupListIdentity`。
 * 退会した人の行からは何も返さない）。
 */
export type InspiredSource = {
    id: string;
    title?: unknown;
    src: string;
    thumbSrc?: string;
    location?: string;
    userId: string;
    displayName?: string;
    username?: string;
};

export function summarizeSource(row: Record<string, unknown>, identity: { name?: string; username?: string }): InspiredSource {
    const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
    const thumb = str(row.thumbSm) ?? str(row.thumbSrc);
    const location = str(row.location);
    return {
        id: String(row.id),
        ...(row.title !== undefined ? { title: row.title } : {}),
        src: String(row.src),
        ...(thumb ? { thumbSrc: thumb } : {}),
        ...(location ? { location } : {}),
        userId: ownerOf(row),
        ...(identity.name ? { displayName: identity.name } : {}),
        ...(identity.username ? { username: identity.username } : {}),
    };
}

/**
 * 元の作者へ「あなたの写真を見て撮影しました」を**1枚の写真につき1回だけ**送る。
 *
 * 呼ぶのは、付けた側の写真が**公開で見られる状態になったとき**（投稿・編集・
 * 下書きから公開）。下書きや公開範囲を絞った写真では呼ばない（相手が開けない写真への
 * 通知になる）——判定は呼び手が持つ。
 *
 *   - 自分の写真を付けた → 送らない（印も書かない）
 *   - 元の写真がもう見られない・どちらかがブロック → 送らない（印も書かない）
 *   - **印 `inspiredNotified` が既にある → 送らない**。印は条件つきの書き込み
 *     （`attribute_not_exists`）で立てるので、同時に2本来ても送るのは1本。
 *     元の写真を付け替えても、外して付け直しても、**もう送らない**
 *     （「最初に付いたときだけ」。何度も鳴らせる口を作らない）
 *   - 通知を積むのは `pushNotification`（ブロック・端末へのプッシュ・件数の上限は
 *     既存の種類と同じ扱い）
 *
 * **投げない**（本体の保存は成功で返す。通知は best-effort）。
 */
export async function notifyInspiredOnce(
    photo: { id: string; src?: unknown; thumbSrc?: unknown },
    sourceId: string,
    actorId: string,
): Promise<void> {
    try {
        const source = await readVisibleSource(sourceId, [actorId]);
        if (!source) return;
        const owner = ownerOf(source);
        if (!owner || owner === actorId) return;
        try {
            await ddb.send(new UpdateCommand({
                TableName: PHOTOS_TABLE,
                Key: { id: photo.id },
                UpdateExpression: "SET inspiredNotified = :s",
                // 行が消えていたら作らない（UpdateItem はキーが無ければ行を作る）
                ConditionExpression: "attribute_exists(id) AND attribute_not_exists(inspiredNotified)",
                ExpressionAttributeValues: { ":s": sourceId },
            }));
        } catch (e) {
            if ((e as { name?: string })?.name === "ConditionalCheckFailedException") return;   // 送り済み
            throw e;
        }
        const photoSrc = typeof photo.thumbSrc === "string" && photo.thumbSrc ? photo.thumbSrc
            : typeof photo.src === "string" ? photo.src : "";
        await pushNotification(owner, {
            type: "inspired",
            photoId: photo.id,
            photoSrc,
            byName: await lookupDisplayName(actorId),
            byId: actorId,
            sourcePhotoId: sourceId,
            t: new Date().toISOString(),
        });
    } catch (e) {
        console.error(`notifyInspiredOnce: 送れませんでした（${photo.id} ← ${sourceId}）:`, e);
    }
}

/**
 * GET /user/inspired/{id} — 写真 `{id}` に付いている「元の写真」の要約（**認証必要**）。
 *
 *     200 { "inspiredBy": InspiredSource }   元の写真が今も見られる
 *     200 { "inspiredBy": null }             付いていない・元の写真がもう見られない
 *     404                                     写真 `{id}` をこの人に見せられない・無い
 *
 * **読むときにも判定する**（付けたときは公開でも、あとで非公開・削除・ブロックに
 * なりうる）。閲覧者 ↔ 元の作者、付けた人 ↔ 元の作者の**両方**をどちら向きにも見る。
 *
 * 読み取り（1回の表示あたり・GetItem だけ）:
 *   写真 1 ＋ 元の写真 1 ＋ ブロックの印 4（閲覧者が付けた本人なら 2）＋ 名前 1 ＝ **最大7**
 *   （付けた側の写真が公開範囲を絞った写真なら `canViewPhoto` の 最大3 が足される）。
 *   一覧の口（`GET /feed` など）は `inspiredBy`（ID だけ）を素通しで返すので、
 *   **アプリは ID を持つ写真の詳細を開いたときだけ**ここを呼ぶ。
 *
 * 同じ道に「認証あり／なし」を両方は付けられないので、`/user/likes/{id}`・
 * `/user/comments/{id}` と同じく `/user/` の下に置く。Web は呼ばない（公開一覧から解く）。
 */
export const getInspiredSource: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    const id = event.pathParameters?.id;
    if (!uid || !id) return jsonError(400, "不正なリクエスト");
    // 写真以外の文書（`notifs#…` など）は「無い」
    if (!sanitizeInspiredBy(id)) return jsonError(404, "写真が見つかりません");
    try {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id } }));
        const photo = res.Item as Record<string, unknown> | undefined;
        const owner = photo ? ownerOf(photo) : "";
        if (!photo?.src || photo.story === true) return jsonError(404, "写真が見つかりません");
        // 下書きは本人だけ。公開範囲を絞った写真は見せてよい相手だけ（一覧と同じ判定）
        if (photo.published === false && owner !== uid) return jsonError(404, "写真が見つかりません");
        if (!await canViewPhoto(photo, uid)) return jsonError(404, "写真が見つかりません");

        const headers = { ...JSON_HEADERS, "Cache-Control": "private, no-store" };
        const sourceId = sanitizeInspiredBy(photo.inspiredBy);
        if (!sourceId) return { statusCode: 200, headers, body: JSON.stringify({ inspiredBy: null }) };
        const source = await readVisibleSource(sourceId, [uid, owner]);
        if (!source) return { statusCode: 200, headers, body: JSON.stringify({ inspiredBy: null }) };
        const identity = await lookupListIdentity(ownerOf(source));
        return { statusCode: 200, headers, body: JSON.stringify({ inspiredBy: summarizeSource(source, identity) }) };
    } catch (e) {
        console.error("getInspiredSource error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};
