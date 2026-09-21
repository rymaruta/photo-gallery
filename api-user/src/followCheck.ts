import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";

/**
 * フォローの**読み取りだけ**。`follow.ts` から切り出してある。
 *
 * **分け方は `blockCheck.ts` と同じ**（読むだけをこちら・書き込みは
 * `follow.ts` のまま）。理由も同じで、`follow.ts` は関係を切るために
 * いろいろ引き込んでいる（`notify` / `userList` / `blockCheck` / `env`）ので、
 * **「この import は輪にならないか」を呼び手ごとに考えさせない**ために
 * 読むだけの物をここに集める。`blockCheck.ts` の docstring が、
 * 呼び手ごとに考えさせる置き方で実際に輪を作った経緯を書いている。
 *
 * **鍵の組み立ては `follow.ts` もここから引く。** 書き手と読み手で
 * 別々に `` `follow#${a}#${b}` `` と書くと静かにずれる（このリポジトリが
 * 何度も踏んでいる形）。
 *
 * ⚠️ `account.ts` は退会処理の中で `` `follow#${target}#${uid}` `` を
 * 直書きしている（198・248行）。移していないのは、退会は別の流れで
 * 消す順序まで含めて固まっているため——**ここを直すなら合わせて直す**。
 */

/** 冪等マーカー。`follower` が `target` をフォローしている印 */
export const followMarkerId = (target: string, follower: string) => `follow#${target}#${follower}`;
/** 自分がフォローしている人の一覧 */
export const followingId = (uid: string) => `following#${uid}`;
/** 自分をフォローしている人の一覧 */
export const followersId = (uid: string) => `followers#${uid}`;

/**
 * `follower` が `target` をフォローしているか。**GetItem 1回**。
 *
 * 一覧（`following#`）ではなくマーカーを引くのは、一覧が上限
 * （`FOLLOWING_MAX` = 2000）で切り捨てられても判定が狂わないようにするため
 * ——`isBlocked` がまったく同じ理由で同じ形をしている。
 *
 * **一覧（`getStories`）もこちらを使う**（投稿者ごとに1回）。
 * `following#<自分>` を1回読む方が安いが、あの行は信用できない:
 *
 *   - `unfollowQuietly` はマーカーを消したあとの一覧の書き込みの失敗を
 *     握り潰す（`follow.ts:536`）＝**解除した相手が一覧に残る**。
 *     一覧で判定すると、その相手のフォロワー限定ストーリーが中身ごと出る
 *   - `updateUserList` は上限2000で古い方から落とす＝**実際に追っている
 *     相手が静かに消える**
 *
 * **読めなかったときは投げる。** 呼び出し側が「見せない側に倒す」か
 * 「見せる側に倒す」かを選べるようにする（ここで false を返すと、
 * 一時的な失敗が黙って「フォローしていない」になる）。
 */
export async function isFollowing(target: string, follower: string): Promise<boolean> {
    if (!target || !follower || target === follower) return false;
    const res = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: followMarkerId(target, follower) },
    }));
    return !!res.Item;
}
