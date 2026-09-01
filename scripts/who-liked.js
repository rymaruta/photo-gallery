/**
 * who-liked.js — 自分の写真にいいねした人を特定する（読み取り専用）。
 *
 * 通知には「誰が」の情報が名前しか残っておらず、しかも名前未設定の人は
 * 既定名で表示されるため、通知からは相手にたどり着けない。
 * いいね自体は like#{photoId}#{userId} という行で1件ずつ記録されているので、
 * そこから userId を引いてプロフィールのURLを出す。
 *
 * 表示するのは指定したユーザーの写真に対するいいねだけ。
 * OWNER_USER_ID は必須。未指定で全員分を出すと、CIログに全ユーザーの
 * 表示名・@ユーザー名・いいね関係が並んでしまう。
 */

const { DynamoDBClient, ScanCommand, GetItemCommand } = require("@aws-sdk/client-dynamodb");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");
const { requireEnv } = require("./lib/env");

const REGION = "ap-northeast-1";
const PHOTOS_TABLE = requireEnv("PHOTOS_TABLE");
const USERS_TABLE = requireEnv("USERS_TABLE");
// 本番URLへのフォールバックは置かない（CLAUDE.md）。ワークフローが環境ごとの値を渡す
const SITE_URL = requireEnv("SITE_URL").replace(/\/$/, "");
// 対象ユーザーの userId。必須。
const OWNER_ID = (process.env.OWNER_USER_ID || "").trim();

const ddb = new DynamoDBClient({ region: REGION });

async function scanAll(params) {
    const items = [];
    let key;
    do {
        const res = await ddb.send(new ScanCommand({ ...params, ExclusiveStartKey: key }));
        items.push(...(res.Items ?? []).map((i) => unmarshall(i)));
        key = res.LastEvaluatedKey;
    } while (key);
    return items;
}

(async () => {
    if (!OWNER_ID) {
        console.error("OWNER_USER_ID が未指定です。対象のユーザーIDを指定してください。");
        console.error("（未指定で実行すると全ユーザーのいいね関係がログに出てしまうため中止します）");
        process.exit(1);
    }

    // 1. 対象ユーザーの写真
    const photos = await scanAll({
        TableName: PHOTOS_TABLE,
        FilterExpression: "attribute_exists(userId)",
        ProjectionExpression: "id, userId, title",
    });
    const mine = photos.filter((p) => p.userId === OWNER_ID);
    console.log(`対象の写真: ${mine.length}枚`);
    const mineIds = new Set(mine.map((p) => p.id));

    // 2. いいねの記録
    const likes = await scanAll({
        TableName: PHOTOS_TABLE,
        FilterExpression: "#l = :t",
        ExpressionAttributeNames: { "#l": "like" },
        ExpressionAttributeValues: marshall({ ":t": true }),
        ProjectionExpression: "id, photoId, uid, createdAt",
    });
    const onMine = likes.filter((l) => mineIds.has(l.photoId));
    console.log(`この人の写真へのいいね: ${onMine.length}件`);

    // 3. いいねした人ごとにまとめ、プロフィールの有無を見る
    const byUser = new Map();
    for (const l of onMine) {
        if (!l.uid) continue;
        const cur = byUser.get(l.uid) ?? { count: 0, last: "" };
        cur.count++;
        if (String(l.createdAt ?? "") > cur.last) cur.last = String(l.createdAt ?? "");
        byUser.set(l.uid, cur);
    }

    console.log(`\nいいねした人: ${byUser.size}人`);
    for (const [uid, info] of [...byUser.entries()].sort((a, b) => b[1].last.localeCompare(a[1].last))) {
        let name = "(プロフィール未作成)";
        try {
            const res = await ddb.send(new GetItemCommand({
                TableName: USERS_TABLE,
                Key: marshall({ userId: uid }),
                ProjectionExpression: "displayName, username",
            }));
            if (res.Item) {
                const p = unmarshall(res.Item);
                name = p.displayName || (p.username ? `@${p.username}` : "(名前未設定)");
            }
        } catch { /* 取得できなければ未作成扱い */ }
        console.log(`\n  ${name}`);
        console.log(`    いいね ${info.count}件 / 最終 ${info.last || "不明"}`);
        console.log(`    プロフィール: ${SITE_URL}/users/${encodeURIComponent(uid)}`);
    }

    if (byUser.size === 0) console.log("（まだ誰からもいいねされていません）");
})().catch((e) => { console.error("エラー:", e); process.exit(1); });
