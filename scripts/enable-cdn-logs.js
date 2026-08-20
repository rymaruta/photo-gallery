/**
 * enable-cdn-logs.js — CloudFront の標準アクセスログを有効にする。
 *
 * バケット作成から権限設定まで全部やる（手作業は不要）。
 *   1. ログ用バケットを作る（無ければ）
 *   2. 保存期間を設定して勝手に増え続けないようにする
 *   3. ACL を使えるようにして、CloudFront のログ配信主体に書き込み権限を渡す
 *      （標準ログはこの古い ACL 方式でしか受け付けない）
 *   4. ディストリビューションのログ出力を有効にする
 *
 * これが無いと「実ユーザーで何%が 4xx/5xx を踏んでいるか」を測れない。
 * GA4 には CDN のエラーは出てこないため、代わりになるものが無い。
 *
 * 既定はドライラン。--apply を付けたときだけ変更する。冪等。
 */

const {
    S3Client, CreateBucketCommand, HeadBucketCommand, ListObjectsV2Command,
    PutBucketOwnershipControlsCommand, PutBucketAclCommand,
    PutBucketLifecycleConfigurationCommand, PutPublicAccessBlockCommand,
} = require("@aws-sdk/client-s3");
const { CloudFrontClient, GetDistributionConfigCommand, UpdateDistributionCommand } = require("@aws-sdk/client-cloudfront");
const { requireEnv } = require("./lib/env");

const REGION = "ap-northeast-1";
const DIST_ID = requireEnv("CLOUDFRONT_DISTRIBUTION_ID");
const LOG_BUCKET = requireEnv("LOG_BUCKET");
const LOG_PREFIX = "cloudfront/";
// ログを残す日数。原因究明には十分で、これ以上持つと保管料が無駄に増える
const RETENTION_DAYS = 30;
const APPLY = process.argv.includes("--apply");

const s3 = new S3Client({ region: REGION });
const cf = new CloudFrontClient({ region: REGION });

async function bucketExists() {
    try {
        await s3.send(new HeadBucketCommand({ Bucket: LOG_BUCKET }));
        return true;
    } catch (e) {
        const status = e.$metadata?.httpStatusCode;
        if (status === 404 || e.name === "NotFound") return false;
        if (status === 403) {
            // 他人が同名バケットを持っている場合もここに来る
            console.log(`  （${LOG_BUCKET} に HeadBucket で 403。別アカウントの同名バケットの可能性）`);
            return true;
        }
        throw e;
    }
}

async function ensureBucket() {
    console.log(`\n=== ログ用バケット ${LOG_BUCKET} ===`);
    if (await bucketExists()) {
        console.log("既にあります。作成はスキップ。");
    } else {
        console.log(`作成します（${REGION}）`);
        if (APPLY) {
            await s3.send(new CreateBucketCommand({
                Bucket: LOG_BUCKET,
                CreateBucketConfiguration: { LocationConstraint: REGION },
            }));
        }
    }

    if (!APPLY) {
        console.log("  公開アクセスは全面ブロック");
        console.log(`  ${RETENTION_DAYS}日で自動削除`);
        console.log("  ACL を有効化し、CloudFront のログ配信主体に書き込み権限を付与");
        return;
    }

    // ログに個人情報（IP・UA）が含まれるため、公開は全面的に塞ぐ
    await s3.send(new PutPublicAccessBlockCommand({
        Bucket: LOG_BUCKET,
        PublicAccessBlockConfiguration: {
            BlockPublicAcls: false,        // ログ配信は ACL を使うため false
            IgnorePublicAcls: true,
            BlockPublicPolicy: true,
            RestrictPublicBuckets: true,
        },
    }));
    console.log("  公開アクセスをブロックしました");

    // 溜まり続けないように期限を切る
    await s3.send(new PutBucketLifecycleConfigurationCommand({
        Bucket: LOG_BUCKET,
        LifecycleConfiguration: {
            Rules: [{
                ID: "expire-cdn-logs",
                Status: "Enabled",
                Filter: { Prefix: LOG_PREFIX },
                Expiration: { Days: RETENTION_DAYS },
            }],
        },
    }));
    console.log(`  ${RETENTION_DAYS}日で自動削除するようにしました`);

    // 標準ログは ACL 方式でしか書き込めないので、ACL を使える状態にする
    await s3.send(new PutBucketOwnershipControlsCommand({
        Bucket: LOG_BUCKET,
        OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerPreferred" }] },
    }));
    // 定義済みACL。まさにログ配信のために用意されているもの
    await s3.send(new PutBucketAclCommand({ Bucket: LOG_BUCKET, ACL: "log-delivery-write" }));
    console.log("  ログ配信の書き込み権限を付与しました");
}

async function enableLogging() {
    console.log(`\n=== CloudFront ${DIST_ID} ===`);
    const res = await cf.send(new GetDistributionConfigCommand({ Id: DIST_ID }));
    const cfg = res.DistributionConfig;
    const etag = res.ETag;

    if (cfg.Logging?.Enabled) {
        console.log(`既に有効です（bucket=${cfg.Logging.Bucket} prefix=${cfg.Logging.Prefix}）。何もしません。`);
        return;
    }

    console.log("ログ出力を有効にします:");
    console.log(`  bucket: ${LOG_BUCKET}.s3.amazonaws.com`);
    console.log(`  prefix: ${LOG_PREFIX}`);
    console.log("  クッキーは記録しない（個人が特定できる情報を増やさないため）");

    if (!APPLY) return;

    cfg.Logging = {
        Enabled: true,
        IncludeCookies: false,
        Bucket: `${LOG_BUCKET}.s3.amazonaws.com`,
        Prefix: LOG_PREFIX,
    };
    await cf.send(new UpdateDistributionCommand({ Id: DIST_ID, IfMatch: etag, DistributionConfig: cfg }));
    console.log("有効にしました。ログが出始めるまで数十分かかります。");
}

/**
 * 実際にログが届いているかを見る。
 * 有効化してもすぐには出ず、最初のファイルまで数十分かかる。
 * 「設定した」と「動いている」は別なので、後から確認できるようにしておく。
 */
async function reportDelivery() {
    let res;
    try {
        res = await s3.send(new ListObjectsV2Command({
            Bucket: LOG_BUCKET, Prefix: LOG_PREFIX, MaxKeys: 5,
        }));
    } catch (e) {
        console.log(`\n配信状況: 確認できません（${e.name}）`);
        return;
    }
    const items = res.Contents ?? [];
    if (items.length === 0) {
        console.log("\n配信状況: まだログファイルはありません（有効化直後なら数十分待つ）");
        return;
    }
    const latest = items.reduce((a, b) => (a.LastModified > b.LastModified ? a : b));
    console.log(`\n配信状況: ログファイルあり（直近 ${latest.Key} / ${latest.LastModified.toISOString()}）`);
}

(async () => {
    console.log(APPLY ? "モード: 適用（作成・変更します）" : "モード: ドライラン（変更しません）");
    await ensureBucket();
    await enableLogging();
    await reportDelivery();
    if (!APPLY) console.log("\nドライランのため何も変更していません。");
})().catch((e) => {
    console.error("エラー:", e.name, e.message);
    if (String(e.name).includes("AccessDenied")) {
        console.error("デプロイ用 IAM に s3:CreateBucket / s3:PutBucketAcl 等が必要です。");
    }
    process.exit(1);
});
