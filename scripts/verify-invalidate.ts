#!/usr/bin/env tsx
/**
 * LEFT-4 の最後の穴: **エッジの掃除が「Lambda の中で」本当に動くか**を確かめる。
 *
 * 両 `serverless.yml` は `exclude: ['@aws-sdk/*']` なので SDK はバンドルされず
 * **ランタイム任せ**。`@aws-sdk/client-cloudfront` が無ければ
 * `invalidateUploads` は警告1行で静かに落ちる（＝削除しても掃除されない）。
 * ランナーで同じ関数を呼んでも意味が無い——**あちらには node_modules がある**
 * ので必ず成功し、確かめたい当のものを迂回する。
 *
 * だから **staging の Lambda を実際に走らせる**:
 *
 *   1. `uploads/` にダミーを1つ置く（1バイト）
 *   2. 期限切れのストーリー行を1つ書く（`storyFeed` の GSI に載る形）
 *   3. staging の `cleanupStories` を **Invoke**（1時間ごとの定期実行と同じ経路）
 *   4. staging の CloudFront に `del-…` の無効化ができたかを見る
 *   5. 後始末（行と実体が残っていたら消す）
 *
 * **staging 専用**（バケット名が `staging-` で始まらなければ何もしない）。
 * **`--apply` が要る**（本物の S3・DynamoDB に書くため。`verify-upload` と同じ）。
 *
 * 本番の写真を1枚消しても同じことは分かるが、**それは利用者のデータ**なので
 * 確認のために消さない。staging は空（CLAUDE.md）なので、ここで作って壊す。
 */
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { CloudFrontClient, ListInvalidationsCommand, GetInvalidationCommand } from "@aws-sdk/client-cloudfront";

const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
const BUCKET = process.env.UPLOAD_BUCKET ?? "";
const TABLE = process.env.PHOTOS_TABLE ?? "";
const DIST = process.env.CLOUDFRONT_DISTRIBUTION_ID ?? "";
const FN = process.env.CLEANUP_FUNCTION ?? "";
const APPLY = process.argv.includes("--apply");

const s3 = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const lambda = new LambdaClient({ region: REGION });
const cf = new CloudFrontClient({ region: REGION });

/** この確認が作ったものだと一目で分かる名前にする（残骸の掃除用） */
const STAMP = Date.now();
const ID = `story-verify-invalidate-${STAMP}`;
const KEY = `uploads/verify-invalidate/${STAMP}.bin`;

/** `del-…`（Lambda 由来）の無効化を、指定時刻より後に作られたものだけ数える */
export async function lambdaInvalidationsSince(distId: string, sinceMs: number): Promise<string[]> {
    const list = await cf.send(new ListInvalidationsCommand({ DistributionId: distId, MaxItems: 20 }));
    const found: string[] = [];
    for (const it of list.InvalidationList?.Items ?? []) {
        if (it.CreateTime && it.CreateTime.getTime() < sinceMs) continue;
        const got = await cf.send(new GetInvalidationCommand({ DistributionId: distId, Id: it.Id! }));
        const ref = got.Invalidation?.InvalidationBatch?.CallerReference ?? "";
        if (ref.startsWith("del-")) found.push(ref);
    }
    return found;
}

async function cleanup() {
    try { await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { id: ID } })); } catch { /* 残っていなければよい */ }
    try { await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: KEY })); } catch { /* 同上 */ }
}

async function main() {
    // **staging 以外では何もしない。** 本番のテーブルにダミーの行を書く事故を、
    // 「気をつける」ではなく仕組みで止める（verify-upload と同じ形）
    if (!BUCKET.startsWith("staging-") || !TABLE.startsWith("staging-")) {
        console.error(`staging 以外では実行しません（UPLOAD_BUCKET=${BUCKET || "(未設定)"} PHOTOS_TABLE=${TABLE || "(未設定)"}）`);
        process.exit(1);
    }
    if (!DIST || !FN) {
        console.error("CLOUDFRONT_DISTRIBUTION_ID と CLEANUP_FUNCTION が要ります");
        process.exit(1);
    }
    if (!APPLY) {
        console.log("ドライラン（--apply で実行）。やること:");
        console.log(`  1. s3://${BUCKET}/${KEY} に1バイト置く`);
        console.log(`  2. ${TABLE} に期限切れのストーリー行 ${ID} を書く`);
        console.log(`  3. Lambda ${FN} を invoke（定期実行と同じ経路）`);
        console.log(`  4. CloudFront ${DIST} に del-… の無効化ができたか見る`);
        console.log("  5. 後始末（行と実体を消す）");
        return;
    }

    const started = Date.now();
    let ok = false;
    try {
        await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: KEY, Body: "x", CacheControl: "max-age=31536000" }));
        await ddb.send(new PutCommand({
            TableName: TABLE,
            Item: {
                id: ID, story: true, storyFeed: "1", published: false,
                // 掃除は `key` から S3 のキーを採る（`deriveStoryKey`）
                key: KEY, src: `https://example.invalid/${KEY}`, mediaType: "image",
                userId: "verify-invalidate", createdAt: new Date(started).toISOString(),
                // **既に期限切れ**にして、次の実行で必ず拾わせる
                expiresAt: new Date(started - 60_000).toISOString(),
                updatedAt: new Date(started).toISOString(),
            },
        }));
        console.log(`[verify] 置いた: ${KEY} / 行: ${ID}（expiresAt は1分前）`);

        const res = await lambda.send(new InvokeCommand({ FunctionName: FN, Payload: Buffer.from("{}") }));
        console.log(`[verify] invoke: status=${res.StatusCode} funcError=${res.FunctionError ?? "(なし)"}`);
        if (res.Payload) console.log(`[verify] 応答: ${Buffer.from(res.Payload).toString().slice(0, 300)}`);

        // 行が消えていれば掃除は走った（消えていなければ S3 削除で失敗している）
        const left = await ddb.send(new GetCommand({ TableName: TABLE, Key: { id: ID } }));
        console.log(`[verify] 行は${left.Item ? "残っている（掃除が失敗）" : "消えた（掃除が走った）"}`);

        const refs = await lambdaInvalidationsSince(DIST, started);
        if (refs.length > 0) {
            console.log(`[verify] **エッジの掃除は Lambda の中で動いている**（${refs.join(", ")}）`);
            ok = true;
        } else {
            console.log("[verify] del-… の無効化が見つからない。");
            console.log("  → ランタイムに @aws-sdk/client-cloudfront が無いか、IAM が足りないか、");
            console.log("    行が消えていないなら S3 の削除で止まっている。Lambda のログを見ること");
        }
    } finally {
        await cleanup();
        console.log("[verify] 後始末しました");
    }
    if (!ok) process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith("verify-invalidate.ts")) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
