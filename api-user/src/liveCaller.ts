import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./dynamodb";
import { requireEnv } from "./env";
import { jsonError } from "./http";
import { isDeletedProfile } from "./types";

/**
 * **退会した本人の「書く口」を塞ぐ共通の確かめ。**
 *
 * API Gateway の JWT オーソライザは署名と exp しか見ない。退会（`account.ts`）で
 * Cognito のユーザーを消しても、**既に配った ID トークンは期限まで通る**
 * （`__tests__/deletedTombstone.test.ts` の冒頭）。プロフィールの読み書き
 * （`userProfile.ts`）は墓石を見て 410 を返していたが、ほかの書く口は見ていなかった。
 * 2026-10-18 に確かめた被害（origin/main 3648874c）:
 *
 *   - 写真の保存（`upload.ts` の `savePhoto`）が通り、公開の一覧に**退会した人の写真**が
 *     出る。静的サイトの作り直しも頼まれ、トランクのラベル配り（`grantLabel`）が
 *     `trunk#`・`trunkledger#` を作り直し、「この写真を見て撮影」の通知が他人に飛ぶ
 *   - コメント・いいね・フォロー・ストーリー・端末の登録……が、**掃除の済んだあとに**
 *     行を作り直す。退会の掃除はもう走らないので、誰も消さない
 *
 * 書く口の入口でこれを呼ぶ。`serverless.yml` の認証つきの書く口が全部呼んでいることは
 * `__tests__/liveCallerGuard.test.ts` が見張る（除外は理由つきでそこに並べる）。
 *
 * **2026-10-18 判断: 読めなかったら通さない（500）。** 既に墓石を見ている口
 * （`getMyProfile`・`updateMyProfile`・`getLightForecast`）は、users の読みが落ちたら
 * 例外のまま 500 を返している——生きている前提で書き進めない。ここもそれに合わせる。
 * 読み落ちは一時的なので、押し直せば通る。「読めなければ生きている扱いで通す」にすると、
 * 墓石の確かめが**いちばん要るときに黙って外れる**（障害の最中は見張りが無いのと同じ）。
 *
 * **読むのは users の1行を1回だけ。** 強い読み（ConsistentRead）にはしない——退会の最中の
 * 競り合い（数えたあと・墓石を書く前の保存）はこの確かめでは閉じられない
 * （それは別の仕組みが要る）。ここで塞ぐのは「退会が済んだあとに残ったトークン」。
 *
 * 🔴 **射影に `deletedAt` を必ず入れる。** 入れないと墓石の印は返らず、
 * `isDeletedProfile` は常に false になって死ぬ（`types.ts` の注記。テストのモックは
 * 射影を無視するので緑のまま穴が開く）。
 */

const USERS_TABLE = requireEnv("USERS_TABLE");

export const ACCOUNT_GONE_MESSAGE = "このアカウントは削除されています";

/** 退会済みの本人への答え（410 Gone——通信の失敗でも権限でもなく「もう無い」） */
export function accountGone(): APIGatewayProxyStructuredResultV2 {
    return jsonError(410, ACCOUNT_GONE_MESSAGE);
}

/** 既に読んだ users の行で判定する（読みを増やしたくない口が使う）。墓石なら 410、生きていれば null */
export function goneIfDeleted(row: unknown): APIGatewayProxyStructuredResultV2 | null {
    return isDeletedProfile(row) ? accountGone() : null;
}

/**
 * 本人の users の行を、墓石の印つきで1回読む。
 *
 * `extra` は**同じ読みで一緒に欲しい属性**（例: 写真の保存の `displayName`）。
 * 返り値は `{ gone }`（410 か 500。そのまま返す）か `{ row }`（行が無い人は `undefined`）。
 *
 * **行が無い人は通す。** PostConfirmation の取りこぼしで行が無いまま使っている人が居る
 * （`userProfile.ts` の `createProfileIfMissing`）。墓石は「行が在って `deletedAt` が文字列」
 * だけ——無い行まで弾くと、その人たちが何も書けなくなる。
 */
export async function readLiveCaller(
    uid: string,
    extra: readonly string[] = [],
): Promise<{ gone: APIGatewayProxyStructuredResultV2 } | { row: Record<string, unknown> | undefined }> {
    // 予約語（name など）が来ても壊れないよう、属性名はすべて置き換えて渡す
    const attrs = ["userId", "deletedAt", ...extra.filter((a) => a !== "userId" && a !== "deletedAt")];
    const names: Record<string, string> = {};
    attrs.forEach((a, i) => { names[`#a${i}`] = a; });
    let row: Record<string, unknown> | undefined;
    try {
        const res = await ddb.send(new GetCommand({
            TableName: USERS_TABLE,
            Key: { userId: uid },
            ProjectionExpression: Object.keys(names).join(", "),
            ExpressionAttributeNames: names,
        }));
        row = res.Item as Record<string, unknown> | undefined;
    } catch (e) {
        console.error(`readLiveCaller: 本人の行を読めませんでした（${uid}）:`, e);
        return { gone: jsonError(500, "アカウントの確認に失敗しました。もう一度お試しください") };
    }
    const gone = goneIfDeleted(row);
    return gone ? { gone } : { row };
}

/**
 * 書く口の入口で呼ぶ。墓石なら 410（読めなければ 500）を返すので、そのまま返す。生きていれば null。
 *
 *     const gone = await assertLiveCaller(userId);
 *     if (gone) return gone;
 */
export async function assertLiveCaller(uid: string): Promise<APIGatewayProxyStructuredResultV2 | null> {
    const r = await readLiveCaller(uid);
    return "gone" in r ? r.gone : null;
}
