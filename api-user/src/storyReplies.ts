import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { pushNotification, lookupDisplayName, deletedUserIds, DELETED_USER_NAME } from "./notify";
import { truncate } from "./sanitize";
import { isBlocked } from "./blockCheck";
import { hiddenUserIds } from "./block";

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

export const REPLIES_MAX = 200;

/**
 * 返信の数（`replyCount`）を書けなかったときのやり直し。
 *
 * **本文はもう入っている**ので、ここで諦めると「返信はあるのに数が無い」
 * が残る。最初の1件でそうなると**バッジが出ず、所有者はその返信に
 * 辿り着けない**（入口は返信バッジだけ）。数字は `follow.ts` に揃えた。
 */
const COUNT_WRITE_RETRIES = 3;
const COUNT_RETRY_BASE_MS = 25;
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

/**
 * ブロックした相手を除いた返信の数。**バッジ（`replyCount`）を一覧と
 * 揃えるために `getStories` が使う。**
 *
 * 行が持つ `replyCount` は `postStoryReply` が書いた「全部の数」なので、
 * 読み側でブロック分を落とすと**バッジだけ多いまま**になる
 * ——「返信 1件」を押したら「まだ返信はありません」。しかも人がブロックを
 * 押すのは返信一覧の中（`StoryViewer` のブロック導線はそこにしか無い）＝
 * **返信が1件だけでその1人、がいちばん起きる形**なので、例外ではなく
 * 常態でそうなる。`StoryViewer` 自身が「0件のときは出さない——押しても
 * 何も無いボタンを常に置かない」と書いている当の不変条件を破っていた。
 *
 * **読めなければ null を返す**（呼び出し側は行の数をそのまま使う）。
 * ここで 0 に倒すと、一時的な失敗でバッジが消えて**所有者が届いた返信を
 * 読む唯一の入口を失う**。
 */
export async function visibleReplyCount(storyId: string, hidden: Set<string>): Promise<number | null> {
    if (hidden.size === 0) return null;
    try {
        const all = await readReplies(storyId);
        return all.filter((r) => !hidden.has(r.uid)).length;
    } catch (e) {
        console.error(`visibleReplyCount: 返信を読めませんでした（${storyId}）:`, e);
        return null;
    }
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
        // **通知は件数より先に出す。** この関数は既定の6秒で動くので、
        // 件数のやり直しで枠を使い切ると `pushNotification` に届かない
        // ——所有者は「返信が来たこと」すら知れなくなる（ベルの1行が
        // 唯一の手がかり）。通知は件数と独立で、`notify.ts` 側が自前で
        // 握るので投げない。
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

        //
        // **一時的な失敗ではやり直す。** 握って先へ進むと、返信は保存された
        // のに数だけ据え置きになる。**最初の1件でそれが起きると `replyCount` が
        // 付かず、`StoryViewer` はその数が 0 ならボタンを出さない**
        // ——返信一覧を開く入口は他に無いので、**所有者はその返信を読む手段を
        // 失う**（ストーリーが消えるまで気づけない）。
        // やり直しの形は `follow.ts` の `updateFollowing` に揃える。
        // **CCF はやり直さない**——あれは「行が消えた」で、待っても戻らない。
        //
        // **やり直すときは数を読み直す。** `stored.length` は**追記した瞬間**の
        // 長さで固定されているので、待っている間に別の人の返信が入って
        // `replyCount` が先に進んでいると、古い数で**上書きして巻き戻す**
        // （その人の返信がバッジから消える）。`follow.ts` の `updateFollowing` が
        // やり直しのたびに読み直しているのと同じ理由——形だけ写して
        // **読み直しを置いてきていた**。読むのは失敗した回だけ。
        //
        // **条件式で単調にするのは駄目**（`replyCount < :n` を足す等）。
        // 下の CCF は「**行が消えた**」と読んで `storyreplies#` を丸ごと
        // 消すので、「行は在るが数が大きい」でも CCF になった瞬間に
        // **生きている返信が全部消える**。条件は `attribute_exists(id)` だけに保つ。
        let count = stored.length;
        for (let attempt = 0; attempt <= COUNT_WRITE_RETRIES; attempt++) {
            if (attempt > 0) {
                // 読めなければ手元の数のまま（撃たないより撃つ方がまし）
                const fresh = await readReplies(storyId, true).catch((e) => {
                    console.error(`postStoryReply: 数の読み直しに失敗（${storyId}）:`, e);
                    return null;
                });
                if (fresh) count = fresh.length;
            }
            try {
                await ddb.send(new UpdateCommand({
                    TableName: PHOTOS_TABLE,
                    Key: { id: storyId },
                    UpdateExpression: "SET replyCount = :n",
                    ConditionExpression: "attribute_exists(id)",
                    ExpressionAttributeValues: { ":n": count },
                }));
                break;
            } catch (e) {
                if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
                    console.error(`postStoryReply: 行が消えていました（${storyId}）:`, e);
                    // 行が消えている＝いま作り直した文書は誰も辿れない。片付ける
                    await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: storyRepliesId(storyId) } }))
                        .catch((e2) => console.error(`postStoryReply: 孤児の掃除に失敗（${storyId}）:`, e2));
                    break;
                }
                console.error(`postStoryReply: 件数を書けませんでした（${storyId}・${attempt + 1}回目）:`, e);
                if (attempt < COUNT_WRITE_RETRIES) {
                    await new Promise((r) => setTimeout(r, COUNT_RETRY_BASE_MS * 2 ** attempt * (0.5 + Math.random())));
                }
            }
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

        // **ブロックした相手の返信は出さない（両向き）。**
        //
        // `postStoryReply` が断るのは**これから来るぶん**だけ。返信は
        // `{uid, name}` を書き込みの時点で焼き込むので、ブロックしても
        // **それまでに届いたぶんは名前つきで残る**（ストーリーの残り寿命＝
        // 最大24時間）。通知・閲覧者と同じ型。
        //
        // **窓を切る前に落とす。** ただし**今この順序で結果が変わることは無い**
        // ——`postStoryReply` が保存の時点で必ず `slice(-REPLIES_MAX)` を通す
        // ので（190行）、`all` が200件を超える状態はどの書き込み経路からも
        // 作れない。順序をこちらにしておくのは、書き込み側の上限が外れても
        // 読み側が壊れないようにするため（**現に効いている修正ではない**）。
        //
        // **バッジ（`replyCount`）も同じふるいを通す。** 通していなかった頃は
        // 「返信 1件」を押すと「まだ返信はありません」になった
        // ——ブロックの導線は**返信一覧の中にしか無い**ので、
        // 「返信1件 → 読む → ブロック」といういちばん起きる筋で必ずそうなる。
        // 揃えるのは `getStories` 側（`visibleReplyCount`）。
        const hidden = all.length === 0
            ? new Set<string>()
            // 読めなければ一覧は返す（`getStories` と同じ判断）
            : await hiddenUserIds(callerId).catch((e) => {
                console.error("getStoryReplies: ブロック一覧を読めませんでした:", e);
                return new Set<string>();
            });
        const visible = hidden.size === 0 ? all : all.filter((r) => !hidden.has(r.uid));
        const items = visible.slice(-REPLIES_MAX).reverse();   // 末尾追記なので後ろが新しい
        // 退会した人の名前は出さない（`getComments` と同じ）。0件なら引きに行かない
        const gone = items.length === 0 ? new Set<string>() : await deletedUserIds();
        const safeItems = gone.size === 0
            ? items
            : items.map((r) => (gone.has(r.uid) ? { ...r, name: DELETED_USER_NAME, deleted: true } : r));
        return {
            // 本人向けの内容。共有キャッシュに載せない
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            // `count` も落としたあとの数（この応答の中で食い違わせない）
            body: JSON.stringify({ items: safeItems, count: visible.length }),
        };
    } catch (e) {
        console.error("getStoryReplies error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};
