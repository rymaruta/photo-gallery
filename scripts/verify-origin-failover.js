/**
 * verify-origin-failover.js
 *
 * **動的化（②）の設計が成立するかを、staging の実機で1回だけ確かめる。**
 *
 * `docs/dynamic-photo-page-2026-09.md` が推した案 (c) は
 * 「S3 に無いページは Lambda が作って S3 に置き、返す」形。合図に使えるのは
 * **S3 が返す 403/404** しかない。ところが:
 *
 *   `fix-cdn-error-pages.js` が 403/404 を `/404.html` に振り替えており、
 *   **カスタムエラー応答はディストリビューション全体に効く**（ビヘイビアごとに
 *   分けられない）。
 *
 * つまり「404 をきっかけに Lambda へ回す」は、そのままでは**必ず 404.html に
 * 化けます**。逃げ道は **オリジングループのフェイルオーバー**
 * （S3 が 403/404 を返したら第2オリジンへ）——これはカスタムエラー応答より
 * **手前**で効くはず。設計書は「実機で1回確かめてからでないと確定できない」と
 * 書いて止まっていた。これがその確認。
 *
 * **確かめること**: staging で、存在しないパスを叩いたとき
 *   - いま         → `/404.html`（サイトの404ページ）
 *   - 仕掛けたあと → **第2オリジンの目印**（＝フェイルオーバーが勝つ）
 *
 * 既定はドライラン。`--apply` のときだけ作り、**最後に必ず元へ戻す**。
 *
 * ⚠️ **本番では動かない。** 名前・ID を1つでも本番のものが混ざったら止める
 *    （台帳の傷: ガードがバケットとテーブルしか見ておらず、**関数名は本番でも
 *     素通り**した。ここでは配信ID・バケット名・関数名の**全部**を見る）。
 */

const {
    CloudFrontClient, GetDistributionConfigCommand, UpdateDistributionCommand, GetDistributionCommand,
} = require("@aws-sdk/client-cloudfront");
const { requireEnv } = require("./lib/env");

const REGION = "ap-northeast-1";
const APPLY = process.argv.includes("--apply");

/** 触ってよい配信は staging のものだけ。本番の ID は名指しで拒む */
const PROD_DISTRIBUTION = "EYRLTGCPOS9E4";
const STAGING_DISTRIBUTION = "EF2TFEBBP24DL";
/**
 * **第2オリジンには staging の ユーザーAPI を使う。**
 *
 * 最初は「目印を返すだけの Lambda」を作って Function URL を公開したが、
 * **このアカウントは公開の Function URL を上位の方針で止めている**
 * ——リソースポリシーは正しく入る（`Principal:"*"` ＋
 * `lambda:FunctionUrlAuthType: NONE` の条件つき）のに 403 が返り、
 * 本文も `Forbidden. For troubleshooting Function URL authorization issues…`
 * だった（実測）。
 *
 * **これは設計の問題ではない。** 本番の案 (c) は CloudFront から Lambda を
 * 呼ぶので `AuthType: AWS_IAM` ＋ OAC（CloudFront が署名する）を使えばよく、
 * 公開URLは要らない。**確認の道具が公開URLを使っていただけ**。
 *
 * 代わりに、**既にある公開の口**を第2オリジンにする:
 *
 *     確認するパス /photos
 *       S3  → そんなオブジェクトは無い → 403（OAC なので404ではない）＝合図
 *       API → `GET /photos` は未認証で叩ける口 → **200 + JSON**
 *
 * 効かなければ `/404.html`（HTML・404）が返るので一目で区別できる。
 * 関数もIAMも作らないので、速くて安全。
 */
const PROBE_ORIGIN_DOMAIN = "y9f8ajacc2.execute-api.ap-northeast-1.amazonaws.com";
/** S3 には無く、API には在るパス */
const PROBE_PATH = "/photos";
/** 第2オリジンから返ったと分かる印（API の応答は JSON の配列） */
const MARKER = "application/json";

/**
 * **触ってよい相手か。** 駄目な理由を返す（null なら通す）。
 *
 * 本番と staging は**同じアカウント・同じ資格情報**で、区別は名前だけ。
 * だから「staging と書いてある」ではなく「**本番のものが1つも混ざっていない**」
 * を見る。片方だけの判定は台帳が一度破られている。
 */
/** 本番の API Gateway（第2オリジンに繋いだら staging が本番のデータを出す） */
const PROD_API_HOSTS = ["ionr4ik01e", "gu7kxwdc5l"];
/** staging の API Gateway */
const STAGING_API_HOSTS = ["rfq22dzchf", "y9f8ajacc2"];

function refuseReason({ distributionId, originDomain, buckets = [] }) {
    if (!distributionId) return "配信IDが空";
    if (distributionId === PROD_DISTRIBUTION) return "本番の CloudFront ディストリビューション";
    if (distributionId !== STAGING_DISTRIBUTION) return `知らない配信（staging は ${STAGING_DISTRIBUTION}）`;
    if (!originDomain) return "第2オリジンが空";
    // **本番のAPIを staging に繋がない。** 繋ぐと staging の画面に
    // 本番の写真・利用者が出る（staging を空から始めた方針が崩れる）
    if (PROD_API_HOSTS.some((h) => originDomain.includes(h))) return `本番の API Gateway（${originDomain}）`;
    if (!STAGING_API_HOSTS.some((h) => originDomain.includes(h))) return `知らない第2オリジン（${originDomain}）`;
    for (const b of buckets) {
        if (/^prod-/.test(b) || b === "journey-photo.com") return `本番のバケットが混ざっている（${b}）`;
    }
    return null;
}

/**
 * オリジングループを足した配信設定を返す（**元の設定は書き換えない**）。
 *
 * - 第2オリジンは Lambda の Function URL（`https://<id>.lambda-url.<region>.on.aws`）
 * - **403 と 404 の両方**で切り替える。S3 + OAC は**存在しないオブジェクトに 403**
 *   を返す（`ListBucket` を与えていないため）。404 だけだと発火しない
 * - 既定のビヘイビアの向き先をグループに変える。**他のビヘイビアは触らない**
 */
function withOriginGroup(cfg, { fnDomain, groupId = "failover-group", originId = "probe-lambda" }) {
    const next = JSON.parse(JSON.stringify(cfg));
    const origins = next.Origins?.Items ?? [];
    const primaryId = next.DefaultCacheBehavior?.TargetOriginId;
    if (!primaryId) throw new Error("既定のビヘイビアにオリジンが無い");
    if (!origins.some((o) => o.Id === primaryId)) throw new Error(`既定のオリジン ${primaryId} が見つからない`);

    const probe = {
        Id: originId,
        DomainName: fnDomain,
        OriginPath: "",
        CustomHeaders: { Quantity: 0, Items: [] },
        CustomOriginConfig: {
            HTTPPort: 80, HTTPSPort: 443, OriginProtocolPolicy: "https-only",
            OriginSslProtocols: { Quantity: 1, Items: ["TLSv1.2"] },
            OriginReadTimeout: 30, OriginKeepaliveTimeout: 5,
        },
        ConnectionAttempts: 3, ConnectionTimeout: 10,
        OriginShield: { Enabled: false },
        OriginAccessControlId: "",
    };
    next.Origins = {
        Quantity: origins.length + 1,
        Items: [...origins.filter((o) => o.Id !== originId), probe],
    };
    next.OriginGroups = {
        Quantity: 1,
        Items: [{
            Id: groupId,
            FailoverCriteria: { StatusCodes: { Quantity: 2, Items: [403, 404] } },
            Members: { Quantity: 2, Items: [{ OriginId: primaryId }, { OriginId: originId }] },
        }],
    };
    next.DefaultCacheBehavior = { ...next.DefaultCacheBehavior, TargetOriginId: groupId };
    return next;
}

/** 確認したあと、元の姿に戻すための設定（グループと第2オリジンを外す） */
function withoutOriginGroup(cfg, { originalTargetOriginId, originId = "probe-lambda" }) {
    const next = JSON.parse(JSON.stringify(cfg));
    next.Origins = {
        Quantity: (next.Origins?.Items ?? []).filter((o) => o.Id !== originId).length,
        Items: (next.Origins?.Items ?? []).filter((o) => o.Id !== originId),
    };
    next.OriginGroups = { Quantity: 0, Items: [] };
    next.DefaultCacheBehavior = { ...next.DefaultCacheBehavior, TargetOriginId: originalTargetOriginId };
    return next;
}

/** 応答から「どちらのオリジンが返したか」を読む。分からなければ "不明" */
function readOutcome({ status, contentType = "", body = "" }) {
    // **JSON が返ったら第2オリジン。** 静的サイトは `/photos` という
    // オブジェクトを持たないので、S3 から JSON が返ることはない
    if (status === 200 && String(contentType).includes(MARKER)) return "第2オリジン（フェイルオーバーが効いた）";
    if (status === 404) return "サイトの404ページ（カスタムエラー応答が勝った）";
    if (status >= 500) return `オリジンのエラー（${status}）`;
    return `不明（status=${status} content-type=${contentType || "?"} body=${JSON.stringify(String(body).slice(0, 60))}）`;
}

module.exports = { refuseReason, PROD_API_HOSTS, withOriginGroup, withoutOriginGroup, readOutcome, MARKER, PROBE_PATH, PROBE_ORIGIN_DOMAIN, PROD_DISTRIBUTION, STAGING_DISTRIBUTION };

const line = (s) => console.log(s);

async function main() {
    const distributionId = requireEnv("CLOUDFRONT_DISTRIBUTION_ID");
    const siteBucket = process.env.SITE_BUCKET ?? "";
    const why = refuseReason({ distributionId, originDomain: PROBE_ORIGIN_DOMAIN, buckets: [siteBucket].filter(Boolean) });
    if (why) {
        console.error(`\n[verify] 中止: ${why}`);
        console.error("[verify] この確認は staging 専用です。\n");
        process.exit(1);
    }
    line(`[verify] region=${REGION} 配信=${distributionId} ${APPLY ? "（実行）" : "（読むだけ）"}`);
    line("[verify] 確かめること: S3 が 403/404 を返したとき、オリジングループの");
    line("         フェイルオーバーが **カスタムエラー応答より先に** 効くか\n");

    const cf = new CloudFrontClient({ region: REGION });
    const cur = await cf.send(new GetDistributionConfigCommand({ Id: distributionId }));
    const cfg = cur.DistributionConfig;
    const dist = await cf.send(new GetDistributionCommand({ Id: distributionId }));
    const domain = dist.Distribution?.DomainName;

    line(`  ドメイン: ${domain}`);
    line(`  オリジン: ${(cfg.Origins?.Items ?? []).map((o) => `${o.Id}(${o.DomainName})`).join(", ")}`);
    line(`  既定のビヘイビアの向き先: ${cfg.DefaultCacheBehavior?.TargetOriginId}`);
    line(`  オリジングループ: ${cfg.OriginGroups?.Quantity ?? 0}件`);
    line(`  カスタムエラー応答: ${(cfg.CustomErrorResponses?.Items ?? []).map((e) => `${e.ErrorCode}→${e.ResponsePagePath}`).join(", ") || "なし"}`);

    // 仕掛ける前の姿を測る（これが「いま」の答え）
    const before = await probe(domain);
    line(`\n[verify] 仕掛ける前: status=${before.status} → ${readOutcome(before)}`);

    if (!APPLY) {
        line("\n[verify] --apply を付けると、第2オリジン（Lambda）とオリジングループを");
        line("         一時的に足して確かめ、**最後に必ず元へ戻します**。");
        return;
    }
    const originalTarget = cfg.DefaultCacheBehavior.TargetOriginId;
    let changed = false;

    try {
        // **第2オリジンが本当に目印を返すか、先に確かめる。** ここで出なければ
        // あとの判定は何を測っているか分からなくなる（測定器の自己確認）
        const direct = await probeUrl(`https://${PROBE_ORIGIN_DOMAIN}${PROBE_PATH}`);
        line(`\n[verify] 第2オリジン: ${PROBE_ORIGIN_DOMAIN}`);
        line(`[verify] 直接叩く: status=${direct.status} content-type=${direct.contentType || "?"}`);
        if (!(direct.status === 200 && String(direct.contentType).includes(MARKER))) {
            throw new Error(`第2オリジンが 200+JSON を返さない（status=${direct.status}）。確認にならないので中止`);
        }

        // オリジングループを足す
        const next = withOriginGroup(cfg, { fnDomain: PROBE_ORIGIN_DOMAIN });
        await cf.send(new UpdateDistributionCommand({ Id: distributionId, IfMatch: cur.ETag, DistributionConfig: next }));
        changed = true;
        line("[verify] オリジングループを足しました。反映を待ちます（数分）...");
        await waitFor(() => cf.send(new GetDistributionCommand({ Id: distributionId }))
            .then((r) => r.Distribution?.Status === "Deployed"), "配信が Deployed になる", 900);

        // 本番と同じ道（CloudFront 経由）で叩く
        const after = await probe(domain);
        line(`\n[verify] 仕掛けたあと: status=${after.status} content-type=${after.contentType || "?"} → ${readOutcome(after)}`);
        line("─".repeat(52));
        if (after.status === 200 && String(after.contentType).includes(MARKER)) {
            line("✅ **フェイルオーバーがカスタムエラー応答より先に効く。**");
            line("   → 案 (c)（S3 に無いページを Lambda が作って置く）は成立します。");
        } else {
            line("❌ **フェイルオーバーが効かない**（404ページが勝つ）。");
            line("   → 案 (c) はこの形では作れません。設計を選び直します。");
        }
        line("─".repeat(52));
    } finally {
        // **必ず元へ戻す。** 途中で落ちても戻す（staging を壊したまま終わらない）
        if (changed) {
            const now = await cf.send(new GetDistributionConfigCommand({ Id: distributionId }));
            const back = withoutOriginGroup(now.DistributionConfig, { originalTargetOriginId: originalTarget });
            await cf.send(new UpdateDistributionCommand({ Id: distributionId, IfMatch: now.ETag, DistributionConfig: back }));
            line("\n[verify] 配信を元に戻しました（オリジングループと第2オリジンを外した）");
        }
    }
}

async function waitFor(check, what, limitSec = 120) {
    const started = Date.now();
    for (;;) {
        if (await check().catch(() => false)) return;
        if ((Date.now() - started) / 1000 > limitSec) throw new Error(`${what} を待ちきれませんでした（${limitSec}秒）`);
        await new Promise((r) => setTimeout(r, 5000));
    }
}

async function probeUrl(url) {
    try {
        const res = await fetch(url, { redirect: "manual" });
        return { status: res.status, contentType: res.headers.get("content-type") ?? "", body: (await res.text()).slice(0, 2000) };
    } catch (e) {
        return { status: 0, contentType: "", body: String(e.message ?? e) };
    }
}

const probe = (domain) => probeUrl(`https://${domain}${PROBE_PATH}`);

// **入口はファイルの末尾に置く。** 途中に置いていたら、`main()` が
// `const line` の宣言より先に走って `ReferenceError`（TDZ）になった
// ——`node --check` も eslint も tsc も通り、**実行して初めて落ちた**。
// 純関数のテストは24件緑のままで、`main()` は1行も通っていなかった。
if (require.main === module) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
