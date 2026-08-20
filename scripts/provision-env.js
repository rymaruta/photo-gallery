/**
 * provision-env.js — 新しい環境（staging など）の AWS リソースを一式作る。
 *
 * 作るもの（すべて環境名が接頭辞に付く。AWS のコンソールで並べたとき一目で分かる）:
 *   - DynamoDB  <env>-photo-gallery-photos（GSI userId-createdAt-index 付き）
 *   - DynamoDB  <env>-photo-gallery-users
 *   - S3        <env>-journey-photo.com（静的サイト）
 *   - S3        <env>-journey-photo-upload（画像）
 *   - CloudFront 既定ドメインのみの新規ディストリビューション
 *   - Cognito   <env>-journey-photo-client-spa + アプリクライアント + admin/user グループ
 *
 * CloudFront は「本番の設定をコピーして、向き先だけ差し替える」方式。
 * キャッシュ動作やエラーページを手で書き起こすと必ずズレるため。
 * ただし独自ドメイン・証明書・WAF・ログは引き継がない（staging には要らない）。
 *
 * 既定はドライラン。--apply を付けたときだけ作る。冪等（既にあるものは飛ばす）。
 *
 * 環境変数:
 *   ENV_NAME              作る環境名（例: staging）
 *   SOURCE_DISTRIBUTION_ID CloudFront 設定のコピー元（本番のID）
 *   AWS_REGION            (default: ap-northeast-1)
 */

const {
    DynamoDBClient, CreateTableCommand, DescribeTableCommand,
} = require("@aws-sdk/client-dynamodb");
const {
    S3Client, CreateBucketCommand, HeadBucketCommand,
    PutPublicAccessBlockCommand, PutBucketPolicyCommand, PutBucketCorsCommand,
} = require("@aws-sdk/client-s3");
const {
    CloudFrontClient, GetDistributionConfigCommand, CreateDistributionCommand,
} = require("@aws-sdk/client-cloudfront");
const {
    CognitoIdentityProviderClient, CreateUserPoolCommand, ListUserPoolsCommand,
    CreateUserPoolClientCommand, ListUserPoolClientsCommand, CreateGroupCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const { STSClient, GetCallerIdentityCommand } = require("@aws-sdk/client-sts");
const { requireEnv } = require("./lib/env");

const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
const ENV = requireEnv("ENV_NAME", "作る環境名（例: ENV_NAME=staging）");
const SOURCE_DIST = requireEnv("SOURCE_DISTRIBUTION_ID", "CloudFront 設定のコピー元（本番のディストリビューションID）");
const APPLY = process.argv.includes("--apply");

if (ENV === "prod") {
    console.error("ENV_NAME=prod は指定できません。既存の本番を壊しかねません。");
    process.exit(1);
}

const names = {
    photosTable: `${ENV}-photo-gallery-photos`,
    usersTable: `${ENV}-photo-gallery-users`,
    siteBucket: `${ENV}-journey-photo.com`,
    uploadBucket: `${ENV}-journey-photo-upload`,
    userPool: `${ENV}-journey-photo-client-spa`,
};

const ddb = new DynamoDBClient({ region: REGION });
const s3 = new S3Client({ region: REGION });
const cf = new CloudFrontClient({ region: REGION });
const idp = new CognitoIdentityProviderClient({ region: REGION });
const sts = new STSClient({ region: REGION });

const log = (...a) => console.log(...a);
const step = (title) => log(`\n=== ${title} ===`);

// ────────────────────────────── DynamoDB

async function tableExists(name) {
    try {
        await ddb.send(new DescribeTableCommand({ TableName: name }));
        return true;
    } catch (e) {
        if (e.name === "ResourceNotFoundException") return false;
        throw e;
    }
}

async function ensurePhotosTable() {
    step(`DynamoDB ${names.photosTable}`);
    if (await tableExists(names.photosTable)) return log("既にあります。作成はスキップ。");
    log("作成します（オンデマンド課金・GSI userId-createdAt-index 付き）");
    // プロビジョンドにするとテーブルあたり月$5〜6かかる。使わない環境なので必ずオンデマンド。
    if (!APPLY) return;
    await ddb.send(new CreateTableCommand({
        TableName: names.photosTable,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [
            { AttributeName: "id", AttributeType: "S" },
            { AttributeName: "userId", AttributeType: "S" },
            { AttributeName: "createdAt", AttributeType: "S" },
        ],
        KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
        GlobalSecondaryIndexes: [{
            IndexName: "userId-createdAt-index",
            KeySchema: [
                { AttributeName: "userId", KeyType: "HASH" },
                { AttributeName: "createdAt", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
        }],
    }));
    log("作成しました。");
}

async function ensureUsersTable() {
    step(`DynamoDB ${names.usersTable}`);
    if (await tableExists(names.usersTable)) return log("既にあります。作成はスキップ。");
    log("作成します（オンデマンド課金）");
    if (!APPLY) return;
    await ddb.send(new CreateTableCommand({
        TableName: names.usersTable,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [{ AttributeName: "userId", AttributeType: "S" }],
        KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
    }));
    log("作成しました。");
}

// ────────────────────────────── S3

async function bucketExists(name) {
    try {
        await s3.send(new HeadBucketCommand({ Bucket: name }));
        return true;
    } catch (e) {
        const status = e.$metadata?.httpStatusCode;
        if (status === 404 || e.name === "NotFound") return false;
        throw e; // 403 は他アカウントの同名バケット。名前を変える必要があるので落とす
    }
}

async function ensureBucket(name, { publicRead }) {
    step(`S3 ${name}`);
    if (await bucketExists(name)) {
        log("既にあります。作成はスキップ。");
    } else {
        log(`作成します（${REGION}）`);
        if (APPLY) {
            await s3.send(new CreateBucketCommand({
                Bucket: name,
                CreateBucketConfiguration: { LocationConstraint: REGION },
            }));
        }
    }
    // 直接の公開アクセスは塞ぐ。配信は CloudFront 経由だけにする。
    log("  公開アクセスはブロック（配信は CloudFront 経由）");
    if (APPLY) {
        await s3.send(new PutPublicAccessBlockCommand({
            Bucket: name,
            PublicAccessBlockConfiguration: {
                BlockPublicAcls: true, IgnorePublicAcls: true,
                BlockPublicPolicy: !publicRead, RestrictPublicBuckets: !publicRead,
            },
        }));
    }
}

/** 画像バケットはブラウザから presigned URL で PUT するので CORS が要る */
async function ensureUploadCors() {
    log("  CORS を設定（ブラウザからの presigned PUT 用）");
    if (!APPLY) return;
    await s3.send(new PutBucketCorsCommand({
        Bucket: names.uploadBucket,
        CORSConfiguration: {
            CORSRules: [{
                AllowedMethods: ["PUT", "GET", "HEAD"],
                AllowedOrigins: ["*"],
                AllowedHeaders: ["*"],
                ExposeHeaders: ["ETag"],
                MaxAgeSeconds: 3000,
            }],
        },
    }));
}

/** CloudFront（OAC）からだけ読めるようにバケットポリシーを張る */
async function allowCloudFrontRead(bucket, distributionArn) {
    log(`  ${bucket}: CloudFront からの読み取りを許可`);
    if (!APPLY) return;
    await s3.send(new PutBucketPolicyCommand({
        Bucket: bucket,
        Policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Sid: "AllowCloudFrontServicePrincipalReadOnly",
                Effect: "Allow",
                Principal: { Service: "cloudfront.amazonaws.com" },
                Action: "s3:GetObject",
                Resource: `arn:aws:s3:::${bucket}/*`,
                Condition: { StringEquals: { "AWS:SourceArn": distributionArn } },
            }],
        }),
    }));
}

// ────────────────────────────── CloudFront

/**
 * 本番の設定をひな型に、staging 用のディストリビューションを作る。
 *
 * 引き継がないもの:
 *   - Aliases / ViewerCertificate … 独自ドメインと証明書は staging には無い
 *   - WebACLId                    … WAF は本番専用
 *   - Logging                     … 余計なS3コストを作らない
 * 差し替えるもの:
 *   - Origins の DomainName       … staging のバケットへ
 */
function buildStagingConfig(source) {
    const cfg = JSON.parse(JSON.stringify(source));
    cfg.CallerReference = `${ENV}-${Date.now()}`;
    cfg.Comment = `${ENV} (copied from ${SOURCE_DIST})`;
    cfg.Aliases = { Quantity: 0, Items: [] };
    cfg.ViewerCertificate = { CloudFrontDefaultCertificate: true, MinimumProtocolVersion: "TLSv1", CertificateSource: "cloudfront" };
    cfg.WebACLId = "";
    cfg.Logging = { Enabled: false, IncludeCookies: false, Bucket: "", Prefix: "" };

    for (const o of cfg.Origins?.Items ?? []) {
        // 本番の静的サイト用オリジンを staging のバケットへ向け直す。
        // 画像用オリジンが別に居る場合も同じ規則で置き換える。
        if (o.DomainName?.includes("journey-photo.com")) {
            o.DomainName = `${names.siteBucket}.s3.${REGION}.amazonaws.com`;
        } else if (o.DomainName?.includes("journey-photo-upload")) {
            o.DomainName = `${names.uploadBucket}.s3.${REGION}.amazonaws.com`;
        }
    }
    return cfg;
}

async function ensureDistribution() {
    step("CloudFront");
    const src = await cf.send(new GetDistributionConfigCommand({ Id: SOURCE_DIST }));
    const cfg = buildStagingConfig(src.DistributionConfig);

    log(`コピー元: ${SOURCE_DIST}`);
    log(`  オリジン: ${(cfg.Origins?.Items ?? []).map((o) => o.DomainName).join(", ")}`);
    log("  独自ドメイン・証明書・WAF・ログは引き継がない");
    log(`  キャッシュ動作: 既定 + ${cfg.CacheBehaviors?.Quantity ?? 0} 件（本番と同じ）`);
    log(`  カスタムエラーページ: ${cfg.CustomErrorResponses?.Quantity ?? 0} 件（本番と同じ）`);

    if (!APPLY) return null;
    const res = await cf.send(new CreateDistributionCommand({ DistributionConfig: cfg }));
    const d = res.Distribution;
    log(`作成しました: ${d.Id}  https://${d.DomainName}`);
    log("（配信が始まるまで15分ほどかかります）");
    return { id: d.Id, domain: d.DomainName, arn: d.ARN };
}

// ────────────────────────────── Cognito

async function findUserPool(name) {
    let token;
    do {
        const res = await idp.send(new ListUserPoolsCommand({ MaxResults: 60, NextToken: token }));
        const hit = (res.UserPools ?? []).find((p) => p.Name === name);
        if (hit) return hit.Id;
        token = res.NextToken;
    } while (token);
    return null;
}

async function ensureUserPool() {
    step(`Cognito ${names.userPool}`);
    let poolId = await findUserPool(names.userPool);
    if (poolId) {
        log(`既にあります: ${poolId}`);
    } else {
        log("作成します（メール認証・自己サインアップ可）");
        if (!APPLY) return { poolId: null, clientId: null };
        const res = await idp.send(new CreateUserPoolCommand({
            PoolName: names.userPool,
            UsernameAttributes: ["email"],
            AutoVerifiedAttributes: ["email"],
            Policies: { PasswordPolicy: { MinimumLength: 8, RequireUppercase: true, RequireLowercase: true, RequireNumbers: true, RequireSymbols: false } },
            AccountRecoverySetting: { RecoveryMechanisms: [{ Name: "verified_email", Priority: 1 }] },
        }));
        poolId = res.UserPool.Id;
        log(`作成しました: ${poolId}`);
    }

    // グループ（lib/auth/config.ts の ADMIN_GROUP_NAME / USER_GROUP_NAME と一致させる）
    for (const g of ["admin", "user"]) {
        log(`  グループ ${g}`);
        if (!APPLY) continue;
        try {
            await idp.send(new CreateGroupCommand({ GroupName: g, UserPoolId: poolId }));
        } catch (e) {
            if (e.name !== "GroupExistsException") throw e;
        }
    }

    // アプリクライアント（SPA なのでシークレット無し）
    let clientId = null;
    if (APPLY) {
        const list = await idp.send(new ListUserPoolClientsCommand({ UserPoolId: poolId, MaxResults: 60 }));
        const existing = (list.UserPoolClients ?? []).find((c) => c.ClientName === names.userPool);
        if (existing) {
            clientId = existing.ClientId;
            log(`  アプリクライアントは既にあります: ${clientId}`);
        } else {
            const res = await idp.send(new CreateUserPoolClientCommand({
                UserPoolId: poolId,
                ClientName: names.userPool,
                GenerateSecret: false, // 静的サイトなのでシークレットは持てない
                ExplicitAuthFlows: ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
            }));
            clientId = res.UserPoolClient.ClientId;
            log(`  アプリクライアントを作成しました: ${clientId}`);
        }
    } else {
        log("  アプリクライアント（シークレット無し・SRP認証）");
    }
    return { poolId, clientId };
}

// ────────────────────────────── main

(async () => {
    log(`環境: ${ENV}`);
    log(APPLY ? "モード: 適用（AWS にリソースを作ります）" : "モード: ドライラン（何も作りません）");
    const who = await sts.send(new GetCallerIdentityCommand({}));
    log(`アカウント: ${who.Account}  リージョン: ${REGION}`);

    await ensurePhotosTable();
    await ensureUsersTable();
    await ensureBucket(names.siteBucket, { publicRead: false });
    await ensureBucket(names.uploadBucket, { publicRead: false });
    await ensureUploadCors();

    const dist = await ensureDistribution();
    if (dist) {
        await allowCloudFrontRead(names.siteBucket, dist.arn);
        await allowCloudFrontRead(names.uploadBucket, dist.arn);
    }

    const { poolId, clientId } = await ensureUserPool();

    step("GitHub に登録する値");
    if (!APPLY) {
        log("ドライランのため未確定。--apply で実行するとここに出ます。");
        return;
    }
    log("リポジトリの Settings → Secrets and variables → Actions → Variables に登録:");
    log(`  STAGING_CLOUDFRONT_URL      = https://${dist?.domain ?? "(未作成)"}`);
    log(`  STAGING_DISTRIBUTION_ID     = ${dist?.id ?? "(未作成)"}`);
    log(`  STAGING_COGNITO_USER_POOL_ID = ${poolId ?? "(未作成)"}`);
    log(`  STAGING_COGNITO_CLIENT_ID    = ${clientId ?? "(未作成)"}`);
    log("");
    log("  STAGING_API_BASE_URL / STAGING_USER_API_BASE_URL は、");
    log("  develop ブランチに push して API をデプロイすると出力される URL を登録してください。");
})().catch((e) => {
    console.error("\nエラー:", e.name, e.message);
    if (String(e.name).includes("AccessDenied") || String(e.name).includes("NotAuthorized")) {
        console.error("デプロイ用 IAM に、テーブル・バケット・ディストリビューション・");
        console.error("ユーザープールの作成権限が必要です。");
    }
    process.exit(1);
});
