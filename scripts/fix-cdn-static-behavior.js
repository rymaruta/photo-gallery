/**
 * fix-cdn-static-behavior.js
 *
 * 「初回アクセスで CSS/JS が落ちて崩れる」の根本対策。
 *
 * 原因: OGP用の Lambda@Edge（viewer-request / origin-response）が
 * 既定のキャッシュ動作に付いており、/_next/static/* の CSS/JS も含めた
 * 全リクエストで実行される。1ページ開くと十数本のアセットを同時取得するため、
 * エッジがコールドな初回アクセスで同時起動に失敗すると CloudFront が 503 を返し、
 * その分の CSS/JS が欠落する（並列取得で実際に 503 を再現済み）。
 *
 * 対策: /_next/static/* 専用のキャッシュ動作を追加し、Lambda@Edge を外す。
 * 静的なハッシュ付きファイルに OGP 書き換えは不要なので、機能上の影響はない。
 * 1ページあたりの Lambda@Edge 実行が十数回 → 1回になり、コストと遅延も下がる。
 *
 * 既定はドライラン。--apply を付けたときだけ変更する。冪等（既にあれば何もしない）。
 */

const { CloudFrontClient, GetDistributionConfigCommand, UpdateDistributionCommand } = require("@aws-sdk/client-cloudfront");

const REGION = "ap-northeast-1";
const DIST_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID || "EYRLTGCPOS9E4";
const PATH_PATTERN = "/_next/static/*";
const APPLY = process.argv.includes("--apply");

const cf = new CloudFrontClient({ region: REGION });

/** 既定の動作をひな型に、Lambda@Edge だけ外した専用の動作を作る（他の設定は引き継ぐ） */
function buildStaticBehavior(defaultBehavior) {
    const behavior = JSON.parse(JSON.stringify(defaultBehavior));
    behavior.PathPattern = PATH_PATTERN;
    // ここが本題。Lambda@Edge と CloudFront Functions を外す
    behavior.LambdaFunctionAssociations = { Quantity: 0, Items: [] };
    behavior.FunctionAssociations = { Quantity: 0, Items: [] };
    return behavior;
}

(async () => {
    console.log(`対象: distribution ${DIST_ID}`);
    console.log(APPLY ? "モード: 適用（設定を変更します）" : "モード: ドライラン（変更しません）");

    const res = await cf.send(new GetDistributionConfigCommand({ Id: DIST_ID }));
    const cfg = res.DistributionConfig;
    const etag = res.ETag;

    const existing = (cfg.CacheBehaviors?.Items ?? []).find((b) => b.PathPattern === PATH_PATTERN);
    if (existing) {
        const lambdaCount = existing.LambdaFunctionAssociations?.Quantity ?? 0;
        console.log(`\n${PATH_PATTERN} の動作は既にあります（Lambda@Edge ${lambdaCount}件）`);
        if (lambdaCount === 0) {
            console.log("すでに対策済みです。何もしません。");
            return;
        }
        console.log("Lambda@Edge が残っているため外します。");
        existing.LambdaFunctionAssociations = { Quantity: 0, Items: [] };
        existing.FunctionAssociations = { Quantity: 0, Items: [] };
    } else {
        const def = cfg.DefaultCacheBehavior;
        const defLambdas = (def.LambdaFunctionAssociations?.Items ?? []).map((f) => `${f.EventType}=${f.LambdaFunctionARN}`);
        console.log("\n現在の既定の動作に付いている Lambda@Edge:");
        for (const l of defLambdas) console.log(`  ${l}`);
        if (defLambdas.length === 0) {
            console.log("  なし（既定に Lambda@Edge が無いので、この対策は不要かもしれません）");
        }

        const behavior = buildStaticBehavior(def);
        cfg.CacheBehaviors = cfg.CacheBehaviors ?? { Quantity: 0, Items: [] };
        cfg.CacheBehaviors.Items = cfg.CacheBehaviors.Items ?? [];
        // 先頭に入れる（CloudFront は先に一致した動作を使う。他のパターンとは競合しないが明示的に）
        cfg.CacheBehaviors.Items.unshift(behavior);
        cfg.CacheBehaviors.Quantity = cfg.CacheBehaviors.Items.length;

        console.log(`\n追加する動作:`);
        console.log(`  パス: ${behavior.PathPattern}`);
        console.log(`  オリジン: ${behavior.TargetOriginId}`);
        console.log(`  キャッシュポリシー: ${behavior.CachePolicyId ?? "(legacy)"}`);
        console.log(`  圧縮: ${behavior.Compress}`);
        console.log(`  Lambda@Edge: なし  ← ここが対策`);
    }

    if (!APPLY) {
        console.log("\nドライランのため変更していません。適用するには apply を指定して再実行してください。");
        return;
    }

    await cf.send(new UpdateDistributionCommand({ Id: DIST_ID, IfMatch: etag, DistributionConfig: cfg }));
    console.log("\n適用しました。CloudFront への反映（Deployed）まで数分〜15分ほどかかります。");
    console.log("反映後に Diagnose CDN を再実行して、並列取得が全て 200 になることを確認してください。");
})().catch((e) => {
    console.error("エラー:", e.name, e.message);
    if (e.name === "AccessDenied" || e.name === "AccessDeniedException") {
        console.error("デプロイ用 IAM に cloudfront:UpdateDistribution が必要です。");
    }
    process.exit(1);
});
