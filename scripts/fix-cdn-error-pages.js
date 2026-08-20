/**
 * fix-cdn-error-pages.js
 *
 * 存在しないURLを踏んだときに、AWS の生のエラーXML（AccessDenied …）ではなく
 * サイトの404ページを見せる。
 *
 * S3 は OAC 構成だと「存在しないオブジェクト」に対して 404 ではなく 403 を返すため、
 * 403 と 404 の両方を 404.html に振り向ける。
 *
 * ⚠️ ステータスは 404 のまま返す（200 にしない）。
 *    200 + HTML にすると、存在しない CSS/JS が「読み込めたことになる」ため
 *    ブラウザの自己修復もSEOも壊れる。
 *
 * 既定はドライラン。--apply を付けたときだけ変更する。冪等。
 *
 * ⚠️ この設定はディストリビューション全体に効く。
 *    現在は API を API Gateway の直URLで呼んでいる（deploy.yml が
 *    NEXT_PUBLIC_API_BASE_URL に execute-api のURLを渡している）ため、
 *    CloudFront の /api/* を通る通信は無く、APIのエラー応答に影響しない。
 *    将来 API を相対パス（/api/...）経由に切り替えると、APIが返す403まで
 *    404のHTMLに置き換わるので、そのときはこの設定を見直すこと。
 */

const { CloudFrontClient, GetDistributionConfigCommand, UpdateDistributionCommand } = require("@aws-sdk/client-cloudfront");
const { requireEnv } = require("./lib/env");

const REGION = "ap-northeast-1";
const DIST_ID = requireEnv("CLOUDFRONT_DISTRIBUTION_ID");
const APPLY = process.argv.includes("--apply");

// 404ページ自体は静的エクスポートが /404.html として出力する
const ERROR_PAGE = "/404.html";
// エラーのキャッシュは短く。デプロイ直後の一時的な不在を長く引きずらないため
const ERROR_TTL_SEC = 10;
const TARGET_CODES = [403, 404];

const cf = new CloudFrontClient({ region: REGION });

function desired(code) {
    return {
        ErrorCode: code,
        ResponsePagePath: ERROR_PAGE,
        ResponseCode: "404",
        ErrorCachingMinTTL: ERROR_TTL_SEC,
    };
}

(async () => {
    console.log(`対象: distribution ${DIST_ID}`);
    console.log(APPLY ? "モード: 適用（設定を変更します）" : "モード: ドライラン（変更しません）");

    const res = await cf.send(new GetDistributionConfigCommand({ Id: DIST_ID }));
    const cfg = res.DistributionConfig;
    const etag = res.ETag;

    const items = cfg.CustomErrorResponses?.Items ?? [];
    console.log(`\n現在のカスタムエラーレスポンス: ${items.length}件`);
    for (const e of items) {
        console.log(`  ${e.ErrorCode} → ${e.ResponsePagePath ?? "(そのまま)"} / ${e.ResponseCode ?? "(そのまま)"} / ${e.ErrorCachingMinTTL}s`);
    }

    const next = items.filter((e) => !TARGET_CODES.includes(Number(e.ErrorCode)));
    for (const code of TARGET_CODES) next.push(desired(code));

    const same = items.length === next.length && TARGET_CODES.every((code) => {
        const cur = items.find((e) => Number(e.ErrorCode) === code);
        return cur
            && cur.ResponsePagePath === ERROR_PAGE
            && String(cur.ResponseCode) === "404"
            && Number(cur.ErrorCachingMinTTL) === ERROR_TTL_SEC;
    });
    if (same) {
        console.log("\nすでに対策済みです。何もしません。");
        return;
    }

    console.log("\n設定後:");
    for (const e of next) {
        console.log(`  ${e.ErrorCode} → ${e.ResponsePagePath} / ${e.ResponseCode} / ${e.ErrorCachingMinTTL}s`);
    }
    console.log("（403 は S3 が『存在しないオブジェクト』に返すもの。404 として自作ページを見せる）");

    if (!APPLY) {
        console.log("\nドライランのため変更していません。");
        return;
    }

    cfg.CustomErrorResponses = { Quantity: next.length, Items: next };
    await cf.send(new UpdateDistributionCommand({ Id: DIST_ID, IfMatch: etag, DistributionConfig: cfg }));
    console.log("\n適用しました。反映（Deployed）まで数分〜15分ほどかかります。");
})().catch((e) => {
    console.error("エラー:", e.name, e.message);
    process.exit(1);
});
