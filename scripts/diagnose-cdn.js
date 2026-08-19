/**
 * diagnose-cdn.js — 配信まわりの読み取り専用の診断。
 *
 * 目的: 「初回アクセスで CSS が当たらず崩れて見える」の原因を、推測ではなく実データで特定する。
 * 何も変更しない（Get/List のみ）。GitHub Actions から手動実行する想定。
 *
 * 見るもの:
 *  1. 存在しないアセットを実際に叩いて、返るのが 404 か 403 か「200 + HTML」かを確かめる
 *     → 200+HTML なら MIME 不一致でブラウザが CSS を拒否する＝崩れる直接原因
 *  2. CloudFront の設定（カスタムエラーレスポンス・WAF・アクセスログ・キャッシュ挙動）
 *  3. アクセスログがあれば、CSS/JS の 4xx/5xx を実測で集計
 */

const { CloudFrontClient, GetDistributionConfigCommand } = require("@aws-sdk/client-cloudfront");
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require("@aws-sdk/client-s3");
const zlib = require("zlib");

const REGION = "ap-northeast-1";
const DIST_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID || "EYRLTGCPOS9E4";
const SITE_URL = (process.env.SITE_URL || "https://journey-photo.com").replace(/\/$/, "");
const LOG_FILES_TO_READ = 40; // 直近のログファイル数（多すぎると実行時間が延びる）

const cf = new CloudFrontClient({ region: REGION });
const s3 = new S3Client({ region: REGION });

function line(title) {
    console.log(`\n=== ${title} ===`);
}

/** 1. 実リクエストで挙動を確かめる（IAM 権限がなくても必ず動く） */
async function probeDelivery() {
    line("1. 実リクエストでの挙動");

    // 実在する CSS を out/ から拾う（無ければスキップ）
    let realCss = null;
    try {
        const fs = require("fs");
        const path = require("path");
        const dir = path.resolve(__dirname, "../out/_next/static");
        const stack = [dir];
        while (stack.length && !realCss) {
            const d = stack.pop();
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                const full = path.join(d, e.name);
                if (e.isDirectory()) stack.push(full);
                else if (e.name.endsWith(".css")) { realCss = full.slice(full.indexOf("/_next/")); break; }
            }
        }
    } catch { /* out/ が無ければスキップ */ }

    const targets = [
        { label: "トップページ", url: `${SITE_URL}/` },
        ...(realCss ? [{ label: "実在する CSS", url: `${SITE_URL}${realCss}` }] : []),
        { label: "存在しない CSS", url: `${SITE_URL}/_next/static/chunks/diagnose-missing-0000000000000000.css` },
        { label: "存在しない JS", url: `${SITE_URL}/_next/static/chunks/diagnose-missing-0000000000000000.js` },
        { label: "存在しないページ", url: `${SITE_URL}/diagnose-missing-page-0000` },
    ];

    for (const t of targets) {
        try {
            const res = await fetch(t.url, { redirect: "manual" });
            const ct = res.headers.get("content-type") || "-";
            const cc = res.headers.get("cache-control") || "-";
            const hit = res.headers.get("x-cache") || "-";
            console.log(`${t.label.padEnd(16)} status=${res.status} content-type=${ct} x-cache=${hit}`);
            console.log(`${"".padEnd(16)} cache-control=${cc}`);
            console.log(`${"".padEnd(16)} url=${t.url}`);
            // 「200 なのに HTML」= ブラウザが CSS/JS として拒否する。最悪ケース
            if (res.status === 200 && /\.(css|js)$/.test(t.url) && ct.includes("text/html")) {
                console.log(`${"".padEnd(16)} ⚠️  200 だが HTML が返っている（MIME 不一致でブラウザが拒否＝崩れる直接原因）`);
            }
        } catch (e) {
            console.log(`${t.label.padEnd(16)} 取得失敗: ${e.message.split("\n")[0]}`);
        }
    }
}

/** 2. CloudFront の設定 */
async function inspectDistribution() {
    line("2. CloudFront 設定");
    let cfg;
    try {
        const res = await cf.send(new GetDistributionConfigCommand({ Id: DIST_ID }));
        cfg = res.DistributionConfig;
    } catch (e) {
        console.log(`取得できず: ${e.name} — ${e.message}`);
        console.log("（デプロイ用 IAM に cloudfront:GetDistributionConfig が無い可能性）");
        return null;
    }

    console.log(`WAF(WebACL): ${cfg.WebACLId ? cfg.WebACLId : "なし（未アタッチ）"}`);
    console.log(`アクセスログ: ${cfg.Logging?.Enabled ? `有効 bucket=${cfg.Logging.Bucket} prefix=${cfg.Logging.Prefix || "(なし)"}` : "無効"}`);
    console.log(`HTTPバージョン: ${cfg.HttpVersion}`);

    const errs = cfg.CustomErrorResponses?.Items ?? [];
    console.log(`カスタムエラーレスポンス: ${errs.length}件`);
    for (const e of errs) {
        console.log(`  ${e.ErrorCode} → ${e.ResponsePagePath ?? "(そのまま)"} / 返すステータス=${e.ResponseCode ?? "(そのまま)"} / エラーキャッシュ=${e.ErrorCachingMinTTL}s`);
        // 404/403 を HTML ページに 200 で差し替える設定は、存在しない CSS/JS が
        // 「200 + text/html」になるため崩れの直接原因になる
        if ((e.ErrorCode === 403 || e.ErrorCode === 404) && String(e.ResponseCode) === "200") {
            console.log("  ⚠️  4xx を 200 + HTML に差し替えている → 存在しない CSS/JS が HTML として返る");
        }
    }

    const describe = (b, name) => {
        console.log(`  [${name}] compress=${b.Compress} cachePolicy=${b.CachePolicyId ?? "(legacy)"} minTTL=${b.MinTTL ?? "-"} defaultTTL=${b.DefaultTTL ?? "-"} maxTTL=${b.MaxTTL ?? "-"}`);
        const fns = b.FunctionAssociations?.Items ?? [];
        const lambdas = b.LambdaFunctionAssociations?.Items ?? [];
        if (fns.length) console.log(`  [${name}] CloudFront Functions: ${fns.map((f) => f.EventType).join(", ")}`);
        if (lambdas.length) console.log(`  [${name}] Lambda@Edge: ${lambdas.map((f) => f.EventType).join(", ")}`);
    };
    console.log("キャッシュ動作:");
    describe(cfg.DefaultCacheBehavior, "default");
    for (const b of cfg.CacheBehaviors?.Items ?? []) describe(b, b.PathPattern);

    console.log("オリジン:");
    for (const o of cfg.Origins?.Items ?? []) {
        console.log(`  ${o.Id} → ${o.DomainName} ${o.OriginAccessControlId ? "(OAC)" : ""}${o.S3OriginConfig ? " (S3)" : ""}${o.CustomOriginConfig ? " (カスタム)" : ""}`);
    }
    return cfg;
}

/** 3. アクセスログから 4xx/5xx を集計 */
async function analyzeLogs(cfg) {
    line("3. アクセスログの 4xx/5xx 集計");
    if (!cfg) { console.log("設定が読めなかったためスキップ"); return; }
    if (!cfg.Logging?.Enabled) {
        console.log("アクセスログが無効です。有効にしないと実際の 4xx の内訳は分かりません。");
        console.log("→ 対策: CloudFront の標準ログ（S3 出力）を有効化してから再実行してください。");
        return;
    }

    const bucket = cfg.Logging.Bucket.replace(/\.s3(\.[a-z0-9-]+)?\.amazonaws\.com$/, "");
    const prefix = cfg.Logging.Prefix || "";
    let objects = [];
    try {
        const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1000 }));
        objects = (res.Contents ?? []).filter((o) => o.Key.endsWith(".gz"));
    } catch (e) {
        console.log(`ログ一覧を取得できず: ${e.name} — ${e.message}`);
        return;
    }
    if (objects.length === 0) { console.log("ログファイルがまだありません。"); return; }

    objects.sort((a, b) => b.LastModified - a.LastModified);
    const targets = objects.slice(0, LOG_FILES_TO_READ);
    console.log(`直近 ${targets.length} ファイルを解析（全 ${objects.length} 件中）`);

    const byStatus = {};          // status -> 件数
    const badAssets = {};         // "status uri" -> 件数
    let total = 0;

    for (const obj of targets) {
        let text;
        try {
            const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: obj.Key }));
            const buf = Buffer.concat(await res.Body.toArray());
            text = zlib.gunzipSync(buf).toString("utf8");
        } catch (e) {
            console.log(`  読めず ${obj.Key}: ${e.message.split("\n")[0]}`);
            continue;
        }
        for (const row of text.split("\n")) {
            if (!row || row.startsWith("#")) continue;
            const f = row.split("\t");
            // 標準ログ: date time x-edge-location sc-bytes c-ip cs-method cs(Host) cs-uri-stem sc-status ...
            const uri = f[7];
            const status = f[8];
            if (!status) continue;
            total++;
            byStatus[status] = (byStatus[status] ?? 0) + 1;
            if (Number(status) >= 400 && /\.(css|js)$/.test(uri || "")) {
                const k = `${status} ${uri}`;
                badAssets[k] = (badAssets[k] ?? 0) + 1;
            }
        }
    }

    console.log(`総リクエスト: ${total}`);
    console.log("ステータス内訳:");
    for (const [s, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
        const pct = ((n / total) * 100).toFixed(2);
        console.log(`  ${s}: ${n} (${pct}%)`);
    }

    const bad = Object.entries(badAssets).sort((a, b) => b[1] - a[1]);
    if (bad.length === 0) {
        console.log("CSS/JS の 4xx/5xx: 0件 ← アセット配信は健全");
    } else {
        console.log(`CSS/JS の 4xx/5xx: ${bad.length}種類`);
        for (const [k, n] of bad.slice(0, 20)) console.log(`  ${n}回  ${k}`);
    }
}

(async () => {
    console.log(`診断対象: ${SITE_URL} (distribution ${DIST_ID})`);
    await probeDelivery();
    const cfg = await inspectDistribution();
    await analyzeLogs(cfg);
    console.log("\n診断完了（設定は一切変更していません）");
})().catch((e) => {
    console.error("診断中にエラー:", e);
    process.exit(1);
});
