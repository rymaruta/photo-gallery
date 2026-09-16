#!/usr/bin/env node
/**
 * **消した環境の残骸を消す。既定は読むだけ。**
 *
 *   node scripts/purge-leftover-resources.js            # 何をするか出す
 *   node scripts/purge-leftover-resources.js --apply    # 実行
 *
 * **パターンで消さない。下の一覧に名前を書いたものだけを消す。**
 * `unused-resources` の仕分けをそのまま実行する形にはしない——あの道具は
 * 一度 **現役の serverless デプロイ用バケット4本を「残骸かも」と誤って出した**
 * （`deploymentBucket` を指定していないので自動命名される、を知らなかった）。
 * パターンに従っていたら、次のデプロイを壊していた。
 *
 * **さらに、一覧に書いてあっても下の3つに当たったら消さない**（一覧を書く
 * 側が間違えても止まるように）:
 *   1. `prod-` / `staging-` で始まる
 *   2. serverless のデプロイ用バケット
 *   3. Lambda@Edge の OGP 関数（**外れるとトップ以外の全ページが 404 になる**）
 *
 * **そのうえで、消す直前に「いま使われていないか」を AWS に聞く**——
 * CloudFront のオリジンになっていないか／ログの出力先になっていないか。
 * 使われていたら、その1件だけ飛ばして先へ進む。
 */
const {
    S3Client, ListObjectsV2Command, ListObjectVersionsCommand, DeleteObjectsCommand,
    DeleteBucketCommand, HeadBucketCommand,
} = require("@aws-sdk/client-s3");
const { CloudFrontClient, ListDistributionsCommand } = require("@aws-sdk/client-cloudfront");
const { LambdaClient, DeleteFunctionCommand, GetFunctionConfigurationCommand } = require("@aws-sdk/client-lambda");
const {
    CognitoIdentityProviderClient, DeleteUserPoolCommand, ListUsersCommand, DescribeUserPoolCommand,
} = require("@aws-sdk/client-cognito-identity-provider");

const REGION = process.env.AWS_REGION || "ap-northeast-1";

/**
 * **消してよいと確かめたものだけ。** 名前と、なぜ残骸だと言えるかを書く。
 * 理由が書けないものはここに入れない。
 */
const ALLOW = {
    buckets: [
        { name: "journey-photo-api-deploy-prod-463470976368", why: "2026-02 の旧 serverless 設定の deploymentBucket。いまの設定は指定を持たない（自動命名の別バケットを使う）" },
        { name: "journey-photo-api-deploy-dev-463470976368", why: "同上の dev 版。dev 環境自体が無い" },
        { name: "dev-journey-photo-upload", why: "dev 環境のアップロード先。dev 環境は無い（本番と staging だけ）" },
        { name: "dev-journey-photo.com", why: "dev 環境の静的サイト。同上" },
        { name: "cf-logs-journey-photo", why: "旧 CDN ログ。いまは prod-journey-photo-cdn-logs（消す前に配信のログ設定を確かめる）" },
        { name: "photo-gallery", why: "空。環境名の接頭辞を付ける前の名残" },
        { name: "journey-photo.com", why: "接頭辞を付ける前の静的サイト。いまは prod-journey-photo.com（消す前に配信のオリジンを確かめる）" },
    ],
    functions: [
        { name: "photo-gallery-api-dev-api", why: "dev 環境の旧・一枚岩ハンドラ。いまは関数ごとに分かれている（dev 環境も無い）" },
        { name: "photo-gallery-user-api-prod", why: "関数名の接尾辞が無い＝いまの命名（photo-gallery-user-api-prod-<関数名>）より前のもの" },
    ],
    pools: [
        { id: "ap-northeast-1_42eTJcBK7", name: "dev-journey-photo-client-spa", why: "dev 環境のプール。dev 環境は無い（**中に利用者が居たら消さない**）" },
    ],
};

/**
 * **一覧に書いてあっても消さない条件**（純関数・テスト可能）。
 * 一覧を書く側が間違えても、ここで止まる。
 *
 * @returns 止める理由（消してよければ null）
 */
function refuseReason(name) {
    const s = String(name ?? "");
    if (!s) return "名前が空";
    if (/^(prod|staging)-/.test(s)) return "本番／ステージングの名前";
    if (/serverlessdeploymentbuck/i.test(s)) return "serverless のデプロイ用（消すと次のデプロイが壊れる）";
    // **Lambda@Edge の OGP 関数。** 外れるとトップ以外の全ページが 404 になる
    if (/ogp/i.test(s)) return "Lambda@Edge の OGP 関数（外れると全ページが 404 になる）";
    return null;
}

/** 一覧を安全側でふるう（純関数） */
function screen(entries, key = "name") {
    const pass = [], refused = [];
    for (const e of entries ?? []) {
        const why = refuseReason(e[key] ?? e.name);
        if (why) refused.push({ ...e, refused: why });
        else pass.push(e);
    }
    return { pass, refused };
}

/**
 * CloudFront が「いま使っている」名前を集める（オリジンのドメインとログの出力先）。
 * **バケット名はここから引く**——`<bucket>.s3.<region>.amazonaws.com` や
 * `<bucket>.s3-website-...` の形で出てくる。
 */
async function cloudFrontInUse(cf) {
    const domains = new Set();
    const res = await cf.send(new ListDistributionsCommand({}));
    for (const d of res.DistributionList?.Items ?? []) {
        for (const o of d.Origins?.Items ?? []) if (o.DomainName) domains.add(o.DomainName);
        // ListDistributions はログ設定を返さない版があるので、返れば使う
        const lg = d.Logging?.Bucket;
        if (lg) domains.add(lg);
    }
    return domains;
}

/** その名前が CloudFront から参照されているか（バケット名 → ドメインの形で照合） */
function referencedByCloudFront(bucket, domains) {
    const b = String(bucket);
    for (const d of domains) {
        if (d === b) return d;                       // ログの出力先はバケット名そのもの
        if (String(d).startsWith(`${b}.s3`)) return d; // オリジン
    }
    return null;
}

/** バケットを空にして消す（バージョン付きにも対応） */
async function emptyAndDeleteBucket(s3, bucket) {
    let removed = 0;
    // 通常のオブジェクト
    let token;
    do {
        const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
        const objs = (res.Contents ?? []).map((o) => ({ Key: o.Key }));
        if (objs.length) {
            await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objs, Quiet: true } }));
            removed += objs.length;
        }
        token = res.NextContinuationToken;
    } while (token);
    // バージョンと削除マーカー（バージョン管理が付いていると、これが残ると消せない）
    let kt, vt;
    do {
        const res = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, KeyMarker: kt, VersionIdMarker: vt }));
        const objs = [
            ...(res.Versions ?? []).map((v) => ({ Key: v.Key, VersionId: v.VersionId })),
            ...(res.DeleteMarkers ?? []).map((v) => ({ Key: v.Key, VersionId: v.VersionId })),
        ];
        if (objs.length) {
            await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objs, Quiet: true } }));
            removed += objs.length;
        }
        kt = res.NextKeyMarker; vt = res.NextVersionIdMarker;
    } while (kt || vt);
    await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
    return removed;
}

async function main() {
    const apply = process.argv.includes("--apply");
    const s3 = new S3Client({ region: REGION });
    const cf = new CloudFrontClient({ region: REGION });
    const lambda = new LambdaClient({ region: REGION });
    const idp = new CognitoIdentityProviderClient({ region: REGION });

    console.log(`[purge] region=${REGION} ${apply ? "（実行）" : "（読むだけ。--apply で実行）"}`);
    console.log("[purge] **一覧に名前を書いたものだけ**を消します（パターンでは消しません）");

    const inUse = await cloudFrontInUse(cf);
    console.log(`[purge] CloudFront が参照している名前: ${inUse.size}件`);

    const failures = [];

    // ---- S3 ----
    console.log("\n=== S3 バケット ===");
    const { pass: okBuckets, refused: noBuckets } = screen(ALLOW.buckets);
    for (const b of noBuckets) console.log(`  飛ばす ${b.name}: ${b.refused}`);
    for (const b of okBuckets) {
        let exists = true;
        try { await s3.send(new HeadBucketCommand({ Bucket: b.name })); } catch { exists = false; }
        if (!exists) { console.log(`  ${b.name}: もうありません`); continue; }
        const ref = referencedByCloudFront(b.name, inUse);
        if (ref) {
            console.log(`  ⛔ ${b.name}: **CloudFront が使っています**（${ref}）。飛ばします`);
            continue;
        }
        console.log(`  ${b.name}  → ${b.why}`);
        if (!apply) continue;
        try {
            const n = await emptyAndDeleteBucket(s3, b.name);
            console.log(`      消しました（中身 ${n}件も）`);
        } catch (e) {
            failures.push(`bucket ${b.name}: ${e.name}`);
            console.error(`      ❌ ${e.name}`);
        }
    }

    // ---- Lambda ----
    console.log("\n=== Lambda 関数 ===");
    const { pass: okFns, refused: noFns } = screen(ALLOW.functions);
    for (const f of noFns) console.log(`  飛ばす ${f.name}: ${f.refused}`);
    for (const f of okFns) {
        let cfg;
        try { cfg = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: f.name })); }
        catch { console.log(`  ${f.name}: もうありません`); continue; }
        console.log(`  ${f.name}  最終更新 ${cfg.LastModified}  → ${f.why}`);
        if (!apply) continue;
        try {
            await lambda.send(new DeleteFunctionCommand({ FunctionName: f.name }));
            console.log("      消しました");
        } catch (e) {
            failures.push(`function ${f.name}: ${e.name}`);
            console.error(`      ❌ ${e.name}`);
        }
    }

    // ---- Cognito ----
    console.log("\n=== Cognito ユーザープール ===");
    const { pass: okPools, refused: noPools } = screen(ALLOW.pools);
    for (const p of noPools) console.log(`  飛ばす ${p.name}: ${p.refused}`);
    for (const p of okPools) {
        let pool;
        try { pool = (await idp.send(new DescribeUserPoolCommand({ UserPoolId: p.id }))).UserPool; }
        catch { console.log(`  ${p.id}: もうありません`); continue; }
        // **名前も突き合わせる。** ID を書き間違えていたら別のプールを消す
        if (pool?.Name !== p.name) {
            console.log(`  ⛔ ${p.id}: 名前が違います（在るのは ${pool?.Name} / 一覧は ${p.name}）。飛ばします`);
            continue;
        }
        let users = 0;
        try {
            let token;
            do {
                const res = await idp.send(new ListUsersCommand({ UserPoolId: p.id, Limit: 60, PaginationToken: token }));
                users += (res.Users ?? []).length;
                token = res.PaginationToken;
            } while (token);
        } catch (e) {
            console.log(`  ⛔ ${p.id}: 利用者を数えられません（${e.name}）。飛ばします`);
            continue;
        }
        console.log(`  ${p.id} (${p.name})  利用者 ${users}人  → ${p.why}`);
        if (users > 0) {
            // **人が入っているプールは消さない。** 消すとその人たちのアカウントが消える
            console.log("      ⛔ 利用者が居るので飛ばします");
            continue;
        }
        if (!apply) continue;
        try {
            await idp.send(new DeleteUserPoolCommand({ UserPoolId: p.id }));
            console.log("      消しました");
        } catch (e) {
            failures.push(`pool ${p.id}: ${e.name}`);
            console.error(`      ❌ ${e.name}`);
        }
    }

    if (!apply) {
        console.log("\n[purge] 読むだけで終わります（--apply で実行）");
        return;
    }
    if (failures.length) {
        console.error(`\n[purge] ❌ 消せなかったもの: ${failures.length}件`);
        for (const f of failures) console.error(`    ${f}`);
        process.exitCode = 1;
    } else {
        console.log("\n[purge] 完了");
    }
}

module.exports = { refuseReason, screen, referencedByCloudFront, ALLOW };
if (require.main === module) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
