/**
 * purge-sandbox-pro-badges.js — 本番に残った「Sandbox（TestFlight・審査）の購入から付いた Pro のメダル」を
 * 洗い出し、`--apply` で外す。（2026-10-09）
 *
 *   APPSTORE_ENVIRONMENTS=Production,Sandbox USERS_TABLE=<本番の users> node scripts/purge-sandbox-pro-badges.js
 *       # 読むだけ（誰の・どのメダルを外すか）
 *   ... node scripts/purge-sandbox-pro-badges.js --apply
 *       # **プロフィールの行から外す**
 *
 * ## なぜ要るか
 *
 * 本番は Production と Sandbox の両方の購入を受ける。Sandbox は1か月が数分なので、審査や TestFlight で
 * 買った人に、1時間で「続けた年」と季節の章が付いていた。メダルは**付けたときにプロフィールの行
 * （`badges`）へ保存する**（`supporterStore.ts` の `applyToProfile`・`badgeStore.ts` の `refreshBadges`）ので、
 * 付け方を直しても、もう付いたものは残る。それを外す台本。
 * いまの API は、Production も受けるサーバーでは Sandbox の記録からメダルを付けない
 * （`api-user/src/supporter.ts` の `isPrivateSandbox`）。
 *
 * ## 何を外すか
 *
 * - `supporter.environment` が `"Sandbox"` の人の、Pro のメダル（`supporter`・`supporterYear`・
 *   `pro<季節><年>`）だけ。写真のメダルなどは触らない。名前の横に出していた（`displayBadge`）なら外す
 * - Sandbox から本物（Production）に買い直した人は、Sandbox の頃のメダルが残っていることがある。
 *   本物の記録から付く分を超えるものを**一覧に出すだけ**（外さない。人の目で確かめる）
 *
 * サポーター番号・月数・期間（`supporter`）は触らない（本人の Pro に要る。公開はもうしない）。
 * 通知の一覧に残った「手に入れました」も触らない。
 *
 * ## 書き方
 *
 * 生きている行だけ・rev を見て置き直す（`backfill-badges.js` と同じ。アプリの更新に消されない）。
 * **Production を受けるサーバーのつもりで流すこと**（`APPSTORE_ENVIRONMENTS` に Production が無ければ止める）。
 * Sandbox だけの staging では、Sandbox のメダルは今も正しいので外さない。
 */

const REGION = "ap-northeast-1";
/** 何人まで userId を出すか */
const SHOW = 10;

/** Pro のメダルの鍵か（`api-user/src/badgeKeys.ts` の supporter・supporterYear・季節の章） */
function isProBadgeKey(key) {
    return key === "supporter" || key === "supporterYear" || /^pro(Spring|Summer|Autumn|Winter)\d{4}$/.test(key);
}

/** プロフィールの行か（予約の行 `username#…` などを除く・墓石を除く） */
function isLiveProfileRow(row) {
    return !!row && typeof row.userId === "string" && row.userId !== "" && !row.userId.includes("#")
        && typeof row.deletedAt !== "string";
}

/**
 * 1人ぶんの計画（純関数）。
 *
 * @param lib `api-user/src/proBadges` の `mergeProBadges`（本物の記録から付く分を数える。テストで差し替えられる）
 * @returns
 *   { action: "remove", removed: 鍵[], item: 置き直す行, rev }  … Sandbox の人
 *   { action: "review", excess: 鍵[] }                          … 本物の人で、本物の記録から付く分を超えるもの
 *   { action: "none" }
 */
function planUser(lib, row, nowMs) {
    const badges = row && row.badges && typeof row.badges === "object" && !Array.isArray(row.badges) ? row.badges : {};
    const proKeys = Object.keys(badges).filter(isProBadgeKey);
    if (proKeys.length === 0) return { action: "none" };
    const env = row.supporter && typeof row.supporter === "object" ? row.supporter.environment : undefined;

    if (env === "Sandbox") {
        const kept = {};
        for (const [k, v] of Object.entries(badges)) if (!isProBadgeKey(k)) kept[k] = v;
        const rev = typeof row.rev === "number" ? row.rev : 0;
        const item = { ...row, badges: kept, rev: rev + 1 };
        if (Object.keys(kept).length === 0) delete item.badges;
        if (typeof row.displayBadge === "string" && isProBadgeKey(row.displayBadge)) delete item.displayBadge;
        return { action: "remove", removed: proKeys, item, rev };
    }

    if (env === "Production") {
        const justified = lib.mergeProBadges(undefined, row.supporter, nowMs).badges;
        const excess = proKeys.filter((k) => (badges[k]?.tier ?? 0) > (justified[k]?.tier ?? 0));
        return excess.length > 0 ? { action: "review", excess } : { action: "none" };
    }
    return { action: "none" };
}

async function main() {
    const { requireEnv } = require("./lib/env");
    const USERS_TABLE = requireEnv("USERS_TABLE");
    const ENVS = requireEnv("APPSTORE_ENVIRONMENTS", "本番なら APPSTORE_ENVIRONMENTS=Production,Sandbox を付けてください");
    if (!ENVS.split(",").some((s) => s.trim() === "Production")) {
        console.error("APPSTORE_ENVIRONMENTS に Production がありません。Sandbox だけのサーバー（staging）では外しません。");
        process.exit(1);
    }
    const APPLY = process.argv.includes("--apply");

    // 数え方は Lambda と同じ TypeScript をそのまま使う
    require("tsx/cjs/api").register();
    const lib = require("../api-user/src/proBadges");

    const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
    const { DynamoDBDocumentClient, ScanCommand, PutCommand } = require("@aws-sdk/lib-dynamodb");
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
        marshallOptions: { removeUndefinedValues: true },
    });

    const rows = [];
    let lastKey;
    do {
        const res = await ddb.send(new ScanCommand({ TableName: USERS_TABLE, ExclusiveStartKey: lastKey }));
        for (const it of res.Items ?? []) if (isLiveProfileRow(it)) rows.push(it);
        lastKey = res.LastEvaluatedKey;
    } while (lastKey);

    const now = Date.now();
    const tally = { users: rows.length, toRemove: 0, removed: 0, failed: 0, review: 0, byKey: {} };
    const sample = [];
    const review = [];
    for (const row of rows) {
        const plan = planUser(lib, row, now);
        if (plan.action === "review") {
            tally.review++;
            review.push(`${row.userId}（${plan.excess.join(" ")}）`);
            continue;
        }
        if (plan.action !== "remove") continue;
        tally.toRemove++;
        for (const k of plan.removed) tally.byKey[k] = (tally.byKey[k] ?? 0) + 1;
        if (sample.length < SHOW) sample.push(`${row.userId}（${plan.removed.join(" ")}）`);
        if (!APPLY) continue;
        try {
            await ddb.send(new PutCommand({
                TableName: USERS_TABLE,
                Item: plan.item,
                ConditionExpression: plan.rev === 0
                    ? "attribute_exists(userId) AND attribute_not_exists(deletedAt) AND (attribute_not_exists(rev) OR rev = :rev)"
                    : "attribute_exists(userId) AND attribute_not_exists(deletedAt) AND rev = :rev",
                ExpressionAttributeValues: { ":rev": plan.rev },
            }));
            tally.removed++;
        } catch (e) {
            tally.failed++;
            console.error(`  ${row.userId}: 書けませんでした（${e.name}: ${e.message}）`);
        }
    }

    console.log(`プロフィール ${tally.users} 人のうち、Sandbox の Pro のメダルを持つ人: ${tally.toRemove} 人`);
    console.log(`  外すメダル（鍵 → 人数）: ${JSON.stringify(tally.byKey)}`);
    console.log(`  先頭の ${sample.length} 人: ${sample.join(", ") || "（なし）"}`);
    console.log(`本物の記録から付く分を超える Pro のメダルを持つ人（外さない・要確認）: ${tally.review} 人`);
    if (review.length > 0) console.log(`  ${review.slice(0, SHOW).join(", ")}`);
    if (!APPLY) {
        console.log("  （読むだけ）--apply を付けて流すと外します。");
        return;
    }
    console.log(`外した: ${tally.removed} 人・失敗: ${tally.failed} 人（失敗した人は流し直すと拾えます）`);
}

module.exports = { isProBadgeKey, isLiveProfileRow, planUser };

if (require.main === module) {
    main().catch((e) => {
        console.error(`失敗: ${e.name}: ${e.message}`);
        process.exit(1);
    });
}
