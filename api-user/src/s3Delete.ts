import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { requireEnv } from "./env";
import { invalidateUploads } from "./cdnInvalidate";

// **未設定なら起動時に止める。** `?? ""` / `!` にしていた頃は、環境変数が
// 空でも S3 の削除を**黙って飛ばして** DynamoDB の行だけ消し、成功を返して
// いた。GPS 入りの原本を含む実体が公開URLに残り、項目が消えているので
// **どの削除経路からも二度と辿れない**。取り返しのつかない削除なので
// 「分からないなら止める」に倒す（CLAUDE.md の方針）。
const UPLOAD_BUCKET = requireEnv("UPLOAD_BUCKET");
const s3 = new S3Client({});

/**
 * 複数キーをまとめて削除する（1リクエスト最大1000件）。
 *
 * 1件ずつ直列に消していた頃は、写真が数十枚あるだけで Lambda の実行時間を
 * 使い切っていた。途中で切られると呼び出し側が「失敗」と表示するのに
 * データは半分消えている、という一番まずい状態になる。
 *
 * **退会処理から共有の場所へ出した。** ストーリーの掃除も同じ形が要る
 * ——1行あたり最大8キーを直列に消していて、しかも「消せなければ行を残す」
 * に変えたので、消せない行が**毎回先頭に来る**（`queryStories` は
 * `expiresAt` の昇順）。溜まると実行時間を食い切り、**後ろにいる新しい
 * 期限切れストーリーに永久に到達しない**——そちらの GPS 入り動画が
 * 公開URLに残り続ける。1行1リクエストにすれば桁が変わる。
 *
 * @returns 消せなかったキーの数（0 = 全部消えた）
 */
export async function s3DeleteMany(keys: string[], logPrefix = "s3DeleteMany"): Promise<number> {
    // 空のときの早期 return は置かない。下のループが 0 件では回らないので
    // **到達しない守り**になり、片方を壊しても全件緑になる
    let failedCount = 0;
    // 消せたキーだけをエッジからも消す（LEFT-4）。まとめて1回に畳む
    const deleted: string[] = [];
    for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000);
        try {
            const res = await s3.send(new DeleteObjectsCommand({
                Bucket: UPLOAD_BUCKET,
                Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
            }));
            failedCount += res.Errors?.length ?? 0;
            // **消せたものだけ**をエッジの掃除に回す。エラーになったキーまで
            // 無効化すると、消えていない実体のキャッシュを捨てて取り直させる
            // ことになる（課金対象のパスも無駄に増える）
            const failed = new Set((res.Errors ?? []).map((e) => e.Key));
            for (const key of chunk) if (!failed.has(key)) deleted.push(key);
        } catch (e) {
            console.error(`${logPrefix}: S3 batch delete failed (${chunk.length} keys):`, e);
            failedCount += chunk.length;
        }
    }
    // エッジからも消す（LEFT-4）。失敗しても削除は成功として扱う
    await invalidateUploads(deleted, logPrefix);
    return failedCount;
}
