import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand, DeleteCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { isBlocked } from "./blockCheck";
import { isFollowing } from "./followCheck";
import { STORY_FOLLOWERS_ONLY, storyVisibility } from "./storyVisibility";
import { isStoryVote, type StoryText, type StoryVoteChoice, type StoryVoteState } from "./storyText";

/**
 * ストーリーの投票スタンプ（2択）に票を入れる。
 *
 * **返信（`storyReplies.ts`）と同じ門を通り、同じ場所に置く。** ストーリー
 * ごとに1つの文書（`storyvotes#<storyId>`）。**`stories.ts` には足さない**
 * ——あちらは投稿・一覧・削除で既に 770 行あり、票の規則（1人1票・上限・
 * 結果を誰に見せるか）を混ぜると、一覧の門（ブロック・フォロワー限定）と
 * 票の門を別々に直すたびに互いを壊す。
 *
 * **返信と違うところ**（意図的な差）:
 *   - **1人1票、変えられない。** 票は名前を持たない数なので、変えられる
 *     形にすると「押し直しで数を揺らす」以外の使い道が無い。
 *     `NOT contains(votersA, :uid) AND NOT contains(votersB, :uid)` の条件で
 *     **書き込みそのものが2票目を断る**（読んで数えてから書く形だと、
 *     同時に投げれば両方通る——`comments.ts` が踏んだ形）
 *   - **結果（数）が見えるのは投稿者と、票を入れた人だけ。** 入れる前に
 *     数が見えると、多い方に寄る（投票の意味が薄れる）。投稿者は
 *     自分の問いの答えなので最初から見える
 *   - **「返信を許可」は見ない。** 投票は投稿者が自分で置いたスタンプで、
 *     返信の帯とは別の意思表示。返信を切っていても票は受ける
 *   - **通知は出さない。** 票は名前を持たないので「誰が」を知らせる
 *     ものが無く、1票ごとにベルが鳴るとうるさいだけ
 *
 * **保存の形**（1文書・1回の書き込みで全部が決まる）:
 *
 *     votersA / votersB   文字列セット（票を入れた人の uid）
 *     total               数（上限の見張りに使う。数は set の大きさから）
 *
 * `ADD` は無ければ作るので、文書を先に作る手順が要らない。数（a/b）を
 * 別の数字として持たないのは、**セットと数字が食い違う形を作らない**ため。
 *
 * **ストーリーの行と同じトランザクションで書く。** 票の文書は `storyFeed`
 * も `story` も持たないので、行が消えたあとに作ると**どの削除経路からも
 * 二度と辿れない**（`postStoryReply` が `replyCount` の書き込みで
 * 同じ事故を長いコメント付きで塞いでいる）。あちらは「行が在るか」を
 * あとから確かめて孤児を掃除しに行くが、ここは書き込みが1回なので
 * `ConditionCheck(attribute_exists(id))` を同じトランザクションに乗せる方が短い。
 * この `ConditionCheck` には IAM の `dynamodb:ConditionCheckItem` が要る
 * （`serverless.yml` の共有ロール。無いと全部の票が 500）。
 *
 * **これで塞がるのは「行が消えた後」だけ。** 削除経路は文書 → 行 の順で
 * 消す（消し損ねの手がかりを行に残すため）ので、文書を消してから行を
 * 消すまでの間に票が通ると、行はまだ在るから条件を満たし、文書が
 * 作り直される。だから各経路は**行を消したあとにもう一度**
 * `sweepStoryVotes` で文書を消す——行が消えたあとは新しい文書を作れない
 * ので、この2回目で確定する。
 */

/** 1つのストーリーが受ける票の数。返信（200）より多いのは、票は1人1つで軽いから */
export const VOTES_MAX = 1000;

export const storyVotesId = (storyId: string) => `storyvotes#${storyId}`;

/**
 * 行を消した**あと**に `storyvotes#<id>` をもう一度消す（上の docstring）。
 * 失敗は記録するだけ——行はもう無いので、ここで止めても戻せるものが無い。
 * 4つの削除経路（`deleteStory`・期限切れの掃除・残した写真の削除・退会）が
 * 行の削除の直後に呼ぶ。
 */
export async function sweepStoryVotes(storyId: string): Promise<void> {
    try {
        await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: storyVotesId(storyId) } }));
    } catch (e) {
        console.error(`sweepStoryVotes: 票の文書を消せませんでした（${storyId}）:`, e);
    }
}

/** 票の文書（読んだままの形。DocumentClient は SS を `Set` で返す） */
type VotesRow = {
    votersA?: Set<string> | string[];
    votersB?: Set<string> | string[];
    total?: number;
};

const toSet = (v: Set<string> | string[] | undefined): Set<string> =>
    v instanceof Set ? v : new Set(Array.isArray(v) ? v : []);

/** ストーリーの行が投票スタンプを持つか（`texts` に `kind: "vote"` が1つある） */
export function storyHasVote(texts: unknown): boolean {
    return Array.isArray(texts) && (texts as StoryText[]).some((t) => t && typeof t === "object" && isStoryVote(t));
}

async function readVotes(storyId: string, consistent = false): Promise<VotesRow | null> {
    const res = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: storyVotesId(storyId) },
        ...(consistent ? { ConsistentRead: true } : {}),
    }));
    return (res.Item as VotesRow | undefined) ?? null;
}

function stateOf(row: VotesRow | null, uid: string, isOwner: boolean): StoryVoteState {
    const a = toSet(row?.votersA);
    const b = toSet(row?.votersB);
    const myVote: StoryVoteChoice | undefined = a.has(uid) ? "a" : b.has(uid) ? "b" : undefined;
    // **数は、投稿者と票を入れた人だけ**（入れる前に見えると多い方に寄る）
    const counts = isOwner || myVote ? { a: a.size, b: b.size } : undefined;
    return { ...(myVote ? { myVote } : {}), ...(counts ? { counts } : {}) };
}

/**
 * 一覧（`getStories`）に付ける票の状態。**投票スタンプを持つ行にだけ**
 * 呼ぶこと（呼び側が `storyHasVote` で絞る。持たない行に読みに行くと
 * 一覧の往復がストーリーの数だけ増える）。
 *
 * **読めなければ null**——呼び側は付けずに返す（票の状態が無い＝
 * 「まだ入れていない・数は見えない」の表示になり、押せば書き込みが
 * 2票目を断るので、間違った状態を保存することは無い）。
 */
export async function storyVoteState(storyId: string, uid: string, isOwner: boolean): Promise<StoryVoteState | null> {
    try {
        return stateOf(await readVotes(storyId), uid, isOwner);
    } catch (e) {
        console.error(`storyVoteState: 票を読めませんでした（${storyId}）:`, e);
        return null;
    }
}

type StoryItem = {
    story?: boolean; userId?: string; uploadedBy?: string;
    expiresAt?: string; visibility?: unknown; texts?: unknown;
};

async function loadStory(storyId: string): Promise<StoryItem | null> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: storyId } }));
    const item = res.Item as StoryItem | undefined;
    if (!item || item.story !== true) return null;
    return item;
}

type Cancel = { Code?: string };
/** `TransactWriteItems` が断った理由（並び順は `TransactItems` と同じ） */
function cancellationReasons(e: unknown): Cancel[] {
    const err = e as { name?: string; CancellationReasons?: Cancel[] };
    return err.name === "TransactionCanceledException" && Array.isArray(err.CancellationReasons)
        ? err.CancellationReasons
        : [];
}

/** POST /stories/{id}/vote — 2択に票を入れる（認証必要・1人1票） */
export const voteStory: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    const storyId = event.pathParameters?.id;
    if (!uid || !storyId) return jsonError(400, "不正なリクエスト");

    let body: { choice?: unknown };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return jsonError(400, "不正なリクエスト");
    }
    const choice = body.choice === "a" || body.choice === "b" ? body.choice : null;
    if (!choice) return jsonError(400, "選択肢を選んでください");

    try {
        const story = await loadStory(storyId);
        if (!story) return jsonError(404, "ストーリーが見つかりません");
        const ownerId = story.userId ?? story.uploadedBy;
        // 自分の問いに自分で答えない（`postStoryReply` と同じ判断）
        if (ownerId === uid) return jsonError(400, "自分の投票には票を入れられません");
        // 期限切れは「もう無い」（行が残っているのは掃除が1時間ごとだから）
        if (story.expiresAt && String(story.expiresAt) <= new Date().toISOString()) {
            return jsonError(404, "ストーリーが見つかりません");
        }
        // **ブロック・フォロワー限定は 404**（相手の設定を教えない。
        // `viewStory` / `postStoryReply` と同じ門。**画面側だけの防御を作らない**）
        if (ownerId && await isBlocked(ownerId, uid)) return jsonError(404, "ストーリーが見つかりません");
        if (ownerId && storyVisibility(story.visibility) === STORY_FOLLOWERS_ONLY
            && !await isFollowing(ownerId, uid)) {
            return jsonError(404, "ストーリーが見つかりません");
        }
        // 投票スタンプの無いストーリーには入れられない（票の行き先が無い）。
        // 400 で理由を言う——投稿の中身の話で、相手の設定ではない
        if (!storyHasVote(story.texts)) return jsonError(400, "この投稿に投票はありません");

        const now = new Date().toISOString();
        const set = choice === "a" ? "votersA" : "votersB";
        try {
            await ddb.send(new TransactWriteCommand({
                TransactItems: [
                    // 行がまだ在ること（消えたあとに孤児を作らない）。**棚へ移った行
                    // （`archivedAt`）にも入れない**——棚入れは票の文書を消すので、
                    // そのあとに通ると他人の uid が棚の行の隣に残る。`postStoryReply` の
                    // 件数更新・`keepStory` と同じ条件
                    {
                        ConditionCheck: {
                            TableName: PHOTOS_TABLE,
                            Key: { id: storyId },
                            ConditionExpression: "attribute_exists(id) AND attribute_not_exists(archivedAt)",
                        },
                    },
                    // **1人1票と上限を、書き込みの条件で守る**
                    {
                        Update: {
                            TableName: PHOTOS_TABLE,
                            Key: { id: storyVotesId(storyId) },
                            UpdateExpression: `ADD ${set} :me, #total :one SET storyId = :sid, updatedAt = :now`,
                            ConditionExpression:
                                "(attribute_not_exists(votersA) OR NOT contains(votersA, :uid))"
                                + " AND (attribute_not_exists(votersB) OR NOT contains(votersB, :uid))"
                                + " AND (attribute_not_exists(#total) OR #total < :max)",
                            ExpressionAttributeNames: { "#total": "total" },
                            ExpressionAttributeValues: {
                                ":me": new Set([uid]), ":uid": uid, ":one": 1, ":max": VOTES_MAX,
                                ":sid": storyId, ":now": now,
                            },
                        },
                    },
                ],
            }));
        } catch (e) {
            const reasons = cancellationReasons(e);
            if (reasons.length === 0) throw e;
            // 行が消えていた（削除と同時に押された）
            if (reasons[0]?.Code === "ConditionalCheckFailed") return jsonError(404, "ストーリーが見つかりません");
            if (reasons[1]?.Code === "ConditionalCheckFailed") {
                // 2票目か、上限か。読んで見分ける（どちらも保存はしていない）。
                // **読めなければ 409**——500 にすると「押した票が消えた」と
                // 読まれるが、票は入っている（または上限）。`postStoryReply` の
                // 競合と同じ語で、押し直してもらう
                const row = await readVotes(storyId, true).catch((e2) => {
                    console.error(`voteStory: 2票目の見分けで読めませんでした（${storyId}）:`, e2);
                    return undefined;
                });
                if (row === undefined) return jsonError(409, "混み合っています。もう一度お試しください");
                const mine = stateOf(row, uid, false).myVote;
                if (mine) {
                    // **投票済みは 200 で今の状態を返す。** 押し直し（同じ人が
                    // もう一度押した・古い画面から押した）でここへ来るので、
                    // 409 にすると「押したのに失敗した」と読まれる。
                    // （SDK 自身の再送は `ClientRequestToken` で冪等に成功するので
                    //   ここには来ない）
                    return {
                        statusCode: 200,
                        headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
                        body: JSON.stringify({ success: true, ...stateOf(row, uid, false) }),
                    };
                }
                return jsonError(429, `この投票は${VOTES_MAX}票までです`);
            }
            throw e;
        }

        // 入れた人には数を返す（読み直しは強整合——いま書いたぶんを含める）
        const row = await readVotes(storyId, true).catch((e) => {
            console.error(`voteStory: 票を読み直せませんでした（${storyId}）:`, e);
            return null;
        });
        // 読めなかった回も**票は入っている**。`myVote` だけ返し、数は次の一覧で
        const state: StoryVoteState = row ? stateOf(row, uid, false) : { myVote: choice };
        return {
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            body: JSON.stringify({ success: true, ...state }),
        };
    } catch (e) {
        console.error("voteStory error:", e);
        return jsonError(500, "送信に失敗しました");
    }
};
