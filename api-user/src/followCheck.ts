import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { readUserList } from "./userList";
import { isUserId } from "./userId";

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
 * **1件を確かめる経路（閲覧の記録・返信）だけがこちらを使う。**
 * 一覧を引く `getStories` は `followingIds` の方（相手の数だけ
 * GetItem を撃たない）。
 */
export async function isFollowing(target: string, follower: string): Promise<boolean> {
    if (!target || !follower || target === follower) return false;
    const res = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: followMarkerId(target, follower) },
    }));
    return !!res.Item;
}

/**
 * 自分がフォローしている人の集合。**一覧のふるい1回につき GetItem 1回**。
 *
 * `follow.ts` の `readFollowing` と同じ行を読む。形の違う ID を落とすのも
 * 同じ（`readUserList` が `isUserId` で濾す）——**でたらめな ID が本番に
 * 実在する**ことが `backfill-followers` のドライランで確認されている。
 *
 * **読めなかったときは投げる。** 呼び出し側が「見せない側に倒す」か
 * 「見せる側に倒す」かを選べるようにする（ここで空集合を返すと、
 * 一時的な失敗が黙って「誰もフォローしていない」になる）。
 */
export async function followingIds(uid: string): Promise<Set<string>> {
    if (!uid) return new Set();
    return new Set(await readUserList(followingId(uid), isUserId, `following#${uid}`));
}
