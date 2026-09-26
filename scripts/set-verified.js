/**
 * set-verified.js — 認証済みの印（名前の横の真鍮の封印）を運営が付ける・外す。（2026-09-26）
 *
 * 印はプロフィールの行の `verified`。**本人からは立てられない**
 * （api-user/src/userProfile.ts の更新の経路は受け取らない）ので、
 * 運営がここから行を直に書く。管理画面の口はまだ無い。
 *
 * 使い方（Maintenance ワークフローの set-verified）:
 *   target_user を指定して実行        → 対象の行を読んで、誰に付けるかを出す（読むだけ）
 *   target_user ＋ apply              → **その1行の verified を true にする**
 *   target_user ＋ apply ＋ unverify  → その1行の verified を外す
 *
 * target_user は `@ユーザー名`（または `ユーザー名`）か、userId（UUID）。
 * ユーザー名は予約の行（userId = `username#<名前>`・ownerId）から userId を引く。
 *
 * **生きている行だけ書く。** 行が無い・墓石（退会済み）の行には書かない
 * （条件付き更新。付けたつもりで空の行を作らない）。
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const REGION = "ap-northeast-1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// api-user/src/userProfile.ts の USERNAME_RE と同じ
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/**
 * 入力を「userId で引く」か「ユーザー名で引く」かに分ける。
 * 分からない形は null（書きにいかない）。
 */
function parseTarget(input) {
    const t = String(input ?? "").trim();
    if (!t) return null;
    if (UUID_RE.test(t)) return { kind: "userId", value: t.toLowerCase() };
    const name = t.replace(/^@/, "").toLowerCase();
    if (USERNAME_RE.test(name)) return { kind: "username", value: name };
    return null;
}

/** 行を読んで、付けてよい状態か（生きている行か）を言葉にする */
function describeRow(row) {
    if (!row) return { ok: false, reason: "プロフィールの行が無い（別の ID か、まだ一度もプロフィールを開いていない）" };
    if (typeof row.deletedAt === "string") return { ok: false, reason: `退会済み（deletedAt=${row.deletedAt}）` };
    return { ok: true };
}

async function main() {
    const { requireEnv } = require("./lib/env");
    const USERS_TABLE = requireEnv("USERS_TABLE");
    const APPLY = process.argv.includes("--apply");
    const UNVERIFY = process.argv.includes("--unverify");
    const target = parseTarget(process.env.TARGET_USER);
    if (!target) {
        console.error("target_user に @ユーザー名 か userId（UUID）を指定してください。");
        process.exit(1);
    }
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

    let userId = target.value;
    if (target.kind === "username") {
        const res = (await ddb.send(new GetCommand({ TableName: USERS_TABLE, Key: { userId: `username#${target.value}` } }))).Item;
        if (!res?.ownerId) {
            console.error(`ユーザー名 @${target.value} の予約が見つかりません。`);
            process.exit(1);
        }
        userId = res.ownerId;
        console.log(`@${target.value} → userId=${userId}`);
    }
    const row = (await ddb.send(new GetCommand({ TableName: USERS_TABLE, Key: { userId } }))).Item;
    const state = describeRow(row);
    console.log(`対象: userId=${userId}`);
    if (row) {
        console.log(`  表示名: ${row.displayName ?? "（なし）"}・ユーザー名: ${row.username ? "@" + row.username : "（なし）"}・いまの印: ${row.verified === true ? "あり" : "なし"}`);
    }
    if (!state.ok) {
        console.error(`  書きません: ${state.reason}`);
        process.exit(1);
    }
    const next = !UNVERIFY;
    if (!APPLY) {
        console.log(`  （読むだけ）apply を付けて流すと、印を${next ? "付けます" : "外します"}。表示名が合っているか確かめてください。`);
        return;
    }
    await ddb.send(new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { userId },
        UpdateExpression: next ? "SET verified = :v, updatedAt = :now" : "REMOVE verified SET updatedAt = :now",
        ConditionExpression: "attribute_exists(userId) AND attribute_not_exists(deletedAt)",
        ExpressionAttributeValues: next ? { ":v": true, ":now": new Date().toISOString() } : { ":now": new Date().toISOString() },
    }));
    console.log(`  印を${next ? "付けました" : "外しました"}。サイトの静的ページには次の再ビルドで出ます（アプリは開き直すと出ます）。`);
}

module.exports = { parseTarget, describeRow };

if (require.main === module) {
    main().catch((e) => {
        console.error(`失敗: ${e.name}: ${e.message}`);
        process.exit(1);
    });
}
