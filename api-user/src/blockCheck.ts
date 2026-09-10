import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";

/**
 * ブロックの**判定だけ**。`block.ts` から切り出してある。
 *
 * 切り出す理由は循環の回避——`block.ts` は関係を切るために
 * `follow.ts` の `unfollowQuietly` を呼ぶので、**`follow.ts` から
 * `block.ts` を import すると輪になる**。同じ理由で `isUserId` を
 * `userId.ts` に、写真の上限を `photoLimit.ts` に切り出した前例がある。
 *
 * ここには印の綴りと GetItem 1回だけを置く。一覧（`blocks#` /
 * `blockedby#`）や書き込みは `block.ts` のまま。
 */
export const blockMarkerId = (blocker: string, blocked: string) => `block#${blocker}#${blocked}`;

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
