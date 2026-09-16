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
// ⚠️ **`GET /photos` は管理API側にある**（ユーザーAPIには無い）。
// ユーザーAPI（`y9f8ajacc2`）に向けて 404 JSON で止まった（実測）。
// 未認証の GET を両方の serverless.yml から数えて確かめた:
//   api-user … /profile/{userId} /users/search /invites/{token} など
//   api      … **/photos** /photos/{id}
const PROBE_ORIGIN_DOMAIN = "rfq22dzchf.execute-api.ap-northeast-1.amazonaws.com";
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

/**
 * **第2オリジンが返したか。**
 *
 * 静的サイトは `/photos` というオブジェクトを持たないので、S3 から
 * 200+JSON が返ることはない。
 *
 * **この式は1か所にしか書かない。** 以前は3か所（自己確認・判定・結論）に
 * 同じ式を写していて、片方だけ壊す変異がどちらも観測できなかった。
 */
function isSecondOrigin({ status, contentType = "" }) {
    return status === 200 && String(contentType).includes(MARKER);
}

/** 応答から「どちらのオリジンが返したか」を読む。分からなければ "不明" */
function readOutcome(r) {
    const { status, contentType = "", body = "" } = r;
    if (isSecondOrigin(r)) return "第2オリジン（フェイルオーバーが効いた）";
    if (status === 404) return "サイトの404ページ（カスタムエラー応答が勝った）";
    if (status >= 500) return `オリジンのエラー（${status}）`;
    return `不明（status=${status} content-type=${contentType || "?"} body=${JSON.stringify(String(body).slice(0, 60))}）`;
}

module.exports = { refuseReason, PROD_API_HOSTS, withOriginGroup, withoutOriginGroup, readOutcome, isSecondOrigin, pollForFailover, MARKER, PROBE_PATH, PROBE_ORIGIN_DOMAIN, PROD_DISTRIBUTION, STAGING_DISTRIBUTION };

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
    const before = await probe(domain, `?cb=${Date.now()}`);
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
        if (!isSecondOrigin(direct)) {
            // **本文まで出す。** status だけだと「パスが違う」のか
            // 「口が閉じている」のか読めない（実際、ユーザーAPIに向けて
            // 404 JSON で止まったとき、本文を見て初めて分かった）
            line(`[verify]   本文: ${JSON.stringify(direct.body.slice(0, 200))}`);
            throw new Error(`第2オリジンが 200+JSON を返さない（status=${direct.status}）。確認にならないので中止`);
        }

        // オリジングループを足す
        const next = withOriginGroup(cfg, { fnDomain: PROBE_ORIGIN_DOMAIN });
        const upd = await cf.send(new UpdateDistributionCommand({ Id: distributionId, IfMatch: cur.ETag, DistributionConfig: next }));
        changed = true;
        line(`[verify] オリジングループを足しました（受付直後の状態: ${upd.Distribution?.Status ?? "?"}）`);

        /**
         * 🔴 **状態（`Status`）から「測ってよい」を推し量らない。**
         *
         * 前の版は `Status === "Deployed"` だけを見て**33秒で通過**した。
         * これが「本当に速かった」のか「更新前の `Deployed` を見ていた」のか、
         * **状態からは区別できない**——そして区別できないまま
         * 「フェイルオーバーは効かない」と報告するところだった。
         *
         * だから**推し量るのをやめ、確かめたいものを直接 何度も測る**:
         *
         *   - 第2オリジンの応答が出たら **その場で止める**（＝効いた）
         *   - 出なければ予算いっぱい叩き続ける（＝効かない、と言える）
         *
         * これなら反映が何秒かかろうと結論は変わらない。ついでに
         * **エッジの控え**（403/404 は `ErrorCachingMinTTL`＝10秒）も、
         * 繰り返すうちに必ず切れる。
         *
         * ⚠️ `?cb=` は当てにしない。既定のキャッシュポリシー
         * （Managed-CachingOptimized）は**クエリ文字列を鍵に入れない**ので、
         * 付けても控えを外せない可能性が高い。効いているのは「繰り返す」方。
         */
        await waitFor(async () => {
            const r = await cf.send(new GetDistributionCommand({ Id: distributionId }));
            const groups = r.Distribution?.DistributionConfig?.OriginGroups?.Quantity ?? 0;
            return groups === 1 && r.Distribution?.Status === "Deployed";
            // **900秒も待たない。** 結論を出すのは下の測定なので、ここは
            // 「たぶん反映された」程度の目安でよい。待ちを長く取ると
            // ジョブの上限（30分）と Actions の枠を無駄に食う
        }, "新しい構成が Deployed になる", 300).catch((e) => {
            // 待ちきれなくても**測りにはいく**（結論は測定が出す）
            line(`[verify] （状態の確認は待ちきれず: ${e.message}。そのまま測ります）`);
        });

        const { last: after, ok, tries } = await pollForFailover(domain);
        line(`\n[verify] ${tries}回 叩いた結果: status=${after.status} content-type=${after.contentType || "?"} → ${readOutcome(after)}`);
        line("─".repeat(52));
        if (ok) {
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

/**
 * **第2オリジンが出るまで、予算いっぱい叩く。**
 *
 * 出たら即やめる（効いた）。出なければ予算を使い切ってから「効かない」と言う。
 * 各回をログに出すので、**次に読む人が結論ではなく経過で判断できる**。
 */
async function pollForFailover(domain, {
    limitSec = 240,
    everySec = 10,
    // **測る道具・書く道具・待つ道具は差し替えられるようにする。**
    // そうしないと、この関数（この差分の肝）をテストから動かせない
    probeFn = probe,
    log = line,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = () => Date.now(),
} = {}) {
    const started = now();
    let tries = 0;
    let last = { status: 0, contentType: "", body: "一度も叩けていない" };
    for (;;) {
        tries += 1;
        last = await probeFn(domain, `?cb=${now()}`);
        const sec = Math.round((now() - started) / 1000);
        log(`[verify]   ${String(sec).padStart(3)}秒 #${tries}: status=${last.status} content-type=${last.contentType || "?"}`);
        if (isSecondOrigin(last)) return { last, ok: true, tries };
        if ((now() - started) / 1000 + everySec > limitSec) return { last, ok: false, tries };
        await sleep(everySec * 1000);
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

const probe = (domain, extra = "") => probeUrl(`https://${domain}${PROBE_PATH}${extra}`);

// **入口はファイルの末尾に置く。** 途中に置いていたら、`main()` が
// `const line` の宣言より先に走って `ReferenceError`（TDZ）になった
// ——`node --check` も eslint も tsc も通り、**実行して初めて落ちた**。
// 純関数のテストは24件緑のままで、`main()` は1行も通っていなかった。
if (require.main === module) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
