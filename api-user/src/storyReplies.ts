import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { pushNotification, lookupDisplayName, deletedUserIds, DELETED_USER_NAME } from "./notify";
import { truncate } from "./sanitize";
import { isBlocked } from "./block";

/**
 * ストーリーへの返信とリアクション。
 *
 * **ストーリーを見た人が反応する手段が1つも無かった。** 見て、消える。
 * それだけなので、投稿する側には「誰かに届いた」手応えが閲覧者数の
 * 数字しか無い。返信はストーリーの中心にある動きで、ここが無いと
 * 「置いておくだけの掲示板」になる。
 *
 * **保存の形はコメント（`comments.ts`）に揃える。** 単一PKのテーブルで
 * 前方一致の列挙ができないので、ストーリーごとに1つの文書
 * （`storyreplies#<storyId>`）に list_append で追記する。新しい機構は作らない
 * ——上限・バイト予算・競合のやり直しまで、あちらで一度作って直した形をそのまま使う。
 *
 * **コメントと違うところ**（意図的な差。写経しないこと）:
 *   - **読めるのは投稿者だけ。** ストーリーは24時間で消える身内向けのもので、
 *     返信は公開の議論ではない。`getStoryReplies` は所有者以外に 403 を返す
 *   - **自分のストーリーには返信できない。** 返信は相手に届けるためのもので、
 *     自分宛ての通知を作る意味が無い（`viewStory` が本人の閲覧を記録しないのと同じ）
 *   - **期限切れには返信できない。** 行が残っているのは掃除が1時間ごとだから
 *     で、一覧はとっくに返していない（`viewStory` と同じ判断）
 *   - **絵文字1つだけの返信を許す。** Instagram のクイックリアクションにあたる。
 *     本文を打たずに反応できる道が無いと、ほとんどの人は何も返さない
 */

export type StoryReply = {
    id: string;
    uid: string;
    name: string;
    /** クイックリアクション。`REACTIONS` のどれか */
    emoji?: string;
    /** 一言の返信。絵文字だけの回は持たない */
    text?: string;
    t: string;
    /** 返信した人が退会している（読むときにサーバーが立てる） */
    deleted?: boolean;
};

/**
 * クイックリアクションとして受け付ける絵文字。
 *
 * **自由入力にしない。** ここは「絵文字1つ」の欄で、任意の文字列を通すと
 * 本文の上限（`TEXT_MAX`）も改行の扱いもすり抜ける2本目の入口になる。
 * 一覧に無いものが来たら本文として扱う（＝上限と切り詰めが効く）。
 */
export const REACTIONS = ["❤️", "😍", "😂", "😮", "😢", "👏"] as const;
const REACTION_SET: ReadonlySet<string> = new Set(REACTIONS);

const REPLIES_MAX = 200;
/**
 * 1人が1つのストーリーに送れる数。
 *
 * 上限200の輪（古いものから落ちる）なので、1人が200件送れば
 * **他の人の返信を全部押し出せる**。コメントが同じ理由で1人10件に
 * 絞っているので揃える。
 */
const REPLIES_MAX_PER_USER = 10;
const REPLY_APPEND_RETRIES = 3;
/** 返信の本文。コメント（500）より短い——ストーリーは会話ではなく一言 */
const TEXT_MAX = 200;
/**
 * `storyreplies#<storyId>` に許すバイト数。**件数だけでは 400KB を守れない**
 * （`comments.ts` の同名の定数と同じ理由。あちらの docstring が詳しい）。
 */
const ITEM_BUDGET_BYTES = 350 * 1024;

export const storyRepliesId = (storyId: string) => `storyreplies#${storyId}`;

/** `next` を足しても収まるように、**古い方から**落とす件数を返す */
export function overBudgetCount(existing: readonly StoryReply[], next: StoryReply): number {
    const size = (arr: readonly StoryReply[]) => Buffer.byteLength(JSON.stringify(arr), "utf8");
    let drop = 0;
    while (drop < existing.length && size([...existing.slice(drop), next]) > ITEM_BUDGET_BYTES) drop++;
    return drop;
}

async function readReplies(storyId: string, consistent = false): Promise<StoryReply[]> {
    // やり直しのときだけ強整合で読む（結果整合だと競合直後の読み直しが
    // 競合前の姿を返し、同じ長さでまた条件が外れる。`comments.ts` と同じ）
    const res = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: storyRepliesId(storyId) },
        ...(consistent ? { ConsistentRead: true } : {}),
    }));
    const items = res.Item?.items;
    return Array.isArray(items) ? (items as StoryReply[]) : [];
}

type StoryItem = {
    story?: boolean; userId?: string; uploadedBy?: string;
    src?: string; expiresAt?: string;
};

/** ストーリーを引いて、返信を受け付けてよいかまで見る */
async function loadStory(storyId: string): Promise<StoryItem | null> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: storyId } }));
    const item = res.Item as StoryItem | undefined;
    if (!item || item.story !== true) return null;
    return item;
}

/** POST /stories/{id}/replies — 返信またはリアクションを送る（認証必要） */
export const postStoryReply: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    const storyId = event.pathParameters?.id;
    if (!uid || !storyId) return jsonError(400, "不正なリクエスト");

    let body: { text?: unknown; emoji?: unknown };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return jsonError(400, "不正なリクエスト");
    }
    // 一覧に無い絵文字は本文として扱う（上限と切り詰めを必ず通す）
    const emoji = typeof body.emoji === "string" && REACTION_SET.has(body.emoji) ? body.emoji : undefined;
    // 一覧に無い絵文字は本文として扱う（上限と切り詰めを必ず通す）。
    // **文字列のときだけ。** `String(...)` に通していたので、
    // `{"emoji":{"a":1}}` が本文 `"[object Object]"` として保存されていた
    // ——「一覧に無いものは本文」の意図は、文字列で来たときの話
    const rawText = typeof body.text === "string"
        ? body.text
        : (!emoji && typeof body.emoji === "string" ? body.emoji : "");
    const text = truncate(rawText.trim(), TEXT_MAX);
    if (!emoji && !text) return jsonError(400, "返信を入力してください");

    try {
        const story = await loadStory(storyId);
        if (!story) return jsonError(404, "ストーリーが見つかりません");
        const ownerId = story.userId ?? story.uploadedBy;
        // **自分のストーリーには返信できない。** 自分宛ての通知を作る意味が
        // 無い（`viewStory` が本人の閲覧を記録しないのと同じ判断）
        if (ownerId === uid) return jsonError(400, "自分のストーリーには返信できません");
        // **期限切れは「もう無い」。** 行が残っているのは掃除が1時間ごとだから
        if (story.expiresAt && String(story.expiresAt) <= new Date().toISOString()) {
            return jsonError(404, "ストーリーが見つかりません");
        }
        // **ブロックされていたら送れない。** ここは返信を足したことで
        // 生まれた「誰でも誰の通知にも文字を送れる」口の出口
        // （1ストーリー10件 × 1日20本）。**404 で返す**——「ブロック
        // されています」と言うと、相手の操作を教えることになる
        // （持ち主でない相手に 404 を返しているのと同じ判断）
        if (ownerId && await isBlocked(ownerId, uid)) return jsonError(404, "ストーリーが見つかりません");

        const reply: StoryReply = {
            id: uuidv4(),
            uid,
            name: await lookupDisplayName(uid),
            ...(emoji ? { emoji } : {}),
            ...(text ? { text } : {}),
            t: new Date().toISOString(),
        };

        // 追記。**読みと書きを条件でつなぐ**——「読んで数える → 無条件に
        // list_append」だと、同時に投げれば全部が「既存0件」を読んで全部通り、
        // 1人あたりの上限が並行実行で消える（`comments.ts` が踏んだ形）。
        const appendArgs = (guard: { len: number }) => ({
            TableName: PHOTOS_TABLE,
            Key: { id: storyRepliesId(storyId) },
            UpdateExpression:
                "SET #items = list_append(if_not_exists(#items, :empty), :new), storyId = :sid, updatedAt = :now",
            ConditionExpression: guard.len === 0
                ? "attribute_not_exists(#items) OR size(#items) = :len"
                : "size(#items) = :len",
            ExpressionAttributeNames: { "#items": "items" },
            ExpressionAttributeValues: {
                ":new": [reply], ":empty": [], ":sid": storyId, ":now": reply.t, ":len": guard.len,
            },
            ReturnValues: "UPDATED_NEW" as const,
        });

        let stored: StoryReply[] | undefined;
        for (let attempt = 0; attempt < REPLY_APPEND_RETRIES; attempt++) {
            const existing = await readReplies(storyId, attempt > 0);
            if (existing.filter((r) => r.uid === uid).length >= REPLIES_MAX_PER_USER) {
                return jsonError(429, `このストーリーへの返信は${REPLIES_MAX_PER_USER}件までです`);
            }
            // **入れる前にバイト数で見る。** 追記のあとに切り詰める形だと、
            // 超えた瞬間の書き込みが `ValidationException` で落ち、
            // 「古いものから落ちる」が「新しいものが入らない」に化ける
            const drop = overBudgetCount(existing, reply);
            const kept = [...existing.slice(drop), reply].slice(-REPLIES_MAX);
            try {
                if (drop > 0 || existing.length + 1 > REPLIES_MAX) {
                    // 落とすのと足すのを1回の書き込みで（別々にすると、
                    // 落としただけで足せなかった回に返信が消える）
                    await ddb.send(new UpdateCommand({
                        TableName: PHOTOS_TABLE,
                        Key: { id: storyRepliesId(storyId) },
                        UpdateExpression: "SET #items = :kept, storyId = :sid, updatedAt = :now",
                        ConditionExpression: existing.length === 0
                            ? "attribute_not_exists(#items) OR size(#items) = :len"
                            : "size(#items) = :len",
                        ExpressionAttributeNames: { "#items": "items" },
                        ExpressionAttributeValues: {
                            ":kept": kept, ":sid": storyId, ":now": reply.t, ":len": existing.length,
                        },
                    }));
                } else {
                    await ddb.send(new UpdateCommand(appendArgs({ len: existing.length })));
                }
                stored = kept;
                break;
            } catch (e) {
                if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;
                // 誰かが先に書いた。読み直してやり直す
            }
        }
        if (!stored) return jsonError(409, "混み合っています。もう一度お試しください");

        // 投稿者が数だけ見られるように、ストーリーの行にも数える。
        // **`replyCount` は所有者にしか返さない**（`getStories` が落とす）
        //
        // **この書き込みは、行がまだ在るかの見張りも兼ねている。**
        // 「返信する」と「ストーリーを消す」が同時に走ると、削除が
        // `storyreplies#<id>` → 行 の順に消したあとで、上の追記が
        // **`storyreplies#<id>` を作り直す**（DynamoDB の UpdateItem は
        // キーが無ければ作る）。行が無い文書は `storyFeed` も `story` も
        // `src` も持たないので、GSI にも Scan にも一覧にも出ない
        // ——**どの削除経路からも二度と辿れない**。このテーブルに TTL は無い。
        //
        // `attribute_exists(id)` が落ちたということは、まさにその状態。
        // 追加の読み取りを増やさずに分かるので、ここで掃除する。
        // （きれいに直すなら `TransactWriteItems`（行の ConditionCheck ＋
        //   文書の Update）だが、`comments.ts` から写した構造ごと変わる。
        //   `viewStory` が同じ事故を長いコメント付きで塞いでいる）
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: storyId },
            UpdateExpression: "SET replyCount = :n",
            ConditionExpression: "attribute_exists(id)",
            ExpressionAttributeValues: { ":n": stored.length },
        })).catch(async (e) => {
            console.error(`postStoryReply: 件数を書けませんでした（${storyId}）:`, e);
            if ((e as { name?: string }).name !== "ConditionalCheckFailedException") return;
            // 行が消えている＝いま作り直した文書は誰も辿れない。片付ける
            await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: storyRepliesId(storyId) } }))
                .catch((e2) => console.error(`postStoryReply: 孤児の掃除に失敗（${storyId}）:`, e2));
        });

        if (ownerId) {
            await pushNotification(ownerId, {
                type: "storyreply",
                photoId: storyId,
                photoSrc: String(story.src ?? ""),
                byName: reply.name,
                byId: uid,
                t: reply.t,
            });
        }
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true, reply }) };
    } catch (e) {
        console.error("postStoryReply error:", e);
        return jsonError(500, "送信に失敗しました");
    }
};

/** GET /stories/{id}/replies — 届いた返信（投稿者だけ） */
export const getStoryReplies: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const callerId = getUserId(event);
    const storyId = event.pathParameters?.id;
    if (!callerId || !storyId) return jsonError(400, "不正なリクエスト");

    try {
        const story = await loadStory(storyId);
        if (!story) return jsonError(404, "ストーリーが見つかりません");
        // **返信は公開の議論ではない。** 所有者以外には返さない
        // （`getStoryViewers` と同じ）
        if ((story.userId ?? story.uploadedBy) !== callerId) return jsonError(403, "権限がありません");

        const all = await readReplies(storyId);
        const items = all.slice(-REPLIES_MAX).reverse();   // 末尾追記なので後ろが新しい
        // 退会した人の名前は出さない（`getComments` と同じ）。0件なら引きに行かない
        const gone = items.length === 0 ? new Set<string>() : await deletedUserIds();
        const safeItems = gone.size === 0
            ? items
            : items.map((r) => (gone.has(r.uid) ? { ...r, name: DELETED_USER_NAME, deleted: true } : r));
        return {
            // 本人向けの内容。共有キャッシュに載せない
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            body: JSON.stringify({ items: safeItems, count: all.length }),
        };
    } catch (e) {
        console.error("getStoryReplies error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};
