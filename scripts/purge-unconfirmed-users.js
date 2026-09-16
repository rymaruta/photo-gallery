#!/usr/bin/env node
/**
 * **確認が終わっていない（UNCONFIRMED）利用者を消す。**
 *
 * 登録の途中で離脱した人は `UNCONFIRMED` のまま残る。本人は
 * ログインできず、プロフィール行も持たない（それを作るのは
 * PostConfirmation トリガーで、確認しないと走らない）。
 *
 *   node scripts/purge-unconfirmed-users.js            # 読むだけ（誰が対象か出す）
 *   node scripts/purge-unconfirmed-users.js --apply    # 実行
 *
 * **消すのは `UNCONFIRMED` だけ。** ほかの状態は1つも触らない——とくに
 * `FORCE_CHANGE_PASSWORD` は**管理者が作ったばかりの正規の利用者**で、
 * 「まだログインしていない」だけ。ここを巻き込むと、作った当人の
 * アカウントが消える。
 *
 * **新しすぎる人は消さない**（既定7日）。確認コードの既定の寿命は24時間で、
 * **いま登録してコードを打とうとしている人**を消すと、その登録が途中で
 * 壊れる。`PURGE_OLDER_THAN_DAYS` で変えられるが、**0 にすると
 * 「1分前に登録した人」も対象になる**ことを承知で。
 *
 * **プロフィール行を持っている人は消さない。** `UNCONFIRMED` なら行は
 * 無いはずだが、**その前提が外れていたら止まる**方に倒す（消してから
 * 気づいても戻せない）。持っていたら「飛ばした」として報告する。
 */
const {
    CognitoIdentityProviderClient, ListUsersCommand, AdminDeleteUserCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const { DynamoDBClient, GetItemCommand } = require("@aws-sdk/client-dynamodb");
const { marshall } = require("@aws-sdk/util-dynamodb");
const { requireEnv } = require("./lib/env");

const TARGET_STATUS = "UNCONFIRMED";
const DEFAULT_OLDER_THAN_DAYS = 7;

/** ログに生のメールを残さない（GitHub のログは private だが、残す理由も無い） */
function maskEmail(email) {
    const s = String(email ?? "");
    const at = s.indexOf("@");
    if (at <= 0) return s ? "***" : "(なし)";
    return `${s[0]}***${s.slice(at)}`;
}

/**
 * 誰を消すかを決める（純関数・テスト可能）。
 *
 * @param users [{ username, status, createdAt(Date|string), email, hasProfile }]
 * @returns { deletable: [...], skipped: [{ username, reason }] }
 */
function planPurge({ users, olderThanDays = DEFAULT_OLDER_THAN_DAYS, now = Date.now() }) {
    const deletable = [];
    const skipped = [];
    const minAgeMs = Math.max(0, Number(olderThanDays)) * 24 * 60 * 60 * 1000;
    for (const u of users ?? []) {
        if (u.status !== TARGET_STATUS) {
            skipped.push({ username: u.username, reason: `状態が ${u.status ?? "(不明)"}（消すのは ${TARGET_STATUS} だけ）` });
            continue;
        }
        // **プロフィール行を持つなら触らない。** 前提（UNCONFIRMED は行を持たない）が
        // 外れている＝こちらの理解が間違っているということなので、止まる側に倒す
        if (u.hasProfile) {
            skipped.push({ username: u.username, reason: "プロフィール行がある（前提と違うので触らない）" });
            continue;
        }
        const created = u.createdAt instanceof Date ? u.createdAt.getTime() : Date.parse(String(u.createdAt ?? ""));
        if (!Number.isFinite(created)) {
            // 作成日時が読めない＝古いかどうか判断できない。**消さない**
            skipped.push({ username: u.username, reason: "作成日時を読めない（古いか判断できないので触らない）" });
            continue;
        }
        const ageMs = now - created;
        if (ageMs < minAgeMs) {
            const days = (ageMs / 86400000).toFixed(1);
            skipped.push({ username: u.username, reason: `登録から ${days} 日（${olderThanDays} 日未満なので触らない）` });
            continue;
        }
        deletable.push(u);
    }
    return { deletable, skipped };
}

/** そのユーザーにプロフィール行があるか（読み取り） */
async function hasProfileRow(ddb, table, userId) {
    try {
        const res = await ddb.send(new GetItemCommand({
            TableName: table,
            Key: marshall({ userId }),
            ProjectionExpression: "userId",
        }));
        return !!res.Item;
    } catch (e) {
        // **読めなかったら「ある」に倒す**（＝消さない）。読めないことを
        // 「無い」と読むと、あるものを消す方向に倒れる
        console.warn(`[purge] プロフィール行を確かめられませんでした（${userId}）: ${e.name}`);
        return true;
    }
}

async function main() {
    const apply = process.argv.includes("--apply");
    const poolId = requireEnv("COGNITO_USER_POOL_ID");
    const usersTable = requireEnv("USERS_TABLE");
    const region = process.env.AWS_REGION ?? "ap-northeast-1";
    const olderThanDays = process.env.PURGE_OLDER_THAN_DAYS !== undefined && process.env.PURGE_OLDER_THAN_DAYS !== ""
        ? Number(process.env.PURGE_OLDER_THAN_DAYS)
        : DEFAULT_OLDER_THAN_DAYS;
    if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
        console.error(`[purge] PURGE_OLDER_THAN_DAYS が数値ではありません: ${process.env.PURGE_OLDER_THAN_DAYS}`);
        process.exit(1);
    }
    const idp = new CognitoIdentityProviderClient({ region });
    const ddb = new DynamoDBClient({ region });

    console.log(`[purge] pool=${poolId} 対象=${TARGET_STATUS} / ${olderThanDays}日より古いもの ${apply ? "（実行）" : "（読むだけ。--apply で実行）"}`);

    const all = [];
    let token;
    do {
        const res = await idp.send(new ListUsersCommand({ UserPoolId: poolId, Limit: 60, PaginationToken: token }));
        for (const u of res.Users ?? []) {
            all.push({
                username: u.Username,
                status: u.UserStatus,
                createdAt: u.UserCreateDate,
                email: (u.Attributes ?? []).find((a) => a.Name === "email")?.Value,
            });
        }
        token = res.PaginationToken;
    } while (token);

    const byStatus = {};
    for (const u of all) byStatus[u.status ?? "(不明)"] = (byStatus[u.status ?? "(不明)"] ?? 0) + 1;
    console.log(`[purge] 利用者 ${all.length}人: ${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(" / ")}`);

    // プロフィール行の有無は、対象になりうる人だけ引く（全員ぶん引かない）
    for (const u of all) {
        u.hasProfile = u.status === TARGET_STATUS ? await hasProfileRow(ddb, usersTable, u.username) : false;
    }

    const plan = planPurge({ users: all, olderThanDays });
    console.log(`[purge] 消す対象: ${plan.deletable.length}人`);
    for (const u of plan.deletable) {
        console.log(`           ${u.username}  ${maskEmail(u.email)}  登録 ${u.createdAt instanceof Date ? u.createdAt.toISOString() : u.createdAt}`);
    }
    // **飛ばした理由も全部出す。** 出さないと「0人でした」が
    // 「本当に0人」なのか「全部弾いた」なのか読み手に分からない
    const notableSkips = plan.skipped.filter((s) => !s.reason.startsWith("状態が"));
    if (notableSkips.length) {
        console.log(`[purge] 飛ばした（状態が ${TARGET_STATUS} 以外を除く）: ${notableSkips.length}人`);
        for (const s of notableSkips) console.log(`           ${s.username}: ${s.reason}`);
    }

    if (!apply) {
        console.log("[purge] 読むだけで終わります（--apply で実行）");
        return;
    }
    if (plan.deletable.length === 0) {
        console.log("[purge] 消す対象がありません");
        return;
    }
    let done = 0;
    const failed = [];
    for (const u of plan.deletable) {
        try {
            await idp.send(new AdminDeleteUserCommand({ UserPoolId: poolId, Username: u.username }));
            done++;
        } catch (e) {
            failed.push(`${u.username}: ${e.name}`);
        }
    }
    console.log(`[purge] 消しました: ${done}人`);
    if (failed.length) {
        // **失敗を握らない。** 半分消えた状態を「完了」と読ませない
        console.error(`[purge] ❌ 消せなかった: ${failed.length}人`);
        for (const f of failed) console.error(`           ${f}`);
        process.exitCode = 1;
    }
}

module.exports = { planPurge, maskEmail, TARGET_STATUS, DEFAULT_OLDER_THAN_DAYS };
if (require.main === module) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
