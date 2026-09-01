#!/usr/bin/env node
/**
 * 本番の設定を**読むだけ**の診断。
 *
 * 台帳に「要 AWS」として溜まっていた確認を1回で済ませる。作業環境からは
 * AWS を叩けない（資格情報がプレースホルダで `sts:GetCallerIdentity` が
 * `InvalidClientTokenId`）ので、資格情報を持つ CI から読む。
 *
 * **書き込みはしない。** 呼ぶのは Describe / Scan(COUNT) / Get だけ。
 * 直す判断の材料を集めるのが目的で、直すのは別の作業。
 */
const { DynamoDBClient, DescribeTableCommand, ScanCommand } = require("@aws-sdk/client-dynamodb");
const { CognitoIdentityProviderClient, DescribeUserPoolCommand, DescribeUserPoolClientCommand } = require("@aws-sdk/client-cognito-identity-provider");
const { CloudFrontClient, GetDistributionConfigCommand } = require("@aws-sdk/client-cloudfront");
const { requireEnv } = require("./lib/env");

const REGION = process.env.AWS_REGION || "ap-northeast-1";
// **`require` しただけでは何も起きないようにする。** トップレベルで
// `requireEnv` を呼ぶと、読み込んだだけでプロセスが止まる
// （`prepare-static-build.js` が同じ理由で `main()` の中に寄せてある）。
let PHOTOS_TABLE = "";

const ddb = new DynamoDBClient({ region: REGION });
const idp = new CognitoIdentityProviderClient({ region: REGION });
const cf = new CloudFrontClient({ region: REGION });

const line = (s) => console.log(s);
const head = (s) => console.log(`\n=== ${s} ===`);

/** 索引の名前と射影（GSI-PROJ / LEFT-5 の判断材料） */
async function indexes() {
    head("DynamoDB の索引");
    const res = await ddb.send(new DescribeTableCommand({ TableName: PHOTOS_TABLE }));
    const gsis = res.Table?.GlobalSecondaryIndexes ?? [];
    if (gsis.length === 0) { line("  GSI はありません"); return; }
    for (const g of gsis) {
        const p = g.Projection ?? {};
        line(`  ${g.IndexName}: ${p.ProjectionType}${p.NonKeyAttributes ? ` [${p.NonKeyAttributes.join(", ")}]` : ""} (${g.IndexStatus})`);
    }
    line("  ※ storyFeed-expiresAt-index があれば、ストーリーの掃除間隔を詰められる（LEFT-5）");
}

/** 実データの形（LIST-13 と、GSI から落ちる古い行） */
async function dataShapes() {
    head("実データの形（件数だけ）");
    const count = async (label, params) => {
        let total = 0, key;
        do {
            const res = await ddb.send(new ScanCommand({ TableName: PHOTOS_TABLE, Select: "COUNT", ExclusiveStartKey: key, ...params }));
            total += res.Count ?? 0;
            key = res.LastEvaluatedKey;
        } while (key);
        line(`  ${label}: ${total}`);
    };
    await count("写真の行（src を持つ）", { FilterExpression: "attribute_exists(src)" });
    await count("`Z` 形式の date（LIST-13）", {
        FilterExpression: "contains(#d, :z)",
        ExpressionAttributeNames: { "#d": "date" },
        ExpressionAttributeValues: { ":z": { S: "Z" } },
    });
    await count("createdAt を持たない写真（GSI から落ちる）", {
        FilterExpression: "attribute_exists(src) AND attribute_not_exists(createdAt)",
    });
}

/** アカウント列挙の設定（A-5） */
async function cognito() {
    head("Cognito（A-5: アカウントの有無を教えないか）");
    const poolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_CLIENT_ID;
    if (!poolId || !clientId) { line("  COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID が未設定のため飛ばします"); return; }
    const pool = await idp.send(new DescribeUserPoolCommand({ UserPoolId: poolId }));
    const p = pool.UserPool ?? {};
    line(`  プール: ${p.Name} / AliasAttributes=${JSON.stringify(p.AliasAttributes ?? null)} UsernameAttributes=${JSON.stringify(p.UsernameAttributes ?? null)}`);
    const c = await idp.send(new DescribeUserPoolClientCommand({ UserPoolId: poolId, ClientId: clientId }));
    const prevent = c.UserPoolClient?.PreventUserExistenceErrors ?? "(未設定=LEGACY)";
    line(`  PreventUserExistenceErrors: ${prevent}`);
    if (prevent !== "ENABLED") {
        line("  → LEGACY のままだと、存在しないメールに UserNotFoundException が返る（画面側は塞いである）");
        line("     直すコマンド: aws cognito-idp update-user-pool-client \\");
        line(`       --user-pool-id ${poolId} --client-id ${clientId} --prevent-user-existence-errors ENABLED`);
    }
}

/** 削除がエッジに残る期間（LEFT-4） */
async function cdnTtl() {
    head("CloudFront の TTL（LEFT-4: 削除がエッジに残る期間）");
    const distId = process.env.CLOUDFRONT_DISTRIBUTION_ID;
    if (!distId) { line("  CLOUDFRONT_DISTRIBUTION_ID が未設定のため飛ばします"); return; }
    const res = await cf.send(new GetDistributionConfigCommand({ Id: distId }));
    const cfg = res.DistributionConfig ?? {};
    const behaviors = [cfg.DefaultCacheBehavior, ...(cfg.CacheBehaviors?.Items ?? [])].filter(Boolean);
    for (const b of behaviors) {
        const path = b.PathPattern ?? "(default)";
        const ttl = b.DefaultTTL !== undefined
            ? `defaultTTL=${b.DefaultTTL} maxTTL=${b.MaxTTL} minTTL=${b.MinTTL}`
            : `cachePolicyId=${b.CachePolicyId ?? "-"}（TTL はポリシー側）`;
        line(`  ${path}: ${ttl}`);
    }
}

async function main() {
    PHOTOS_TABLE = requireEnv("PHOTOS_TABLE");
    line(`対象テーブル: ${PHOTOS_TABLE} / region: ${REGION}`);
    for (const [name, fn] of [["indexes", indexes], ["dataShapes", dataShapes], ["cognito", cognito], ["cdnTtl", cdnTtl]]) {
        try {
            await fn();
        } catch (e) {
            // **1つ失敗しても残りは出す。** 診断が途中で止まると、
            // 「権限が足りない1件」のために他の材料まで採れない
            console.error(`  [${name}] 失敗: ${e.name}: ${e.message}`);
        }
    }
    line("\n（この作業は読み取りだけです。何も変更していません）");
}

if (require.main === module) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
