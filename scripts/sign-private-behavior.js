/**
 * sign-private-behavior.js
 *
 * 既にある `private/*` の振る舞いに**鍵グループ（署名必須）を付けるだけ**
 * （`docs/restricted-image-delivery.md` の案A の第2段）。
 *
 * ## なぜ別の道具にしたか（2026-10-18 判断）
 *
 * 第2段は `setup-private-delivery.sh` の手順3が受け持っていたが、そこは
 * 経路を `"private/*"`・`"uploads/*"`（先頭の `/` なし）で探していた。
 * 本番も staging も実際は **`/private/*`・`/uploads/*`（先頭に `/`）**
 * （2026-09-28 の `add-private-behavior` の実行ログ）なので:
 *
 *   - 既にある `/private/*` を見つけられず、**2つ目の private を足そうとする**
 *   - 土台の `uploads/*` も見つけられず、**既定の振る舞い（静的サイトの入れ物）を写す**
 *     ＝ `add-private-behavior.js` が「足したのに 404」として避けた形そのもの
 *
 * ここでは**振る舞いを足さない**。`add-private-behavior.js` が足した
 * `/private/*` を探し（表記揺れは `samePattern` で吸収）、その1つに
 * `TrustedKeyGroups` を付けるだけ。
 *
 * ## 🔴 `uploads/*` には一切触らない
 *
 * `/uploads/*` に署名必須を付けると公開写真も 403 になり、**サイト全体の画像が割れる**
 * （静的サイトの URL には期限を載せられない）。送る直前に `assertOnlySigned` が
 * 「`private/*` の `TrustedKeyGroups` 以外が1文字も変わっていない」ことを確かめる。
 *
 * ## 順番
 *
 * **Lambda が秘密鍵を持ってから流す**（デプロイのログが `画像の署名=鍵あり`）。
 * 先に流すと、絞った写真が全部 403 になる。
 *
 * 既定はドライラン。`--apply` を付けたときだけ変更する。冪等（既に同じ鍵グループなら何もしない）。
 *
 * 環境変数:
 *   CLOUDFRONT_DISTRIBUTION_ID  (必須) 対象の配信
 *   CLOUDFRONT_KEY_GROUP_ID     (必須) 付ける鍵グループ（`aws cloudfront create-key-group` の Id）
 */

const { PRIVATE_PATTERN, samePattern } = require("./add-private-behavior.js");

const clone = (v) => JSON.parse(JSON.stringify(v));

/** 経路の、ワイルドカード（`*` `?`）より手前の確定している部分（先頭に `/` を揃える） */
function literalHead(pattern) {
    const p = String(pattern ?? "");
    const norm = p.startsWith("/") || p.startsWith("*") || p.startsWith("?") ? p : `/${p}`;
    const i = norm.search(/[*?]/);
    return i === -1 ? norm : norm.slice(0, i);
}

/**
 * 🔴 **`/private/*` より前に並んでいて、`/private/` の下に当たりうる振る舞い**（2026-10-18 判断）。
 *
 * CloudFront は振る舞いを**並び順に**照らし、最初に当たったものを使う。`*.jpg` や `/p*`、
 * `/private/originals/*` のような振る舞いが前にあると、その画像は**署名なしのまま**そちらで配られる
 * ——鍵グループを付けても効かない。確定部分（ワイルドカードの手前）が `/private/` と
 * 前方一致で交わるものを「当たりうる」とみなす（迷ったら当たる側に倒す）。
 */
function shadowingBehaviors(items, privateIndex) {
    const target = "/private/";
    return items.slice(0, privateIndex).filter((b) => {
        const head = literalHead(b.PathPattern);
        return target.startsWith(head) || head.startsWith(target);
    });
}

/**
 * 鍵グループを付けた設定を作る（**純関数**）。
 *
 * @returns {{ status: "no-private" }
 *   | { status: "shadowed", behavior: object, shadows: object[] }
 *   | { status: "already", behavior: object }
 *   | { status: "other-signers", behavior: object }
 *   | { status: "sign", behavior: object, config: object }}
 */
function planSignPrivate(config, keyGroupId) {
    if (typeof keyGroupId !== "string" || !keyGroupId.trim()) throw new Error("鍵グループの Id がありません");
    const items = config.CacheBehaviors?.Items ?? [];
    const index = items.findIndex((b) => samePattern(b.PathPattern, PRIVATE_PATTERN));
    // **ここで足さない。** 足すのは `add-private-behavior.js`（uploads/* を土台に写す）だけ
    if (index < 0) return { status: "no-private" };
    const current = items[index];
    const shadows = shadowingBehaviors(items, index);
    if (shadows.length > 0) return { status: "shadowed", behavior: current, shadows };

    const groups = current.TrustedKeyGroups;
    if (groups?.Enabled && (groups.Items ?? []).length === 1 && groups.Items[0] === keyGroupId) {
        return { status: "already", behavior: current };
    }
    // 別の鍵グループや、古い方式（TrustedSigners＝ルートの鍵）が既に付いていたら、
    // 人が決めたものを黙って上書きしない
    if (groups?.Enabled || current.TrustedSigners?.Enabled) {
        return { status: "other-signers", behavior: current };
    }

    const next = clone(config);
    next.CacheBehaviors.Items[index] = {
        ...clone(current),
        TrustedKeyGroups: { Enabled: true, Quantity: 1, Items: [keyGroupId] },
    };
    assertOnlySigned(config, next);
    return { status: "sign", behavior: next.CacheBehaviors.Items[index], config: next };
}

/**
 * 🔴 **最後の砦。** 送る設定が「元の設定の `private/*` に鍵グループを付けただけ」で
 * あることを確かめる。`uploads/*` や既定の振る舞い、配信のほかの設定が
 * 1文字でも変わっていたら止める。
 */
function assertOnlySigned(before, after) {
    const b = before.CacheBehaviors?.Items ?? [];
    const a = after.CacheBehaviors?.Items ?? [];
    if (a.length !== b.length) throw new Error("振る舞いの数が変わっています。送りません");
    const withoutGroups = (x) => JSON.stringify({ ...x, TrustedKeyGroups: undefined });
    let signed = 0;
    for (let i = 0; i < b.length; i++) {
        if (JSON.stringify(a[i]) === JSON.stringify(b[i])) continue;
        const pattern = String(a[i].PathPattern ?? "");
        if (/uploads/.test(pattern) || !samePattern(pattern, PRIVATE_PATTERN)) {
            throw new Error(`既存の振る舞い ${b[i].PathPattern} が変わっています。private/* 以外には付けません`);
        }
        if (withoutGroups(a[i]) !== withoutGroups(b[i])) {
            throw new Error(`${pattern} の鍵グループ以外が変わっています。送りません`);
        }
        if (!a[i].TrustedKeyGroups?.Enabled) throw new Error(`${pattern} に鍵グループが付いていません`);
        signed++;
    }
    if (signed !== 1) throw new Error(`鍵グループを付けた振る舞いが ${signed} 個です（1つだけのはず）`);
    const strip = (c) => JSON.stringify({ ...c, CacheBehaviors: undefined });
    if (strip(before) !== strip(after)) throw new Error("振る舞い以外の設定が変わっています。送りません");
    if (JSON.stringify(before.DefaultCacheBehavior) !== JSON.stringify(after.DefaultCacheBehavior)) {
        throw new Error("既定の振る舞いが変わっています。送りません");
    }
}

async function main() {
    const { CloudFrontClient, GetDistributionConfigCommand, UpdateDistributionCommand } = require("@aws-sdk/client-cloudfront");
    const { requireEnv } = require("./lib/env");
    const DIST_ID = requireEnv("CLOUDFRONT_DISTRIBUTION_ID");
    const KEY_GROUP_ID = requireEnv("CLOUDFRONT_KEY_GROUP_ID",
        "鍵グループを作ってから（docs/restricted-image-delivery.md）、その Id を渡してください。");
    const APPLY = process.argv.includes("--apply");
    const cf = new CloudFrontClient({ region: "us-east-1" });

    console.log(`対象: distribution ${DIST_ID} / 鍵グループ ${KEY_GROUP_ID}`);
    console.log(APPLY ? "モード: 適用（設定を変更します）" : "モード: ドライラン（変更しません）");

    const res = await cf.send(new GetDistributionConfigCommand({ Id: DIST_ID }));
    const cfg = res.DistributionConfig;
    console.log("\n今の振る舞い:");
    console.log(`  (既定)  → ${cfg.DefaultCacheBehavior.TargetOriginId}`);
    for (const b of cfg.CacheBehaviors?.Items ?? []) {
        const signed = b.TrustedKeyGroups?.Enabled ? `・署名必須（${(b.TrustedKeyGroups.Items ?? []).join(",")}）` : "";
        console.log(`  ${b.PathPattern}  → ${b.TargetOriginId}${signed}`);
    }

    const plan = planSignPrivate(cfg, KEY_GROUP_ID);
    if (plan.status === "no-private") {
        console.error(`\n${PRIVATE_PATTERN} の振る舞いがありません。先に add-private-behavior を流してください。`);
        process.exitCode = 1;
        return;
    }
    if (plan.status === "shadowed") {
        console.error(`\n${plan.behavior.PathPattern} より前に、/private/ の下に当たりうる振る舞いがあります:`);
        for (const b of plan.shadows) console.error(`  ${b.PathPattern}  → ${b.TargetOriginId}`);
        console.error("その画像は署名なしのままそちらで配られます（付けても効きません）。並びを直してから流してください。");
        process.exitCode = 1;
        return;
    }
    if (plan.status === "already") {
        console.log(`\n${plan.behavior.PathPattern} には既にこの鍵グループが付いています。何もしません。`);
        return;
    }
    if (plan.status === "other-signers") {
        console.error(`\n${plan.behavior.PathPattern} には別の署名の設定が既に付いています。上書きしないので止めます。`);
        process.exitCode = 1;
        return;
    }
    console.log(`\n付ける: ${plan.behavior.PathPattern} に鍵グループ ${KEY_GROUP_ID}（ほかの振る舞いは変えません）`);
    console.log("⚠️ Lambda が秘密鍵を持っていること（デプロイのログが「画像の署名=鍵あり」）を先に確かめてください。");
    if (!APPLY) {
        console.log("ドライランなので送りません。--apply で適用します。");
        return;
    }
    await cf.send(new UpdateDistributionCommand({ Id: DIST_ID, IfMatch: res.ETag, DistributionConfig: plan.config }));
    console.log("送りました。エッジへの反映に数分かかります。");
    console.log("\n🔴 次に必ず確かめる（署名なしで 403・署名ありで 200・公開の /uploads/* は 200 のまま）:");
    console.log("    PHOTO_ID=<絞った写真のid> npm run verify:visibility:live");
}

module.exports = { planSignPrivate, assertOnlySigned, shadowingBehaviors };

if (require.main === module) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
