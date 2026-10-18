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
 *
 * ## `--public-only`: 絞った写真で付いた段を1回だけ数え直す（2026-10-18・journey.photo-ios #296）
 *
 *   node scripts/backfill-badges.js --public-only            # 読むだけ（何人のどの段が下がるか）
 *   node scripts/backfill-badges.js --public-only --apply    # **段を下げて書く**（本番は札で owner の許可を取ってから）
 *
 * メダルは公開範囲を絞っていない公開の写真だけで数えるようになった（`api-user/src/badges.ts` の冒頭）。
 * ただ段は下げない決まりなので、**前に「フォロワーだけ」「親しい友達だけ」の写真で付いた段は残る**。
 * それを1回だけ直す:
 *
 * - **対象は、今、公開範囲を絞った写真（下書きでない）を1枚以上持っている人だけ。** 段が保存より
 *   低く数え直されても、それが絞った写真のせいか、公開の写真を消したせいかは見分けられない。
 *   絞った写真の無い人は後者しかありえないので、触らない（段は下げない決まりのまま）
 * - 下げるのは**数える8つの鍵だけ**（`COUNTED_BADGE_KEYS`）。初期ユーザー・Pro のメダルは触らない
 * - 下げた段の `at` は、**公開の写真だけを投稿の順に数え直して、その段に届いた写真の投稿日時**
 *   （`createdAt`）にする。分からなければ（投稿日時の無い写真で届いた・今の写真では届かない）
 *   保存されていた元の `at` を残す。
 *   2026-10-18 判断（見直し）: 流した時刻にすると、**その日に段が下がった人＝絞った写真を持つ人**と
 *   他の人に推し量れる（全員が同じ日になる）。数え直しで分かる日なら、ふだんの数え方で付いた日と見分けがつかない。
 *   0 段になった鍵は消す。上げることはしない（上がる分はふだんの数え直しが拾う）
 * - 名前の横に出していた鍵が消えても、行の `displayBadge` は触らない（公開の形は「持っていない鍵は
 *   null」で返す・`badgeKeys.ts` の `badgeFields`。また取れば元どおり出る）
 * - **通知は送らない**・rev を見て置き直す（上と同じ）
 * - 限界: 対象の人が公開の写真を消して取った段も、一緒に下がることがある。逆に、**絞った写真を
 *   消した・下書きに戻した人は対象にならない**（今は絞った写真を持っていないので、前に絞った写真で
 *   付いた段がそのまま残る）
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

/** 公開範囲を絞った、下書きでない写真か（`--public-only` の対象を決める） */
function isRestrictedPublished(lib, p) {
    return !!p && typeof p.src === "string" && p.src !== "" && p.published !== false && p.story !== true
        && lib.isRestrictedRow(p);
}

/**
 * 公開の写真（メダルを数えてよい写真）だけを投稿の順に数えて、`key` が `tier` 段に届いた写真の投稿日時。
 * 届かない・投稿日時が読めなければ null。旅の一冊は写真が増えると減ることもある（日の幅が30日を越える）ので、
 * 二分探索でなく頭から順に数える（1回限りの台本なので、1人ぶんの写真の数の2乗で構わない）
 */
function reachedAt(lib, key, tier, photos, wishKeys) {
    const dated = photos
        .filter((p) => lib.isMedalCountablePhoto(p) && typeof p.createdAt === "string" && !Number.isNaN(Date.parse(p.createdAt)))
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    for (let i = 1; i <= dated.length; i++) {
        const c = lib.countBadges(dated.slice(0, i), wishKeys);
        if (lib.tierFor(key, c[key]) >= tier) return new Date(Date.parse(dated[i - 1].createdAt)).toISOString();
    }
    return null;
}

/**
 * `--public-only` の1人ぶんの計画（純関数）。`lib` は `badges` と `badgeKeys` の関数と `isRestrictedRow`。
 *
 * @returns { write: boolean, badges, lowered: [{ key, from, to }], rev }
 */
function planPublicOnly(lib, row, photos, wishKeys) {
    const rev = typeof row.rev === "number" ? row.rev : 0;
    const stored = lib.sanitizeBadges(row.badges) ?? {};
    if (!photos.some((p) => isRestrictedPublished(lib, p))) return { write: false, badges: stored, lowered: [], rev };
    // `countBadges` は絞った写真を数えない（`isMedalCountablePhoto`）
    const counts = lib.countBadges(photos, wishKeys);
    const badges = { ...stored };
    const lowered = [];
    for (const key of lib.COUNTED_BADGE_KEYS) {
        const from = stored[key]?.tier ?? 0;
        const to = Math.min(lib.tierFor(key, counts[key]), lib.MAX_TIER[key]);
        if (to >= from) continue;
        if (to === 0) delete badges[key];
        // その段に届いた投稿の日時。分からなければ元の日（上の注記。流した日にしない）
        else badges[key] = { tier: to, at: reachedAt(lib, key, to, photos, wishKeys) ?? stored[key].at };
        lowered.push({ key, from, to });
    }
    return { write: lowered.length > 0, badges, lowered, rev };
}

async function main() {
    const { requireEnv } = require("./lib/env");
    const USERS_TABLE = requireEnv("USERS_TABLE");
    const PHOTOS_TABLE = requireEnv("PHOTOS_TABLE");
    const APPLY = process.argv.includes("--apply");

    // 数え方は Lambda と同じ TypeScript をそのまま使う
    require("tsx/cjs/api").register();
    const PUBLIC_ONLY = process.argv.includes("--public-only");
    const lib = {
        ...require("../api-user/src/badges"),
        ...require("../api-user/src/badgeKeys"),
        isRestrictedRow: require("../api-user/src/sanitize").isRestrictedRow,
    };

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

        const plan = PUBLIC_ONLY
            ? planPublicOnly(lib, row, photos, wishKeys)
            : planUser(lib, row, photos, wishKeys, now);
        if (!plan.write) continue;
        tally.toWrite++;
        // 鍵:段（増える）／鍵:元→先（下がる）
        const marks = PUBLIC_ONLY
            ? plan.lowered.map((d) => `${d.key}:${d.from}→${d.to}`)
            : plan.upgraded.map((u) => `${u.key}:${u.tier}`);
        for (const m of marks) tally.byKey[m] = (tally.byKey[m] ?? 0) + 1;
        if (sample.length < SHOW) sample.push(`${userId}（${marks.join(" ")}）`);
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

    if (PUBLIC_ONLY) {
        console.log(`プロフィール ${tally.users} 人のうち、絞った写真で付いた段が下がる人: ${tally.toWrite} 人`);
        console.log(`  下がる段（鍵:元→先 → 人数）: ${JSON.stringify(tally.byKey)}`);
    } else {
        console.log(`プロフィール ${tally.users} 人のうち、メダルが増える人: ${tally.toWrite} 人`);
        console.log(`  増えるメダル（鍵:段 → 人数）: ${JSON.stringify(tally.byKey)}`);
    }
    console.log(`  先頭の ${sample.length} 人: ${sample.join(", ") || "（なし）"}`);
    if (!APPLY) {
        console.log("  （読むだけ）apply を付けて流すと書きます。通知は送りません。");
        return;
    }
    console.log(`書いた: ${tally.written} 人・失敗: ${tally.failed} 人（失敗した人は流し直すと拾えます）`);
}

module.exports = { isLiveProfileRow, planUser, planPublicOnly };

if (require.main === module) {
    main().catch((e) => {
        console.error(`失敗: ${e.name}: ${e.message}`);
        process.exit(1);
    });
}
