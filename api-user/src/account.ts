import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { QueryCommand, GetCommand, DeleteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { ddb, PHOTOS_TABLE, USER_INDEX } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { mediaKeys } from "./mediaKeys";
import { requireEnv } from "./env";

// 退会（アカウント削除）。DELETE /user/account、認証必須、呼び出し元の sub のみ対象。
// 不可逆な破壊操作のため「確実に引ける範囲を確実に消す」方針:
//   - 自分の写真/ストーリー … GSI(userId-createdAt-index) で列挙 → S3 本体 + DDB item 削除
//   - アバター/カバー       … profiles/<uid>・profiles/<uid>/cover（決定的キー）
//   - プロフィール          … USERS_TABLE の {userId}
//   - 自分の各ドキュメント  … golist#/notifs#/followstats#/following#
//   - 自分が押した「行く」   … golist の各エントリの go# マーカー削除 + 対象写真 goCount 減算
//   - 自分の「フォロー中」   … following の各 target の follow# マーカー削除 + target.followers 減算
// 1件失敗しても続行（stories cleanup と同じ耐障害方針）。最後に { ok: true }。
//
// v1 スコープ外（消さない・許容）: 「いいね」マーカー / 各写真に散在する自分のコメント /
// 自分への被フォロー。いずれも per-user インデックスが無く全 Scan が必要なため今回は対象外。
// 写真が消えれば実害は軽微（孤立マーカー + 他人側の軽微なカウント残り）で、将来の定期
// リコンサイル（Scan バッチ）で掃除できる。

const USERS_TABLE = requireEnv("USERS_TABLE");
const UPLOAD_BUCKET = process.env.UPLOAD_BUCKET ?? "";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

async function s3Delete(key: string): Promise<void> {
    if (!key || !UPLOAD_BUCKET) return;
    try {
        await s3.send(new DeleteObjectCommand({ Bucket: UPLOAD_BUCKET, Key: key }));
    } catch (e) {
        console.error(`deleteAccount: S3 delete failed for ${key}:`, e);
    }
}

async function ddbDelete(table: string, key: Record<string, unknown>): Promise<void> {
    try {
        await ddb.send(new DeleteCommand({ TableName: table, Key: key }));
    } catch (e) {
        console.error(`deleteAccount: DDB delete failed for ${JSON.stringify(key)}:`, e);
    }
}

/** golist#/following# 文書の list 配列を読む（無ければ空配列。エラーも空配列） */
async function readList(id: string): Promise<unknown[]> {
    try {
        const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id } }));
        const list = res.Item?.list;
        return Array.isArray(list) ? list : [];
    } catch (e) {
        console.error(`deleteAccount: read list failed for ${id}:`, e);
        return [];
    }
}

/** カウンタを 1 減らす（0 以下・item 消滅・属性欠落は無視） */
async function decrement(id: string, field: string): Promise<void> {
    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id },
            UpdateExpression: "SET #f = #f - :one",
            ConditionExpression: "attribute_exists(id) AND #f > :z",
            ExpressionAttributeNames: { "#f": field },
            ExpressionAttributeValues: { ":z": 0, ":one": 1 },
        }));
    } catch { /* 0 / 無し / 消滅は無視 */ }
}

// DELETE /user/account — 退会（認証必須・自分のデータのみ削除）
export const deleteAccount: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    if (!uid) return jsonError(401, "認証が必要です");

    try {
        // 1. 自分の写真・ストーリー（GSI で列挙）。GSI の射影に依存しないよう id を集めてから
        //    本体を GetItem し、S3 本体/サムネ + DDB item を削除する。
        let lastKey: Record<string, unknown> | undefined;
        do {
            const res = await ddb.send(new QueryCommand({
                TableName: PHOTOS_TABLE,
                IndexName: USER_INDEX,
                KeyConditionExpression: "userId = :u",
                ExpressionAttributeValues: { ":u": uid },
                ExclusiveStartKey: lastKey,
            }));
            for (const projected of (res.Items ?? []) as Record<string, unknown>[]) {
                const id = String(projected.id ?? "");
                if (!id) continue;
                let item = projected;
                try {
                    const full = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id } }));
                    if (full.Item) item = full.Item as Record<string, unknown>;
                } catch (e) {
                    console.error(`deleteAccount: get photo failed for ${id}:`, e);
                }
                for (const k of mediaKeys(item)) await s3Delete(k);
                await ddbDelete(PHOTOS_TABLE, { id });
            }
            lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
        } while (lastKey);

        // 2. アバター/カバー（決定的キー・探索不要）
        await s3Delete(`profiles/${uid}`);
        await s3Delete(`profiles/${uid}/cover`);

        // 3. プロフィール（USERS_TABLE）
        //    ユーザー名の予約（username#<handle>）も一緒に消す。残すと本人が
        //    再登録しても同じ名前を取り戻せない（releaseUsername は ownerId 一致が条件）。
        //    handle はプロフィールにしか無いので、削除より先に読む。
        try {
            const prof = await ddb.send(new GetCommand({ TableName: USERS_TABLE, Key: { userId: uid } }));
            const handle = typeof prof.Item?.username === "string" ? prof.Item.username : "";
            if (handle) await ddbDelete(USERS_TABLE, { userId: `username#${handle}` });
        } catch (e) {
            console.error("deleteAccount: release username failed:", e);
        }
        await ddbDelete(USERS_TABLE, { userId: uid });

        // 4. 自分が押した「行く」: golist の各エントリの go# マーカーを削除し、対象写真の goCount を戻す
        for (const entry of await readList(`golist#${uid}`)) {
            const photoId = typeof (entry as { photoId?: unknown })?.photoId === "string"
                ? (entry as { photoId: string }).photoId
                : "";
            if (!photoId) continue;
            await ddbDelete(PHOTOS_TABLE, { id: `go#${photoId}#${uid}` });
            await decrement(photoId, "goCount");
        }

        // 5. 自分の「フォロー中」: following の各 target の follow# マーカーを削除し、target.followers を戻す
        for (const target of await readList(`following#${uid}`)) {
            const t = typeof target === "string" ? target : "";
            if (!t) continue;
            await ddbDelete(PHOTOS_TABLE, { id: `follow#${t}#${uid}` });
            await decrement(`followstats#${t}`, "followers");
        }

        // 6. 自分の各ドキュメント（既知キー）
        await ddbDelete(PHOTOS_TABLE, { id: `golist#${uid}` });
        await ddbDelete(PHOTOS_TABLE, { id: `notifs#${uid}` });
        await ddbDelete(PHOTOS_TABLE, { id: `followstats#${uid}` });
        await ddbDelete(PHOTOS_TABLE, { id: `following#${uid}` });

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };
    } catch (e) {
        console.error("deleteAccount error:", e);
        return jsonError(500, "退会処理に失敗しました");
    }
};
