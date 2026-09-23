import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { readUserList, updateUserList, UserListError } from "./userList";

/**
 * 「親しい友達」（モック4-7 の3つ目）。
 *
 * **自分が選んだ人の一覧を1行で持つ。** フォロワーの中から選ぶものでは
 * なく、**誰でも入れられる**（相手には知らせない——Instagram と同じで、
 * 知らせると「外された」が分かってしまう）。
 *
 * 一覧の持ち方は `userList.ts` に寄せる（いいね・フォローと同じ形）。
 * 相手ごとのマーカーは作らない——**この一覧が唯一の真値**で、
 * 2か所に持つとずれる。
 */
export const CLOSE_FRIENDS_MAX = 200;

export const closeFriendsId = (userId: string) => `closefriends#${userId}`;

/** Cognito の sub の形（`follow.ts` と同じ線） */
export function isUserId(value: string): boolean {
    return /^[A-Za-z0-9-_:]{8,128}$/.test(value);
}

/**
 * GET /user/close-friends — 自分が選んだ「親しい友達」の id。
 *
 * **他人の一覧は引けない。** 誰が入っているかは本人だけのもの。
 */
export const getCloseFriends: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(401, "認証が必要です");
    try {
        const userIds = await readUserList(closeFriendsId(userId), isUserId, `closefriends#${userId}`);
        return {
            statusCode: 200,
            // 利用者ごとの答えなので共有キャッシュには載せない
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            body: JSON.stringify({ userIds }),
        };
    } catch (e) {
        console.error("getCloseFriends error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

/**
 * PUT /user/close-friends/{id} — 入れる / 外す。
 *
 * **1人ずつ。** 一覧を丸ごと送らせると、古い画面が開いたまま保存したときに
 * その間の変更が消える（`userList` の rev はその衝突を見るためのもので、
 * 「古い一覧で上書き」までは止められない）。
 */
export const setCloseFriend: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    const targetId = event.pathParameters?.id;
    if (!userId || !targetId || !isUserId(targetId)) return jsonError(400, "不正なリクエスト");
    // **自分は入れられない。** 自分のストーリーは自分に必ず見えるので、
    // 入れても何も変わらない札が1つ増えるだけ
    if (targetId === userId) return jsonError(400, "自分は追加できません");

    const wanted = event.requestContext.http.method !== "DELETE";
    try {
        await updateUserList(
            closeFriendsId(userId),
            userId,
            CLOSE_FRIENDS_MAX,
            (list: string[]) => {
                const has = list.includes(targetId);
                if (wanted === has) return null;   // 変わらないなら書かない
                if (!wanted) return list.filter((id) => id !== targetId);
                // **新しい順に積む**（`userList` の上限は古い方から溢れる）
                return [targetId, ...list];
            },
        );
        return {
            statusCode: 200,
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            body: JSON.stringify({ userId: targetId, closeFriend: wanted }),
        };
    } catch (e) {
        if (e instanceof UserListError) {
            console.error("setCloseFriend: 一覧を書けませんでした:", e);
            return jsonError(503, "保存に失敗しました。時間をおいて試してください");
        }
        console.error("setCloseFriend error:", e);
        return jsonError(500, "保存に失敗しました");
    }
};
