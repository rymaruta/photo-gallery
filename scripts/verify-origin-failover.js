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
const {
    LambdaClient, CreateFunctionCommand, DeleteFunctionCommand, CreateFunctionUrlConfigCommand,
    AddPermissionCommand, GetFunctionCommand, ListFunctionsCommand,
} = require("@aws-sdk/client-lambda");
const { requireEnv } = require("./lib/env");

const REGION = "ap-northeast-1";
const APPLY = process.argv.includes("--apply");

/** 触ってよい配信は staging のものだけ。本番の ID は名指しで拒む */
const PROD_DISTRIBUTION = "EYRLTGCPOS9E4";
const STAGING_DISTRIBUTION = "EF2TFEBBP24DL";
/** この確認のために作る一時的な関数（後で必ず消す） */
const PROBE_FN = "staging-origin-failover-probe";
/** 存在しないことが確実なパス（uuid ではない語を使う。写真IDと紛れさせない） */
const PROBE_PATH = "/photo/__origin-failover-probe__";
/** 第2オリジンが返す目印 */
const MARKER = "ORIGIN-FAILOVER-OK";

/**
 * **触ってよい相手か。** 駄目な理由を返す（null なら通す）。
 *
 * 本番と staging は**同じアカウント・同じ資格情報**で、区別は名前だけ。
 * だから「staging と書いてある」ではなく「**本番のものが1つも混ざっていない**」
 * を見る。片方だけの判定は台帳が一度破られている。
 */
function refuseReason({ distributionId, functionName, buckets = [] }) {
    if (!distributionId) return "配信IDが空";
    if (distributionId === PROD_DISTRIBUTION) return "本番の CloudFront ディストリビューション";
    if (distributionId !== STAGING_DISTRIBUTION) return `知らない配信（staging は ${STAGING_DISTRIBUTION}）`;
    if (!functionName) return "関数名が空";
    if (!functionName.startsWith("staging-")) return "関数名が staging- で始まらない";
    if (/^prod-/.test(functionName)) return "本番の関数名";
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
function readOutcome({ status, body }) {
    if (typeof body === "string" && body.includes(MARKER)) return "第2オリジン（フェイルオーバーが効いた）";
    if (status === 404) return "サイトの404ページ（カスタムエラー応答が勝った）";
    if (status >= 500) return `オリジンのエラー（${status}）`;
    return `不明（status=${status}）`;
}

/**
 * **最小の ZIP を自前で組む**（stored＝無圧縮）。
 *
 * Lambda の `Code.ZipFile` は zip のバイト列を要る。このリポジトリに zip を
 * 作るライブラリは無く、**確認のためだけに依存を足すのは割に合わない**
 * （`npm ci` が壊れると全ワークフローが落ちる）。無圧縮の zip は
 * 「ローカルヘッダ + 中身 + 中央ディレクトリ + 終端」だけで、仕様も短い。
 *
 * CRC-32 は自前で計算する（zip の必須項目。間違えると Lambda が
 * 「壊れた zip」として断る）。
 */
function crc32(buf) {
    let c, crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        c = (crc ^ buf[i]) & 0xff;
        for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function zipOneFile(name, contents) {
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.from(contents, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // ローカルヘッダの印
    local.writeUInt16LE(20, 4);           // 必要な版
    local.writeUInt16LE(0, 6);            // フラグ
    local.writeUInt16LE(0, 8);            // 無圧縮
    local.writeUInt16LE(0, 10);           // 時刻
    local.writeUInt16LE(0x21, 12);        // 日付（適当な固定値＝毎回同じバイト列になる）
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // 中央ディレクトリの印
    central.writeUInt16LE(20, 4);         // 作った版
    central.writeUInt16LE(20, 6);         // 必要な版
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);         // extra
    central.writeUInt16LE(0, 32);         // コメント
    central.writeUInt16LE(0, 34);         // ディスク
    central.writeUInt16LE(0, 36);         // 内部属性
    // **`<< 16` は使えない。** 0o100644 << 16 は 2^31 を超えて負になり、
    // `writeUInt32LE` が範囲外で投げる（実際に踏んだ）
    central.writeUInt32LE((0o100644 * 0x10000) >>> 0, 38); // 外部属性（644）
    central.writeUInt32LE(0, 42);         // ローカルヘッダの位置

    const end = Buffer.alloc(22);
    const centralSize = central.length + nameBuf.length;
    const centralOffset = local.length + nameBuf.length + data.length;
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
    end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(centralOffset, 16);
    end.writeUInt16LE(0, 20);

    return Buffer.concat([local, nameBuf, data, central, nameBuf, end]);
}

/** 目印を返すだけの関数。Function URL から呼ばれる */
const PROBE_SOURCE = `exports.handler = async (event) => ({
    statusCode: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    body: "${MARKER} path=" + (event.rawPath || "?"),
});`;

module.exports = { refuseReason, withOriginGroup, withoutOriginGroup, readOutcome, crc32, zipOneFile, PROBE_SOURCE, MARKER, PROBE_PATH, PROD_DISTRIBUTION, STAGING_DISTRIBUTION, PROBE_FN };

if (require.main === module) {
    main().catch((e) => { console.error(e); process.exit(1); });
}

const line = (s) => console.log(s);

async function main() {
    const distributionId = requireEnv("CLOUDFRONT_DISTRIBUTION_ID");
    const siteBucket = process.env.SITE_BUCKET ?? "";
    const why = refuseReason({ distributionId, functionName: PROBE_FN, buckets: [siteBucket].filter(Boolean) });
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
    const lambda = new LambdaClient({ region: REGION });
    const originalTarget = cfg.DefaultCacheBehavior.TargetOriginId;
    let created = false, changed = false;

    try {
        // 1) 目印を返すだけの関数を作る。**IAM は作らない**——staging の既存の
        //    関数のロールを借りる（この確認に要るのはログの権限だけ）
        const roleArn = await borrowStagingRole(lambda);
        line(`\n[verify] 借りるロール: ${roleArn.split("/").pop()}`);
        await lambda.send(new CreateFunctionCommand({
            FunctionName: PROBE_FN, Runtime: "nodejs20.x", Role: roleArn, Handler: "index.handler",
            Code: { ZipFile: zipOneFile("index.js", PROBE_SOURCE) },
            Timeout: 5, MemorySize: 128,
            Description: "一時的な確認用（verify-origin-failover.js が作り、同じ実行で消す）",
        }));
        created = true;
        await waitFor(() => lambda.send(new GetFunctionCommand({ FunctionName: PROBE_FN }))
            .then((r) => r.Configuration?.State === "Active"), "関数が Active になる");

        const url = await lambda.send(new CreateFunctionUrlConfigCommand({ FunctionName: PROBE_FN, AuthType: "NONE" }));
        await lambda.send(new AddPermissionCommand({
            FunctionName: PROBE_FN, StatementId: "public-url", Action: "lambda:InvokeFunctionUrl",
            Principal: "*", FunctionUrlAuthType: "NONE",
        }));
        const fnDomain = new URL(url.FunctionUrl).host;
        line(`[verify] 第2オリジン: ${fnDomain}`);

        // **先に関数そのものを叩く。** ここで目印が出なければ、あとの判定は
        // 何を測っているか分からなくなる（測定器の自己確認）
        const direct = await probeUrl(`https://${fnDomain}${PROBE_PATH}`);
        line(`[verify] 関数を直接: status=${direct.status} 目印=${direct.body.includes(MARKER) ? "あり" : "**無し**"}`);
        if (!direct.body.includes(MARKER)) throw new Error("第2オリジンが目印を返さない。確認にならないので中止");

        // 2) オリジングループを足す
        const next = withOriginGroup(cfg, { fnDomain });
        await cf.send(new UpdateDistributionCommand({ Id: distributionId, IfMatch: cur.ETag, DistributionConfig: next }));
        changed = true;
        line("[verify] オリジングループを足しました。反映を待ちます（数分）...");
        await waitFor(() => cf.send(new GetDistributionCommand({ Id: distributionId }))
            .then((r) => r.Distribution?.Status === "Deployed"), "配信が Deployed になる", 900);

        // 3) 本番と同じ道（CloudFront 経由）で叩く
        const after = await probe(domain);
        line(`\n[verify] 仕掛けたあと: status=${after.status} → ${readOutcome(after)}`);
        line("─".repeat(52));
        if (after.body.includes(MARKER)) {
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
        if (created) {
            await lambda.send(new DeleteFunctionCommand({ FunctionName: PROBE_FN }));
            line("[verify] 確認用の関数を消しました");
        }
    }
}

/**
 * staging の既存の関数からロールを借りる。
 * **IAM を作らない**——この確認のために権限を増やしたくない。
 */
async function borrowStagingRole(lambda) {
    let marker;
    do {
        const res = await lambda.send(new ListFunctionsCommand({ Marker: marker, MaxItems: 50 }));
        for (const f of res.Functions ?? []) {
            const n = f.FunctionName ?? "";
            if (n.includes("-staging-") && f.Role) return f.Role;
        }
        marker = res.NextMarker;
    } while (marker);
    throw new Error("staging の関数が見つからない（ロールを借りられない）");
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
        return { status: res.status, body: (await res.text()).slice(0, 2000) };
    } catch (e) {
        return { status: 0, body: String(e.message ?? e) };
    }
}

const probe = (domain) => probeUrl(`https://${domain}${PROBE_PATH}`);
