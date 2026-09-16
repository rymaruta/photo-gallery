#!/usr/bin/env node
/**
 * **AWS に在るものと、このリポジトリが使っているものを突き合わせる。読むだけ。**
 *
 *   node scripts/unused-resources.js
 *
 * **消さない。消す提案もしない。** 出すのは「在る／使っていると分かる／
 * 判断がつかない」の3つに仕分けた一覧だけ。
 *
 * **理由**: このリポジトリから「使っていない」と言い切れるものは少ない。
 * 名前が `prod-*` `staging-*` でないリソースは、別のプロジェクトのものかも
 * しれないし、コンソールで手で作った経路（CloudFront の関数・応答ヘッダー
 * ポリシー・Route53・ACM）はコードに現れない。**ここで「不要」と決めて
 * 消すと、コードに現れない依存を切る。** 判断は人がする。
 *
 * 費用の当たりを付けるのが目的なので、**大きいもの・課金が続くもの**を見る:
 * S3 バケット（と概算の中身）・CloudFront・Lambda・DynamoDB・Cognito・
 * API Gateway・CloudWatch のロググループ（保持期間が無期限だと溜まる）。
 */
const { S3Client, ListBucketsCommand, ListObjectsV2Command, GetBucketLocationCommand } = require("@aws-sdk/client-s3");
const { CloudFrontClient, ListDistributionsCommand } = require("@aws-sdk/client-cloudfront");
const { LambdaClient, ListFunctionsCommand } = require("@aws-sdk/client-lambda");
const { DynamoDBClient, ListTablesCommand, DescribeTableCommand } = require("@aws-sdk/client-dynamodb");
const { CognitoIdentityProviderClient, ListUserPoolsCommand } = require("@aws-sdk/client-cognito-identity-provider");
const { CloudWatchLogsClient, DescribeLogGroupsCommand } = require("@aws-sdk/client-cloudwatch-logs");

const REGION = process.env.AWS_REGION || "ap-northeast-1";
const line = (s) => console.log(s);
const head = (s) => console.log(`\n=== ${s} ===`);

/**
 * このリポジトリが使っていると**コードから分かる**名前。
 * `CLAUDE.md` の本番・ステージングの表と `provision-env.js` の命名規則から。
 */
const KNOWN = {
    buckets: [
        "prod-journey-photo.com", "prod-journey-photo-upload", "prod-journey-photo-cdn-logs",
        "staging-journey-photo.com", "staging-journey-photo-upload",
    ],
    distributions: ["EYRLTGCPOS9E4", "EF2TFEBBP24DL"],
    tables: [
        "prod-photo-gallery-photos", "prod-photo-gallery-users",
        "staging-photo-gallery-photos", "staging-photo-gallery-users",
    ],
    pools: ["prod-journey-photo-client-spa", "staging-journey-photo-client-spa"],
    /** serverless が作る関数の接頭辞 */
    functionPrefixes: ["photo-gallery-api-prod-", "photo-gallery-api-staging-", "photo-gallery-user-api-prod-", "photo-gallery-user-api-staging-"],
};

/**
 * **serverless が自分で作るデプロイ用バケット。**
 *
 * `api/serverless.yml` `api-user/serverless.yml` は `deploymentBucket` を
 * 指定していないので、serverless が
 * `<service>-<stage>-serverlessdeploymentbucket-<hash>` を自動で作って使う
 * （長いと途中で切り詰められる: `photo-gallery-user-api-pr-serverlessdeploymentbuck-…`）。
 *
 * **これは現役**——消すと次のデプロイが壊れる。
 *
 * ⚠️ 最初この判定が無くて、4本とも「残骸かも」と出した。**そのまま
 * 「消してよさそう」と報告しかけた**。台帳の「知らない＝不要ではない」を
 * 自分の道具が破った形なので、名前で分かるものはここで拾う。
 */
function isServerlessDeploymentBucket(name) {
    return /serverlessdeploymentbuck/i.test(String(name ?? ""));
}

/**
 * 名前を3つに仕分ける（純関数・テスト可能）。
 *
 * **「不要」とは言わない。** 言えるのは「このリポジトリが知っている／
 * 知らない」だけで、知らない＝不要ではない（別プロジェクト・手で作った
 * 依存・まだコードに無い新しいもの）。
 */
function classify(name, { known = [], prefixes = [] } = {}) {
    if (known.includes(name)) return "使っている（このリポジトリが名指ししている）";
    if (prefixes.some((p) => String(name).startsWith(p))) return "使っている（命名規則に合う）";
    // **現役のデプロイ用バケット。** 消すと次のデプロイが壊れる
    if (isServerlessDeploymentBucket(name)) return "使っている（serverless のデプロイ用。消すとデプロイが壊れる）";
    // **接頭辞ではなく、このプロジェクトの語を含むかで見る。**
    // 最初は `^(prod|staging)-` で見ていたが、それだと消した環境の残骸
    // （`dev-journey-photo-upload` のような別の接頭辞）を拾えず、
    // 「判断がつかない」に落ちて一覧の中に埋もれる——**費用が残り続けるものを
    // 見つけるのがこの道具の目的**なので、名前で見る
    if (/journey-photo|photo-gallery/.test(String(name ?? ""))) {
        return "⚠️ このプロジェクトの名前だが、いまの構成にない（消した環境の残骸かも）";
    }
    return "判断がつかない（別のプロジェクトかも。触らない）";
}

/** バケットの中身をざっと数える（**上限つき**。全部数えると大きいバケットで止まる） */
async function roughBucketSize(s3, bucket, maxPages = 5) {
    let objects = 0, bytes = 0, token, pages = 0, truncated = false;
    try {
        do {
            const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: 1000 }));
            for (const o of res.Contents ?? []) { objects++; bytes += o.Size ?? 0; }
            token = res.NextContinuationToken;
            pages++;
            if (pages >= maxPages && token) { truncated = true; break; }
        } while (token);
    } catch (e) {
        return { error: e.name };
    }
    return { objects, bytes, truncated };
}

const mb = (b) => `${(b / 1024 / 1024).toFixed(1)}MB`;

async function buckets() {
    head("S3 バケット");
    const s3 = new S3Client({ region: REGION });
    let list;
    try {
        list = (await s3.send(new ListBucketsCommand({}))).Buckets ?? [];
    } catch (e) {
        line(`  読めませんでした（${e.name}）。この鍵に s3:ListAllMyBuckets がありません`);
        return;
    }
    for (const b of list) {
        const why = classify(b.Name, { known: KNOWN.buckets });
        let where = "";
        try {
            const loc = (await s3.send(new GetBucketLocationCommand({ Bucket: b.Name }))).LocationConstraint ?? "us-east-1";
            where = ` [${loc}]`;
        } catch { /* 読めなければ region を出さない */ }
        const size = await roughBucketSize(s3, b.Name);
        const sizeText = size.error
            ? `（中身を読めません: ${size.error}）`
            : `${size.objects}件 ${mb(size.bytes)}${size.truncated ? "以上（数え切っていない）" : ""}`;
        line(`  ${b.Name}${where}  ${sizeText}`);
        line(`      → ${why}`);
    }
}

async function distributions() {
    head("CloudFront");
    const cf = new CloudFrontClient({ region: REGION });
    try {
        const items = (await cf.send(new ListDistributionsCommand({}))).DistributionList?.Items ?? [];
        if (!items.length) { line("  ありません"); return; }
        for (const d of items) {
            line(`  ${d.Id}  ${d.DomainName}  ${d.Enabled ? "有効" : "**無効**"}  ${(d.Aliases?.Items ?? []).join(", ") || "(別名なし)"}`);
            line(`      → ${classify(d.Id, { known: KNOWN.distributions })}`);
        }
    } catch (e) {
        line(`  読めませんでした（${e.name}）`);
    }
}

async function functions() {
    head("Lambda 関数");
    const lambda = new LambdaClient({ region: REGION });
    try {
        const all = [];
        let marker;
        do {
            const res = await lambda.send(new ListFunctionsCommand({ Marker: marker, MaxItems: 50 }));
            all.push(...(res.Functions ?? []));
            marker = res.NextMarker;
        } while (marker);
        const grouped = {};
        for (const f of all) {
            const why = classify(f.FunctionName, { prefixes: KNOWN.functionPrefixes });
            (grouped[why] ??= []).push(f.FunctionName);
        }
        for (const [why, names] of Object.entries(grouped)) {
            line(`  ${why}: ${names.length}件`);
            // **「使っている」側は名前を全部出さない**（80件超になって読めなくなる）
            if (!why.startsWith("使っている")) for (const n of names) line(`      ${n}`);
        }
    } catch (e) {
        line(`  読めませんでした（${e.name}）`);
    }
}

async function tables() {
    head("DynamoDB テーブル");
    const ddb = new DynamoDBClient({ region: REGION });
    try {
        const names = (await ddb.send(new ListTablesCommand({}))).TableNames ?? [];
        for (const n of names) {
            let info = "";
            try {
                const t = (await ddb.send(new DescribeTableCommand({ TableName: n }))).Table ?? {};
                info = `  ${t.ItemCount ?? "?"}件 ${mb(t.TableSizeBytes ?? 0)}  ${t.BillingModeSummary?.BillingMode ?? "(課金方式不明)"}`;
            } catch { /* 読めなければ件数を出さない */ }
            line(`  ${n}${info}`);
            line(`      → ${classify(n, { known: KNOWN.tables })}`);
        }
    } catch (e) {
        line(`  読めませんでした（${e.name}）`);
    }
}

async function pools() {
    head("Cognito ユーザープール");
    const idp = new CognitoIdentityProviderClient({ region: REGION });
    try {
        const all = [];
        let token;
        do {
            const res = await idp.send(new ListUserPoolsCommand({ MaxResults: 60, NextToken: token }));
            all.push(...(res.UserPools ?? []));
            token = res.NextToken;
        } while (token);
        for (const p of all) {
            line(`  ${p.Id}  ${p.Name}`);
            line(`      → ${classify(p.Name, { known: KNOWN.pools })}`);
        }
    } catch (e) {
        line(`  読めませんでした（${e.name}）`);
    }
}

/**
 * ロググループ。**ここは静かに溜まる**——保持期間が無期限だと、
 * 消した Lambda のログが残り続ける（関数を消してもログは消えない）。
 */
async function logGroups() {
    head("CloudWatch のロググループ（保持期間が無期限だと溜まり続ける）");
    const logs = new CloudWatchLogsClient({ region: REGION });
    try {
        const all = [];
        let token;
        do {
            const res = await logs.send(new DescribeLogGroupsCommand({ nextToken: token, limit: 50 }));
            all.push(...(res.logGroups ?? []));
            token = res.nextToken;
        } while (token);
        const forever = all.filter((g) => !g.retentionInDays);
        const bytes = all.reduce((a, g) => a + (g.storedBytes ?? 0), 0);
        line(`  合計 ${all.length}件 / ${mb(bytes)}  うち保持期間が無期限: ${forever.length}件`);
        // 大きいものだけ出す（全部出すと読めない）
        const big = [...all].sort((a, b) => (b.storedBytes ?? 0) - (a.storedBytes ?? 0)).slice(0, 10);
        for (const g of big) {
            line(`  ${g.logGroupName}  ${mb(g.storedBytes ?? 0)}  保持 ${g.retentionInDays ? `${g.retentionInDays}日` : "**無期限**"}`);
        }
        if (forever.length) {
            line("  ※ 保持期間は後から付けられます（古いぶんは自動で消えます）:");
            line("     aws logs put-retention-policy --log-group-name <名前> --retention-in-days 30");
        }
    } catch (e) {
        line(`  読めませんでした（${e.name}）`);
    }
}

async function main() {
    line(`region: ${REGION}`);
    line("**読むだけです。1つも消しません。**");
    line("「判断がつかない」は**不要という意味ではありません**——別のプロジェクトのものか、");
    line("コンソールで手で作った依存（CloudFront の関数・応答ヘッダーポリシー・Route53・ACM）かもしれません。");
    for (const [name, fn] of [["buckets", buckets], ["distributions", distributions], ["functions", functions],
        ["tables", tables], ["pools", pools], ["logGroups", logGroups]]) {
        try {
            await fn();
        } catch (e) {
            line(`\n[${name}] 読めませんでした: ${e.name}`);
        }
    }
    line("\n（この作業は読み取りだけです。何も変更していません）");
}

module.exports = { classify, KNOWN, isServerlessDeploymentBucket };
if (require.main === module) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
