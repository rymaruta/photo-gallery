/**
 * add-private-behavior.js
 *
 * 絞った写真の置き場（`private/`）を CloudFront から配れるようにする
 * （`docs/restricted-image-delivery.md` の案A の第1段）。
 *
 * ## なぜ要るのか
 *
 * 今の配信には `uploads/*` 専用の振る舞い（アップロードの入れ物へ向く）しか無く、
 * `private/*` は既定の振る舞い＝**静的サイトの入れ物**へ落ちる。
 * そのまま写真を `private/` へ移すと **画像が 404 になる**。
 *
 * ## 何をするか
 *
 * `uploads/*` の振る舞いを**そのまま写して**経路だけ `private/*` にしたものを足す。
 * 行き先・キャッシュ・応答ヘッダーは公開写真と同じになる。
 *
 * **署名はまだ付けない。** 付けると、Lambda が秘密鍵を持つまで（owner が
 * Secrets に登録するまで）絞った写真が全部 403 になる。署名は第2段で
 * `setup-private-delivery.sh` が足す。
 *
 * ## 🔴 `uploads/*` には一切触らない
 *
 * `uploads/*` を書き換えると公開写真が全部割れる。この道具は**振る舞いを
 * 1つ足すだけ**で、既存の振る舞いは中身を比べて変わっていないことを確かめてから送る。
 *
 * 既定はドライラン。`--apply` を付けたときだけ変更する。冪等（既にあれば何もしない）。
 */

const PRIVATE_PATTERN = "private/*";

/** 経路の表記揺れ（先頭の `/` の有無）を吸収して比べる */
function samePattern(a, b) {
    return String(a ?? "").replace(/^\//, "") === String(b ?? "").replace(/^\//, "");
}

/**
 * 足す振る舞いを作る（**純関数**）。
 *
 * @returns {{ status: "exists" } | { status: "no-uploads" } | { status: "add", behavior: object, config: object }}
 */
function planPrivateBehavior(config) {
    const items = config.CacheBehaviors?.Items ?? [];
    if (items.some((b) => samePattern(b.PathPattern, PRIVATE_PATTERN))) return { status: "exists" };
    const uploads = items.find((b) => samePattern(b.PathPattern, "uploads/*"));
    // **既定の振る舞いを土台にしない。** 既定は静的サイトの入れ物へ向くので、
    // それを写すと「足したのに 404」になる（直したつもりで何も直らない）
    if (!uploads) return { status: "no-uploads" };

    const behavior = JSON.parse(JSON.stringify(uploads));
    // 表記は既存に揃える（`/uploads/*` なら `/private/*`）
    behavior.PathPattern = String(uploads.PathPattern).startsWith("/") ? `/${PRIVATE_PATTERN}` : PRIVATE_PATTERN;
    const next = JSON.parse(JSON.stringify(config));
    next.CacheBehaviors = {
        ...(next.CacheBehaviors ?? {}),
        Items: [...items.map((b) => JSON.parse(JSON.stringify(b))), behavior],
    };
    next.CacheBehaviors.Quantity = next.CacheBehaviors.Items.length;
    assertOnlyAdded(config, next);
    return { status: "add", behavior, config: next };
}

/**
 * 🔴 **最後の砦。** 送る設定が「元の設定に `private/*` を1つ足しただけ」で
 * あることを確かめる。`uploads/*` や既定の振る舞いが1文字でも変わっていたら止める。
 */
function assertOnlyAdded(before, after) {
    const b = before.CacheBehaviors?.Items ?? [];
    const a = after.CacheBehaviors?.Items ?? [];
    if (a.length !== b.length + 1) throw new Error("振る舞いの数が「1つ足しただけ」になっていません");
    for (let i = 0; i < b.length; i++) {
        if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
            throw new Error(`既存の振る舞い ${b[i].PathPattern} が変わっています。送りません`);
        }
    }
    const added = a[a.length - 1];
    if (!samePattern(added.PathPattern, PRIVATE_PATTERN) || /uploads/.test(added.PathPattern)) {
        throw new Error(`足す経路が ${added.PathPattern} です。private/* 以外は足しません`);
    }
    const strip = (c) => JSON.stringify({ ...c, CacheBehaviors: undefined });
    if (strip(before) !== strip(after)) throw new Error("振る舞い以外の設定が変わっています。送りません");
}

async function main() {
    const { CloudFrontClient, GetDistributionConfigCommand, UpdateDistributionCommand } = require("@aws-sdk/client-cloudfront");
    const { requireEnv } = require("./lib/env");
    const DIST_ID = requireEnv("CLOUDFRONT_DISTRIBUTION_ID");
    const APPLY = process.argv.includes("--apply");
    const cf = new CloudFrontClient({ region: "us-east-1" });

    console.log(`対象: distribution ${DIST_ID}`);
    console.log(APPLY ? "モード: 適用（設定を変更します）" : "モード: ドライラン（変更しません）");

    const res = await cf.send(new GetDistributionConfigCommand({ Id: DIST_ID }));
    const cfg = res.DistributionConfig;
    console.log("\n今の振る舞い:");
    console.log(`  (既定)  → ${cfg.DefaultCacheBehavior.TargetOriginId}`);
    for (const b of cfg.CacheBehaviors?.Items ?? []) {
        const signed = b.TrustedKeyGroups?.Enabled ? "・署名必須" : "";
        console.log(`  ${b.PathPattern}  → ${b.TargetOriginId}${signed}`);
    }

    const plan = planPrivateBehavior(cfg);
    if (plan.status === "exists") {
        console.log(`\n${PRIVATE_PATTERN} の振る舞いは既にあります。何もしません。`);
        return;
    }
    if (plan.status === "no-uploads") {
        console.error("\nuploads/* の振る舞いが見つかりません。土台が無いので止めます（既定は静的サイトへ向くので写さない）。");
        process.exitCode = 1;
        return;
    }
    console.log(`\n足す: ${plan.behavior.PathPattern} → ${plan.behavior.TargetOriginId}（uploads/* と同じ設定・署名なし）`);
    if (!APPLY) {
        console.log("ドライランなので送りません。--apply で適用します。");
        return;
    }
    await cf.send(new UpdateDistributionCommand({ Id: DIST_ID, IfMatch: res.ETag, DistributionConfig: plan.config }));
    console.log("送りました。エッジへの反映に数分かかります。");
}

module.exports = { planPrivateBehavior, assertOnlyAdded, PRIVATE_PATTERN };

if (require.main === module) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
