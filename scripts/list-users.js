/**
 * list-users.js — 登録している人の一覧を、運営が状況をつかむために読むだけで出す。（2026-10-09）
 *
 *   node scripts/list-users.js      # 読むだけ（書かない）
 *
 * 出すもの（1人1行・登録の古い順）: userId の頭8桁・登録日（日本時間）・最後に Cognito 側で
 * 変わった日・状態（確認済みか）・有効か・プロフィールの行の有無・@ユーザー名・表示名・
 * 写真の枚数・最後に投稿した日・退会済みか。
 * **メールアドレスや電話番号は出さない**（ログに個人の連絡先を残さない）。
 *
 * 必要な環境変数: COGNITO_USER_POOL_ID・USERS_TABLE・PHOTOS_TABLE（`scripts/lib/env.js`）。
 */

const REGION = "ap-northeast-1";
const USER_INDEX = "userId-createdAt-index";

/** 日本時間の YYYY-MM-DD（無ければ "-"） */
function jstDate(v) {
    const t = v instanceof Date ? v.getTime() : Date.parse(String(v ?? ""));
    if (!Number.isFinite(t)) return "-";
    return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 1人分の行（純関数） */
function formatRow(u, row, photos) {
    const cells = [
        String(u.sub ?? "").slice(0, 8) || "?",
        `登録 ${jstDate(u.createdAt)}`,
        `更新 ${jstDate(u.modifiedAt)}`,
        u.status ?? "?",
        u.enabled === false ? "無効" : "有効",
        row ? (typeof row.deletedAt === "string" ? "退会済み" : "行あり") : "行なし",
        row?.username ? `@${row.username}` : "@-",
        row?.displayName || row?.name || "-",
        `写真 ${photos.count}${photos.more ? "+" : ""}枚`,
        `最後の投稿 ${photos.last ? jstDate(photos.last) : "-"}`,
    ];
    return cells.join(" | ");
}

async function main() {
    const { requireEnv } = require("./lib/env");
    const { CognitoIdentityProviderClient, ListUsersCommand } = require("@aws-sdk/client-cognito-identity-provider");
    const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
    const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");

    const poolId = requireEnv("COGNITO_USER_POOL_ID");
    const USERS_TABLE = requireEnv("USERS_TABLE");
    const PHOTOS_TABLE = requireEnv("PHOTOS_TABLE");
    const cognito = new CognitoIdentityProviderClient({ region: REGION });
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

    const users = [];
    let token;
    do {
        const res = await cognito.send(new ListUsersCommand({ UserPoolId: poolId, PaginationToken: token, Limit: 60 }));
        for (const u of res.Users ?? []) {
            const sub = (u.Attributes ?? []).find((a) => a.Name === "sub")?.Value;
            users.push({ sub, createdAt: u.UserCreateDate, modifiedAt: u.UserLastModifiedDate, status: u.UserStatus, enabled: u.Enabled });
        }
        token = res.PaginationToken;
    } while (token);
    users.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    console.log(`Cognito の利用者: ${users.length} 人（登録の古い順・メールは出しません）`);
    for (const u of users) {
        let row = null;
        let photos = { count: 0, more: false, last: null };
        if (u.sub) {
            row = (await ddb.send(new GetCommand({ TableName: USERS_TABLE, Key: { userId: u.sub } }))).Item ?? null;
            // 新しい順に最大 200 枚まで数える（それ以上は「200+」）
            const q = await ddb.send(new QueryCommand({
                TableName: PHOTOS_TABLE, IndexName: USER_INDEX,
                KeyConditionExpression: "userId = :u", ExpressionAttributeValues: { ":u": u.sub },
                ScanIndexForward: false, Limit: 200, ProjectionExpression: "createdAt",
            }));
            const items = q.Items ?? [];
            photos = { count: items.length, more: Boolean(q.LastEvaluatedKey), last: items[0]?.createdAt ?? null };
        }
        console.log("  " + formatRow(u, row, photos));
    }
}

module.exports = { formatRow, jstDate };

if (require.main === module) {
    main().catch((e) => {
        console.error(`失敗: ${e.name}: ${e.message}`);
        process.exit(1);
    });
}
