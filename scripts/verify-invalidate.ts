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
 * **2つの経路を別々に確かめる**（コードは親和テストでバイト一致を強制して
 * いるが、**配られている環境変数と IAM はサービスごとに別**なので、
 * 片方が動いても もう片方の証拠にはならない）:
 *
 *   A. api-user: 期限切れのストーリー行を書いて `cleanupStories` を Invoke
 *   B. api（管理API）: 写真の行を書いて `deletePhoto` を Invoke（管理者クレーム付き）
 *
 * どちらも「ダミーを置く → 行を書く → Invoke → `del-…` の無効化を確認 →
 * 後始末」。**staging 専用**・**`--apply` が要る**。
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

/** `ListInvalidations` / `GetInvalidation` だけを使う（テストから差し替える） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CfReader = { send: (cmd: any) => Promise<any> };

/**
 * **自分が置いたパスを含む** Lambda 由来（`del-…`）の無効化を探す。
 *
 * **時刻の窓だけで数えてはいけない。** `CallerReference` は
 * `del-${Date.now()}-…` で、どの実行が作ったかの手がかりが無い。窓に入った
 * 他の `del-…`——staging の毎時 `cleanupStories`、別の利用者の削除、
 * 前回の残骸が後から掃除されたぶん——を**自分の成果として数える**。
 * レビューが偽の SDK で実証: Lambda が何もしていない（行が残っている）のに
 * 両方の経路が「動いている」と出た。
 *
 * `GetInvalidation` の応答には `Paths.Items` が入っているので、
 * **追加の API 呼び出しゼロ**で突き合わせられる。時刻は絞り込みだけに使う。
 */
export async function lambdaInvalidationsFor(
    distId: string, sinceMs: number, wantPath: string, client: CfReader = cf,
): Promise<string[]> {
    const list = await client.send(new ListInvalidationsCommand({ DistributionId: distId, MaxItems: 20 })) as
        { InvalidationList?: { Items?: { Id?: string; CreateTime?: Date }[] } };
    const found: string[] = [];
    for (const it of list.InvalidationList?.Items ?? []) {
        if (it.CreateTime && it.CreateTime.getTime() < sinceMs) continue;
        const got = await client.send(new GetInvalidationCommand({ DistributionId: distId, Id: it.Id! })) as
            { Invalidation?: { InvalidationBatch?: { CallerReference?: string; Paths?: { Items?: string[] } } } };
        const batch = got.Invalidation?.InvalidationBatch;
        const ref = batch?.CallerReference ?? "";
        if (!ref.startsWith("del-")) continue;
        // **パスまで見る。** ここを外すと「誰かの削除」を自分の成果にする
        if ((batch?.Paths?.Items ?? []).includes(wantPath)) found.push(ref);
    }
    return found;
}

/**
 * 後始末。**失敗を黙らせない**——消せていないのに「後始末しました」と
 * 出していた。staging に期限切れの行が残ると、次の毎時 `cleanupStories` が
 * それを掃除して `del-…` を作る＝**次回の実行の偽陽性の種**になる。
 */
async function cleanup(id: string, key: string) {
    const left: string[] = [];
    try { await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { id } })); } catch (e) { left.push(`行 ${id}: ${(e as Error).message}`); }
    try { await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })); } catch (e) { left.push(`実体 ${key}: ${(e as Error).message}`); }
    if (left.length > 0) console.error(`[verify] **後始末に失敗しました**（次回の偽陽性の種になります）: ${left.join(" / ")}`);
    else console.log(`[verify] 後始末しました（${id}）`);
}

/** 管理APIの削除（api パッケージ側）を、同じやり方で確かめる */
async function verifyAdminDelete(): Promise<boolean> {
    const fn = process.env.ADMIN_DELETE_FUNCTION ?? "";
    // **未設定を「成功」にしない。** 飛ばして true を返していたので、
    // 環境変数が落ちた実行は**緑のまま片肺**になっていた（レビュー指摘）
    if (!fn) { console.error("[verify:admin] ADMIN_DELETE_FUNCTION が未設定です（api 側は未検証）"); return false; }
    const stamp = Date.now();
    const id = `verify-invalidate-photo-${stamp}`;
    const key = `uploads/verify-invalidate/${stamp}-admin.bin`;
    const started = Date.now();
    try {
        await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: "x", CacheControl: "max-age=31536000" }));
        await ddb.send(new PutCommand({
            TableName: TABLE,
            Item: {
                id, userId: "verify-invalidate", published: false,
                // 管理APIはURLの pathname からキーを採る（`uploads/` の中だけ消す）
                src: `https://d15fn3rcaiymu9.cloudfront.net/${key}`,
                createdAt: new Date(started).toISOString(), updatedAt: new Date(started).toISOString(),
            },
        }));
        console.log(`[verify:admin] 置いた: ${key} / 行: ${id}`);

        // **管理者として叩く。** `isAdmin` は cognito:groups を見る
        const event = {
            pathParameters: { id },
            requestContext: { authorizer: { jwt: { claims: { sub: "verify-invalidate", "cognito:groups": "[admin]" } } } },
        };
        const res = await lambda.send(new InvokeCommand({ FunctionName: fn, Payload: Buffer.from(JSON.stringify(event)) }));
        console.log(`[verify:admin] invoke: status=${res.StatusCode} funcError=${res.FunctionError ?? "(なし)"}`);
        if (res.Payload) console.log(`[verify:admin] 応答: ${Buffer.from(res.Payload).toString().slice(0, 300)}`);

        const left = await ddb.send(new GetCommand({ TableName: TABLE, Key: { id } }));
        console.log(`[verify:admin] 行は${left.Item ? "残っている（削除が失敗）" : "消えた（削除が走った）"}`);

        // **行が消えたことも判定に入れる。** 表示するだけだったので、
        // 「削除は失敗・無効化は誰か別の実行のもの」でも成功と出ていた
        const refs = await lambdaInvalidationsFor(DIST, started, `/${key}`);
        if (!left.Item && refs.length > 0) {
            console.log(`[verify:admin] **管理APIでもエッジの掃除が動いている**（${refs.join(", ")}）`);
            return true;
        }
        console.log(`[verify:admin] 確認できず（行=${left.Item ? "残った" : "消えた"} / このパスの無効化=${refs.length}件）`);
        console.log("  → api 側の IAM・環境変数・ランタイムの SDK、または S3 の削除で止まっている");
        return false;
    } finally {
        await cleanup(id, key);
    }
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
    // **invoke 先も staging に縛る。** バケットとテーブルしか見ていなかったので、
    // 「バケットとテーブルは staging・関数名は本番」の組み合わせが素通りし、
    // `--apply` で**本番の cleanupStories を叩けた**（レビュー指摘。再現済み）。
    // 本番と staging は同じアカウント・同じ資格情報で、区別は名前だけ。
    const targets = [FN, process.env.ADMIN_DELETE_FUNCTION ?? ""].filter(Boolean);
    const notStaging = targets.filter((f) => !f.includes("-staging-"));
    if (notStaging.length > 0) {
        console.error(`staging 以外の関数は叩きません: ${notStaging.join(", ")}`);
        process.exit(1);
    }
    if (!APPLY) {
        console.log("ドライラン（--apply で実行）。やること:");
        console.log(`  1. s3://${BUCKET}/${KEY} に1バイト置く`);
        console.log(`  2. ${TABLE} に期限切れのストーリー行 ${ID} を書く`);
        console.log(`  3. Lambda ${FN} を invoke（定期実行と同じ経路）`);
        console.log(`  4. CloudFront ${DIST} に del-… の無効化ができたか見る`);
        console.log("  5. 後始末（行と実体を消す）");
        console.log(`  6. 同じことを管理API（${process.env.ADMIN_DELETE_FUNCTION || "(未設定)"}）でも`);
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

        const refs = await lambdaInvalidationsFor(DIST, started, `/${KEY}`);
        // **両方が揃って初めて成功**（行が消えた ＝ 掃除が走った、
        // かつ このパスの無効化がある ＝ 作ったのはこの実行）
        if (!left.Item && refs.length > 0) {
            console.log(`[verify] **エッジの掃除は Lambda の中で動いている**（${refs.join(", ")}）`);
            ok = true;
        } else {
            console.log(`[verify] 確認できず（行=${left.Item ? "残った" : "消えた"} / このパスの無効化=${refs.length}件）`);
            console.log("  → ランタイムに @aws-sdk/client-cloudfront が無いか、IAM が足りないか、");
            console.log("    行が残っているなら S3 の削除で止まっている。Lambda のログを見ること");
        }
    } finally {
        await cleanup(ID, KEY);
    }
    // **api-user が動いても api の証拠にはならない**（別サービス＝別の IAM・
    // 別の環境変数）。管理API側も同じやり方で確かめる
    const adminOk = await verifyAdminDelete();
    if (!ok || !adminOk) process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith("verify-invalidate.ts")) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
