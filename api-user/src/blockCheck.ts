import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";

/**
 * ブロックの**読み取りだけ**。`block.ts` から切り出してある。
 *
 * 切り出す理由は循環の回避——`block.ts` は関係を切るために
 * `follow.ts` の `unfollowQuietly` を呼ぶので、**`follow.ts` から
 * `block.ts` を import すると輪になる**。同じ理由で `isUserId` を
 * `userId.ts` に、写真の上限を `photoLimit.ts` に切り出した前例がある。
 *
 * **`hiddenUserIds` もここに置く。** 元は `block.ts` にあり、
 * `stories` / `storyReplies` / `notifications` は「戻る辺が無いので輪に
 * ならない」という理由でそちらから import していた。だが `follow.ts` には
 * 戻る辺がある——実際、フォロー一覧にブロックのふるいを入れたとき
 * `follow.ts` から `block.ts` を import して**輪を作った**
 * （`block.ts` のコメントが名指しで禁じている形）。
 * 「この import は輪にならないか」を呼び手ごとに考えさせる置き方だったのが
 * 原因なので、**読むだけの物はここに集める**（書き込みは `block.ts` のまま）。
 */
export const blockMarkerId = (blocker: string, blocked: string) => `block#${blocker}#${blocked}`;

export const blocksId = (uid: string) => `blocks#${uid}`;
export const blockedById = (uid: string) => `blockedby#${uid}`;

/** 文字列だけの配列にして返す（壊れた行で落ちない）。書き込み側（`block.ts`）も使う */
export function ids(item: Record<string, unknown> | undefined, field: string): string[] {
    const v = item?.[field];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * 見せない相手の集合（自分がブロックした人 ∪ 自分をブロックした人）。
 * 一覧を引く画面（ストーリーなど）が1回だけ呼ぶ。
 */
export async function hiddenUserIds(uid: string): Promise<Set<string>> {
    if (!uid) return new Set();
    const [mine, theirs] = await Promise.all([
        ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: blocksId(uid) } })),
        ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: blockedById(uid) } })),
    ]);
    return new Set([
        ...ids(mine.Item as Record<string, unknown> | undefined, "blockedIds"),
        ...ids(theirs.Item as Record<string, unknown> | undefined, "blockerIds"),
    ]);
}

/**
 * `blocker` が `blocked` をブロックしているか。**GetItem 1回**。
 *
 * 一覧（`blocks#`）ではなく印を引くのは、一覧が上限で切り捨てられても
 * 判定が狂わないようにするため（`follow.ts` が2000人の切り捨てで
 * 「画面から解除できない」を作った形を、こちらでは作らない）。
 */
export async function isBlocked(blocker: string, blocked: string): Promise<boolean> {
    if (!blocker || !blocked || blocker === blocked) return false;
    const res = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: blockMarkerId(blocker, blocked) },
    }));
    return !!res.Item;
}
