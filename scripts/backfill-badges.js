/**
 * backfill-badges.js — 今いる全員のメダルを数え直して、プロフィールの行に書く。（2026-10-09）
 *
 * メダルはふだん「写真を上げた・直した・`GET /user/badges` を開いた」ときに数え直す
 * （`api-user/src/badgeStore.ts`）。この仕組みを入れる前から写真を持っている人は、
 * 次にそのどれかが起きるまで名前の横に出せない——それを先に埋める台本。
 *
 *   node scripts/backfill-badges.js            # 読むだけ（何人に何個付くか）
 *   node scripts/backfill-badges.js --apply    # **プロフィールの行に badges を書く**
 *
 * 必要な環境変数: USERS_TABLE・PHOTOS_TABLE。
 *
 * ## 数え方は Lambda と**同じ関数**
 *
 * `api-user/src/badges.ts` を tsx で読み込んで使う（写さない。写すと食い違う）。
 *
 * ## 書き方（`badgeStore.ts` と同じ）
 *
 * - 段は下げない・上がった段だけ `at` を今にする（`mergeBadges`）
 * - 生きている行だけ・rev を見て置き直す（アプリの更新に消されない）
 * - **通知は送らない。** 何か月も前の写真のぶんが一斉に「手に入れました」と届くと
 *   通知の一覧（50件）を押し流すので、ここでは黙って書く
 */

const REGION = "ap-northeast-1";
const USER_INDEX = "userId-createdAt-index";

/** 何人まで userId を出すか */
const SHOW = 5;

/** プロフィールの行か（予約の行 `username#…` などを除く・墓石を除く） */
function isLiveProfileRow(row) {
    return !!row && typeof row.userId === "string" && row.userId !== "" && !row.userId.includes("#")
        && typeof row.deletedAt !== "string";
}

/**
 * 1人ぶんの計画（純関数）。`badges` モジュールの関数を受け取る（テストで差し替えられるように）。
 *
 * @returns { write: boolean, badges, upgraded, rev }
 */
function planUser(lib, row, photos, wishKeys, nowIso) {
    const counts = lib.countBadges(photos, wishKeys);
    const { badges, upgraded } = lib.mergeBadges(row.badges, counts, nowIso);
    const rev = typeof row.rev === "number" ? row.rev : 0;
    return { write: upgraded.length > 0, badges, upgraded, rev };
}

async function main() {
    const { requireEnv } = require("./lib/env");
    const USERS_TABLE = requireEnv("USERS_TABLE");
    const PHOTOS_TABLE = requireEnv("PHOTOS_TABLE");
    const APPLY = process.argv.includes("--apply");

    // 数え方は Lambda と同じ TypeScript をそのまま使う
    require("tsx/cjs/api").register();
    const lib = require("../api-user/src/badges");

    const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
    const { DynamoDBDocumentClient, ScanCommand, QueryCommand, GetCommand, PutCommand } = require("@aws-sdk/lib-dynamodb");
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
        marshallOptions: { removeUndefinedValues: true },
    });

    // 1) プロフィールの行を全部
    const rows = [];
    let lastKey;
    do {
        const res = await ddb.send(new ScanCommand({ TableName: USERS_TABLE, ExclusiveStartKey: lastKey }));
        for (const it of res.Items ?? []) if (isLiveProfileRow(it)) rows.push(it);
        lastKey = res.LastEvaluatedKey;
    } while (lastKey);

    const now = new Date().toISOString();
    const tally = { users: rows.length, toWrite: 0, written: 0, failed: 0, byKey: {} };
    const sample = [];
    for (const row of rows) {
        const userId = row.userId;
        // 2) その人の写真（`listMyPhotos` と同じ条件）と「行きたい」の一覧
        const photos = [];
        let pk;
        do {
            const res = await ddb.send(new QueryCommand({
                TableName: PHOTOS_TABLE,
                IndexName: USER_INDEX,
                KeyConditionExpression: "userId = :uid",
                FilterExpression: "attribute_exists(src) AND attribute_not_exists(story)",
                ExpressionAttributeValues: { ":uid": userId },
                ExclusiveStartKey: pk,
            }));
            photos.push(...(res.Items ?? []));
            pk = res.LastEvaluatedKey;
        } while (pk);
        const spots = (await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: `spots#${userId}` } }))).Item;
        const wishKeys = Array.isArray(spots?.list) ? spots.list.filter((x) => typeof x === "string") : [];

        const plan = planUser(lib, row, photos, wishKeys, now);
        if (!plan.write) continue;
        tally.toWrite++;
        for (const u of plan.upgraded) tally.byKey[`${u.key}:${u.tier}`] = (tally.byKey[`${u.key}:${u.tier}`] ?? 0) + 1;
        if (sample.length < SHOW) sample.push(`${userId}（${plan.upgraded.map((u) => `${u.key}:${u.tier}`).join(" ")}）`);
        if (!APPLY) continue;
        try {
            await ddb.send(new PutCommand({
                TableName: USERS_TABLE,
                Item: { ...row, badges: plan.badges, rev: plan.rev + 1 },
                ConditionExpression: plan.rev === 0
                    ? "attribute_exists(userId) AND attribute_not_exists(deletedAt) AND (attribute_not_exists(rev) OR rev = :rev)"
                    : "attribute_exists(userId) AND attribute_not_exists(deletedAt) AND rev = :rev",
                ExpressionAttributeValues: { ":rev": plan.rev },
            }));
            tally.written++;
        } catch (e) {
            tally.failed++;
            console.error(`  ${userId}: 書けませんでした（${e.name}: ${e.message}）`);
        }
    }

    console.log(`プロフィール ${tally.users} 人のうち、メダルが増える人: ${tally.toWrite} 人`);
    console.log(`  増えるメダル（鍵:段 → 人数）: ${JSON.stringify(tally.byKey)}`);
    console.log(`  先頭の ${sample.length} 人: ${sample.join(", ") || "（なし）"}`);
    if (!APPLY) {
        console.log("  （読むだけ）apply を付けて流すと書きます。通知は送りません。");
        return;
    }
    console.log(`書いた: ${tally.written} 人・失敗: ${tally.failed} 人（失敗した人は流し直すと拾えます）`);
}

module.exports = { isLiveProfileRow, planUser };

if (require.main === module) {
    main().catch((e) => {
        console.error(`失敗: ${e.name}: ${e.message}`);
        process.exit(1);
    });
}
