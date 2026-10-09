/**
 * grant-early-user.js — 初期ユーザー章（メダルの `earlyUser`）を運営が付ける。（2026-10-09）
 *
 * **対象は 2026-10-31 23:59:59（日本時間）までに登録した人。** Cognito の利用者の
 * `UserCreateDate`（登録した時刻）で決める。本人からは付けられない
 * （`api-user/src/userProfile.ts` の更新の経路は `badges` を受け取らない）ので、
 * `scripts/set-verified.js` と同じく運営がここから行を直に書く。
 *
 *   node scripts/grant-early-user.js            # 読むだけ（何人に付くか・先頭の数人の userId）
 *   node scripts/grant-early-user.js --apply    # **プロフィールの行に badges.earlyUser を書く**
 *
 * 必要な環境変数: COGNITO_USER_POOL_ID・USERS_TABLE（`scripts/lib/env.js` の requireEnv）。
 *
 * ## 書き方
 *
 * - **生きている行だけ。** 行が無い・墓石（退会済み）の行には書かない（条件付きの書き込み）
 * - **既に付いている人は触らない**（付けた日 `at` を書き換えない・冪等）
 * - `badges` の他のメダルは残す。`rev` を上げる——アプリの更新（`updateMyProfile`）は
 *   rev を見て全置換するので、上げないと古い姿で上書きされてメダルが消える
 *   （`api-user/src/badgeStore.ts` と同じ書き方）
 * - 対象は確認済み（`CONFIRMED` など `UNCONFIRMED` 以外）で、無効にされていない人
 */

const REGION = "ap-northeast-1";

/** 締め切り（この時刻ちょうどまでに登録した人が対象） */
const CUTOFF_ISO = "2026-10-31T23:59:59+09:00";
const CUTOFF_MS = Date.parse(CUTOFF_ISO);

/** 何人まで userId を出すか（ログに全員を並べない） */
const SHOW = 5;

/**
 * Cognito の利用者の一覧から、付ける相手を選ぶ（純関数）。
 *
 * @param users [{ sub, createdAt(Date|string), status, enabled }]
 * @returns 付ける相手の userId（sub）。登録の早い順
 */
function selectEarlyUsers(users, cutoffMs = CUTOFF_MS) {
    const out = [];
    for (const u of users ?? []) {
        if (!u || typeof u.sub !== "string" || !u.sub) continue;
        if (u.status === "UNCONFIRMED") continue;   // 登録の途中で離脱した人（行を持たない）
        if (u.enabled === false) continue;          // 運営が無効にした人
        const t = u.createdAt instanceof Date ? u.createdAt.getTime() : Date.parse(String(u.createdAt ?? ""));
        if (!Number.isFinite(t) || t > cutoffMs) continue;
        out.push({ sub: u.sub, t });
    }
    return out.sort((a, b) => a.t - b.t).map((x) => x.sub);
}

/**
 * その行に書くか（純関数）。書くなら次の行の姿を返す。
 *
 * @returns { write: true, item, condition } | { write: false, reason }
 */
function planGrant(row, nowIso) {
    if (!row) return { write: false, reason: "プロフィールの行が無い" };
    if (typeof row.deletedAt === "string") return { write: false, reason: "退会済み" };
    const badges = row.badges && typeof row.badges === "object" && !Array.isArray(row.badges) ? row.badges : {};
    if (badges.earlyUser && badges.earlyUser.tier >= 1) return { write: false, reason: "既に付いている" };
    const rev = typeof row.rev === "number" ? row.rev : 0;
    return {
        write: true,
        rev,
        item: { ...row, badges: { ...badges, earlyUser: { tier: 1, at: nowIso } }, rev: rev + 1 },
    };
}

async function listAllUsers(cognito, poolId) {
    const { ListUsersCommand } = require("@aws-sdk/client-cognito-identity-provider");
    const users = [];
    let token;
    do {
        const res = await cognito.send(new ListUsersCommand({ UserPoolId: poolId, PaginationToken: token, Limit: 60 }));
        for (const u of res.Users ?? []) {
            const sub = (u.Attributes ?? []).find((a) => a.Name === "sub")?.Value;
            users.push({ sub, createdAt: u.UserCreateDate, status: u.UserStatus, enabled: u.Enabled });
        }
        token = res.PaginationToken;
    } while (token);
    return users;
}

async function main() {
    const { requireEnv } = require("./lib/env");
    const { CognitoIdentityProviderClient } = require("@aws-sdk/client-cognito-identity-provider");
    const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
    const { DynamoDBDocumentClient, GetCommand, PutCommand } = require("@aws-sdk/lib-dynamodb");

    const poolId = requireEnv("COGNITO_USER_POOL_ID");
    const USERS_TABLE = requireEnv("USERS_TABLE");
    const APPLY = process.argv.includes("--apply");

    const cognito = new CognitoIdentityProviderClient({ region: REGION });
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
        marshallOptions: { removeUndefinedValues: true },
    });

    const users = await listAllUsers(cognito, poolId);
    const targets = selectEarlyUsers(users);
    console.log(`Cognito の利用者 ${users.length} 人のうち、${CUTOFF_ISO} までに登録した人: ${targets.length} 人`);
    console.log(`  先頭の ${Math.min(SHOW, targets.length)} 人: ${targets.slice(0, SHOW).join(", ") || "（なし）"}`);
    if (!APPLY) {
        console.log("  （読むだけ）apply を付けて流すと、この人たちの行に初期ユーザー章を書きます。");
        return;
    }

    const now = new Date().toISOString();
    const tally = { written: 0, skipped: {}, failed: 0 };
    for (const userId of targets) {
        try {
            const row = (await ddb.send(new GetCommand({ TableName: USERS_TABLE, Key: { userId } }))).Item;
            const plan = planGrant(row, now);
            if (!plan.write) {
                tally.skipped[plan.reason] = (tally.skipped[plan.reason] ?? 0) + 1;
                continue;
            }
            await ddb.send(new PutCommand({
                TableName: USERS_TABLE,
                Item: plan.item,
                ConditionExpression: plan.rev === 0
                    ? "attribute_exists(userId) AND attribute_not_exists(deletedAt) AND (attribute_not_exists(rev) OR rev = :rev)"
                    : "attribute_exists(userId) AND attribute_not_exists(deletedAt) AND rev = :rev",
                ExpressionAttributeValues: { ":rev": plan.rev },
            }));
            tally.written++;
        } catch (e) {
            // 競合（本人が同時に保存した）は数えて先へ。流し直せば拾える（冪等）
            tally.failed++;
            console.error(`  ${userId}: 書けませんでした（${e.name}: ${e.message}）`);
        }
    }
    console.log(`書いた: ${tally.written} 人・飛ばした: ${JSON.stringify(tally.skipped)}・失敗: ${tally.failed} 人`);
    if (tally.failed > 0) console.log("  失敗した人は、もう一度流すと拾えます（付いている人は飛ばします）。");
}

module.exports = { selectEarlyUsers, planGrant, CUTOFF_ISO, CUTOFF_MS };

if (require.main === module) {
    main().catch((e) => {
        console.error(`失敗: ${e.name}: ${e.message}`);
        process.exit(1);
    });
}
