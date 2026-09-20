import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { getUserId, jsonError, JSON_HEADERS, type AuthedEvent } from "./http";
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";

/**
 * プッシュ通知の宛先（端末のトークン）。
 *
 * **1人1行に集める**（`devices#<uid>`）。通知を送るのは「誰かの行動 →
 * 相手の端末」で、相手の端末を**1回の GetItem で全部**引きたいから
 * ——索引を足して Query するより安く、`notifs#<uid>` と同じ形に揃う。
 *
 * **DynamoDB の Set に入れる。** `ADD`／`DELETE` はアトミックで、
 * 同じトークンを二度足しても増えない。配列で持つと「読んで足して書く」に
 * なり、2台の端末がほぼ同時に登録すると片方が消える
 * （`notify.ts` の切り詰めが同じ形で一度踏んでいる）。
 */
export const devicesId = (uid: string) => `devices#${uid}`;

/**
 * 1人が持てる端末の数。
 *
 * **際限なく増やさない。** アプリは起動のたびに登録するので、端末を
 * 買い替え続けると古いトークンが積もる。APNs は無効なトークンを 410 で
 * 教えてくれるが、それは**送ってみて初めて**分かる——送る相手が増えるほど
 * 1回の通知が重くなる。新しい順に残す。
 */
export const DEVICES_MAX = 10;

/** APNs のトークンは16進。長さは機種と OS で変わるので幅で見る */
export function isDeviceToken(v: unknown): v is string {
    return typeof v === "string" && /^[0-9a-f]{32,200}$/i.test(v.trim());
}

/** その人の端末トークン。引けなければ空（通知が飛ばないだけ） */
export async function deviceTokens(uid: string): Promise<string[]> {
    try {
        const res = await ddb.send(new GetCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: devicesId(uid) },
            ProjectionExpression: "tokens",
        }));
        const tokens = res.Item?.tokens;
        // lib-dynamodb は DynamoDB の Set を JS の Set にして返す
        if (tokens instanceof Set) return [...tokens].map(String);
        return Array.isArray(tokens) ? tokens.map(String) : [];
    } catch (e) {
        console.error(`deviceTokens: 端末を引けませんでした（${uid}）:`, e);
        return [];
    }
}

/**
 * 無効になったトークンを外す。
 *
 * **APNs が 410 を返したときにだけ呼ぶ。** 送信の失敗で外すと、
 * 一時的な不通で宛先を失う（次からは通知が届かないのに誰も気づけない）。
 */
export async function forgetTokens(uid: string, tokens: readonly string[]): Promise<void> {
    const dead = tokens.filter(isDeviceToken);
    if (dead.length === 0) return;
    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: devicesId(uid) },
            UpdateExpression: "DELETE #tokens :dead",
            ExpressionAttributeNames: { "#tokens": "tokens" },
            ExpressionAttributeValues: { ":dead": new Set(dead) },
        }));
    } catch (e) {
        console.error(`forgetTokens: 外せませんでした（${uid}）:`, e);
    }
}

/** 端末を登録する。`POST /user/devices` */
export const registerDevice: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event as AuthedEvent);
    if (!userId) return jsonError(401, "認証が必要です");

    let body: { token?: unknown };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return jsonError(400, "不正なリクエスト");
    }
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!isDeviceToken(token)) return jsonError(400, "端末のトークンが不正です");

    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: devicesId(userId) },
            UpdateExpression: "ADD #tokens :token SET uid = :uid, updatedAt = :now",
            ExpressionAttributeNames: { "#tokens": "tokens" },
            ExpressionAttributeValues: {
                ":token": new Set([token]),
                ":uid": userId,
                ":now": new Date().toISOString(),
            },
        }));
        // **溢れたら古い方を落とす。** 落とせなくても登録は成功で返す
        // （送る側が重くなるだけで、通知は届く）
        await trimTokens(userId, token);
    } catch (e) {
        console.error(`registerDevice error（${userId}）:`, e);
        return jsonError(500, "登録できませんでした");
    }
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };
};

/**
 * 上限を超えたぶんを落とす。**いま登録した1台は必ず残す。**
 *
 * Set には順番が無いので「古い順」は分からない。落とす相手を選べない以上、
 * **今の1台を残して、残りから溢れたぶんを外す**のが唯一安全な形
 * （無効なトークンは APNs の 410 で自然に消えていく）。
 */
async function trimTokens(uid: string, keep: string): Promise<void> {
    const tokens = await deviceTokens(uid);
    if (tokens.length <= DEVICES_MAX) return;
    const extra = tokens.filter((t) => t !== keep).slice(0, tokens.length - DEVICES_MAX);
    await forgetTokens(uid, extra);
}

/** 端末を外す（ログアウト・通知オフ）。`DELETE /user/devices` */
export const unregisterDevice: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event as AuthedEvent);
    if (!userId) return jsonError(401, "認証が必要です");

    let body: { token?: unknown };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return jsonError(400, "不正なリクエスト");
    }
    const token = typeof body.token === "string" ? body.token.trim() : "";
    // **無いトークンを外せと言われても 200。** ログアウトの後始末なので、
    // ここで止めると「ログアウトできない」になる
    if (!isDeviceToken(token)) {
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };
    }
    await forgetTokens(userId, [token]);
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };
};
