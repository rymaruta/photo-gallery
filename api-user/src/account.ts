import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { QueryCommand, GetCommand, DeleteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, DeleteObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { ddb, PHOTOS_TABLE, USER_INDEX } from "./dynamodb";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { mediaKeys } from "./mediaKeys";
import { requireEnv } from "./env";
import { requestSiteRebuild } from "./rebuild";

// 退会（アカウント削除）。DELETE /user/account、認証必須、呼び出し元の sub のみ対象。
// 不可逆な破壊操作のため「確実に引ける範囲を確実に消す」方針:
//   - 自分の写真/ストーリー … GSI(userId-createdAt-index) で列挙 → S3 本体 + DDB item 削除
//   - アバター/カバー       … profiles/<uid>・profiles/<uid>/cover（決定的キー）
//   - プロフィール          … USERS_TABLE の {userId}
//   - 自分の各ドキュメント  … notifs#/followstats#/following#
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

/**
 * 複数キーをまとめて削除する（1リクエスト最大1000件）。
 * 1件ずつ直列に消していた頃は、写真が数十枚あるだけで Lambda の実行時間を
 * 使い切っていた。途中で切られると呼び出し側が「失敗」と表示するのに
 * データは半分消えている、という一番まずい状態になる。
 */
async function s3DeleteMany(keys: string[]): Promise<void> {
    if (!UPLOAD_BUCKET || keys.length === 0) return;
    for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000);
        try {
            await s3.send(new DeleteObjectsCommand({
                Bucket: UPLOAD_BUCKET,
                Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
            }));
        } catch (e) {
            console.error(`deleteAccount: S3 batch delete failed (${chunk.length} keys):`, e);
        }
    }
}

/** items を最大 limit 本の並列で処理する（Lambda の実行時間を使い切らないため） */
async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const item = items[cursor++];
            await fn(item);
        }
    });
    await Promise.all(workers);
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
            // 1ページ分をまとめて処理する。1枚ずつ直列に回すと、写真が数十枚で
            // 実行時間を使い切って途中終了していた。S3 は消してから DDB を消す
            // （逆にすると、途中で切れたときに GPS 入りの原本だけが公開のまま残る）。
            const projectedItems = ((res.Items ?? []) as Record<string, unknown>[])
                .filter((p) => String(p.id ?? ""));
            await mapWithConcurrency(projectedItems, 8, async (projected) => {
                const id = String(projected.id);
                let item = projected;
                try {
                    const full = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id } }));
                    if (full.Item) item = full.Item as Record<string, unknown>;
                } catch (e) {
                    console.error(`deleteAccount: get photo failed for ${id}:`, e);
                }
                await s3DeleteMany(mediaKeys(item));
                await ddbDelete(PHOTOS_TABLE, { id });
                // その写真に付いたコメントも消す。写真だけ消していたので、
                // 退会後も「本文・投稿者名・投稿者のsub」が誰でも読めるまま
                // 残っていた（一覧APIは公開で、写真の存在確認もしない）。
                // 消したい本人からは、もう手の届かない場所に残る。
                await ddbDelete(PHOTOS_TABLE, { id: `comments#${id}` });
            });
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

        // 4. 自分の「フォロー中」: follow# マーカーを消し、消せたときだけ
        //    相手の followers を戻す。
        //
        //    以前は無条件に消して無条件に減らしていた。この処理は直列で
        //    最大2000件回るので途中で実行時間を使い切ることがあり、
        //    しかも呼び出し側は失敗を見て「もう一度お試しください」と出す。
        //    もう一度走ると、既に消えたマーカーの分まで**もう一度**
        //    減らすので、**他人のフォロワー数が実際より小さくなる**
        //    （相手には直す手段が無い。こちらはもうアカウントが無いので
        //    フォローし直すこともできない）。
        // 1件でも「消せたか分からない」失敗が出たら、following# は残して
        // 失敗を返す。減らさないだけにして 200 を返していた頃は、直後に
        // following# を消していたので**再実行しても対象リストが空**で、
        // 相手のフォロワー数が1多いまま誰にも直せなくなっていた
        // （こちらはもうアカウントが無い）。
        let followCleanupFailed = false;
        for (const target of await readList(`following#${uid}`)) {
            const t = typeof target === "string" ? target : "";
            if (!t) continue;
            let removed = true;
            try {
                await ddb.send(new DeleteCommand({
                    TableName: PHOTOS_TABLE,
                    Key: { id: `follow#${t}#${uid}` },
                    ConditionExpression: "attribute_exists(id)",
                }));
            } catch (e) {
                // どんな理由で落ちてもマーカーは残っている扱いにする。
                //
                // 以前は ConditionalCheckFailedException のときだけ removed を
                // 下ろしていた。スロットリングやタイムアウトで落ちると
                // 「マーカーは消えていないのにカウンタだけ減らす」ので、
                // 呼び出し側が「もう一度お試しください」で再実行したとき、
                // 今度は削除が成功して**もう一度**減る——直そうとした
                // 二重減算がそのまま残っていた。
                // 減らすのは「消せたと確かめられたとき」だけにする。
                removed = false;
                if ((e as { name?: string }).name !== "ConditionalCheckFailedException") {
                    followCleanupFailed = true;
                    console.error(`deleteAccount: follow marker delete failed for ${t}:`, e);
                }
            }
            if (removed) await decrement(`followstats#${t}`, "followers");
        }

        // 5. 自分の各ドキュメント（既知キー）
        await ddbDelete(PHOTOS_TABLE, { id: `notifs#${uid}` });
        await ddbDelete(PHOTOS_TABLE, { id: `followstats#${uid}` });
        if (followCleanupFailed) {
            // ここで following# を消すと、やり直す手がかりが無くなる。
            // 残して失敗を返す（画面は「もう一度お試しください」を出す）。
            // 写真・プロフィールは既に消えているので、再実行は残りを片付ける。
            console.error("deleteAccount: follow cleanup incomplete; keeping following# for retry");
            return jsonError(500, "退会処理の一部が完了しませんでした。もう一度お試しください");
        }
        await ddbDelete(PHOTOS_TABLE, { id: `following#${uid}` });

        // 静的ページの掃除を頼む。DynamoDB と S3 を消しても、既に配ってある
        // 写真ページ・プロフィールページのHTMLは残っている（本文も撮影地も
        // 表示名入りの JSON-LD も焼き込まれている）。定期ビルドは止めてあるので、
        // ここで頼まないと誰かが push するまで消えない。
        // 待つ。Lambda はハンドラが返った瞬間に実行環境を凍らせるので、
        // 投げっぱなしにすると TLS ハンドシェイクの途中で止まり、依頼は届かない
        // （しかも何も記録されないので、届いたように見える）。
        // この関数は例外を飲んで真偽値を返すので、待っても失敗にはならない。
        await requestSiteRebuild(`account deleted: ${uid}`);

        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };
    } catch (e) {
        console.error("deleteAccount error:", e);
        return jsonError(500, "退会処理に失敗しました");
    }
};
