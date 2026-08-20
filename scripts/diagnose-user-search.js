/**
 * diagnose-user-search.js — ユーザー検索が当たらない原因の切り分け（読み取り専用）。
 *
 * 「表示名で検索しても出てこない」ときに、原因が
 *   (a) users テーブルにその人のプロフィールが無い
 *   (b) API が失敗している
 *   (c) 一致判定のロジック
 * のどれなのかを実データで確かめる。
 *
 * ⚠️ ログに他人の氏名を並べないよう、個別の表示名は出さず件数だけを出す。
 *    検索語に一致したかどうかだけを真偽で示す。
 */

const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");
const { requireEnv } = require("./lib/env");

const REGION = "ap-northeast-1";
const USERS_TABLE = requireEnv("USERS_TABLE");
const USER_API = (process.env.USER_API_BASE_URL || "https://gu7kxwdc5l.execute-api.ap-northeast-1.amazonaws.com").replace(/\/$/, "");
const QUERY = process.env.SEARCH_QUERY || "旅人";

const ddb = new DynamoDBClient({ region: REGION });

(async () => {
    console.log(`検索語: ${JSON.stringify(QUERY)}`);

    // 1. users テーブルの実態
    console.log("\n=== 1. users テーブル ===");
    let items = [];
    try {
        const res = await ddb.send(new ScanCommand({ TableName: USERS_TABLE }));
        items = (res.Items ?? []).map((i) => unmarshall(i));
        if (res.LastEvaluatedKey) console.log("（1回のスキャンで読み切れていません）");
    } catch (e) {
        console.log(`スキャンできず: ${e.name} — ${e.message}`);
        console.log("→ Lambda 側も同じ権限で動くため、これが原因なら検索は常に空になる");
        return;
    }

    const reservations = items.filter((i) => String(i.userId ?? "").startsWith("username#"));
    const profiles = items.filter((i) => !String(i.userId ?? "").startsWith("username#"));
    console.log(`全アイテム: ${items.length}（プロフィール ${profiles.length} / ユーザー名予約 ${reservations.length}）`);
    console.log(`表示名あり: ${profiles.filter((p) => typeof p.displayName === "string" && p.displayName.trim()).length}`);
    console.log(`@ユーザー名あり: ${profiles.filter((p) => typeof p.username === "string" && p.username.trim()).length}`);

    // 2. 検索語に一致するプロフィールが存在するか（表示名そのものは出さない）
    console.log("\n=== 2. 一致判定 ===");
    const needle = QUERY.trim().replace(/^@+/, "").toLowerCase();
    const matched = profiles.filter((p) => {
        const dn = String(p.displayName ?? "").toLowerCase();
        const un = String(p.username ?? "").toLowerCase();
        return dn.includes(needle) || un.includes(needle);
    });
    console.log(`テーブル上で一致するプロフィール: ${matched.length}件`);
    if (matched.length === 0) {
        console.log("→ users テーブルにその表示名のプロフィールが無い。");
        console.log("  （通知やストーリーの表示名は別の場所に保存されている可能性がある）");
    }

    // 3. 本番エンドポイントの応答
    console.log("\n=== 3. 本番エンドポイント ===");
    const url = `${USER_API}/users/search?q=${encodeURIComponent(QUERY)}`;
    try {
        const res = await fetch(url);
        const text = await res.text();
        let count = "?";
        try { count = (JSON.parse(text).users ?? []).length; } catch { /* JSONでない */ }
        console.log(`status=${res.status} 件数=${count}`);
        if (res.status !== 200) console.log(`body: ${text.slice(0, 300)}`);
    } catch (e) {
        console.log(`呼び出せず: ${e.message.split("\n")[0]}`);
    }

    console.log("\n診断完了（何も変更していません）");
})().catch((e) => { console.error("エラー:", e); process.exit(1); });
