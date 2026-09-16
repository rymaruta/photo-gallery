#!/usr/bin/env node
/**
 * 登録は済んでいるのに `user` グループに入っていない人を入れ直す。
 *
 * 投稿・編集・下書きの入口は `cognito:groups` に `user` があるかで通す。
 * 入れるのは PostConfirmation トリガーだが、**そこは失敗しても握って先へ進む**
 * （投げると登録ごと失敗し、本人に復旧手段が無くなる）。プールに `user`
 * グループが無かった期間に登録した人は、**ログインできるのに投稿だけ永久に
 * 開けない**まま残る。トリガーはもう発火しないので、ここで入れ直す。
 *
 *   node scripts/repair-user-groups.js            # 読むだけ（何をするか出す）
 *   node scripts/repair-user-groups.js --apply    # 実行
 *
 * - `user` グループが無ければ作る（`admin` は作らないし触らない）
 * - 入れるのは CONFIRMED の人だけ。既に入っている人・admin の人は触らない
 * - 入れたあと、本人は**一度ログインし直す**必要がある（グループがトークンに
 *   載るのはログイン時）
 */
const {
    CognitoIdentityProviderClient, ListGroupsCommand, CreateGroupCommand,
    ListUsersCommand, ListUsersInGroupCommand, AdminAddUserToGroupCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const { requireEnv } = require("./lib/env");

const USER_GROUP = "user";

/**
 * 何をするかを決める（純関数・テスト可能）。
 * @returns { createGroup: boolean, add: string[] }
 */
function planRepair({ groups, confirmed, inGroup, admins }) {
    const adminSet = new Set(admins ?? []);
    const inSet = new Set(inGroup);
    return {
        createGroup: !groups.includes(USER_GROUP),
        // admin の人は user に入れない（権限の判定は排他。混ぜる理由が無い）
        add: confirmed.filter((u) => !inSet.has(u) && !adminSet.has(u)),
    };
}

async function listAll(idp, make, pick, tokenKey) {
    const out = [];
    let token;
    do {
        const res = await idp.send(make(token));
        out.push(...pick(res));
        token = res[tokenKey];
    } while (token);
    return out;
}

async function main() {
    const apply = process.argv.includes("--apply");
    const poolId = requireEnv("COGNITO_USER_POOL_ID");
    const region = process.env.AWS_REGION ?? "ap-northeast-1";
    const idp = new CognitoIdentityProviderClient({ region });

    console.log(`[repair] pool=${poolId} ${apply ? "（実行）" : "（読むだけ。--apply で実行）"}`);

    const groups = (await idp.send(new ListGroupsCommand({ UserPoolId: poolId, Limit: 60 }))).Groups?.map((g) => g.GroupName) ?? [];
    const confirmed = await listAll(idp,
        (t) => new ListUsersCommand({ UserPoolId: poolId, Limit: 60, PaginationToken: t }),
        (r) => (r.Users ?? []).filter((u) => u.UserStatus === "CONFIRMED").map((u) => u.Username),
        "PaginationToken");
    const inGroup = groups.includes(USER_GROUP)
        ? await listAll(idp,
            (t) => new ListUsersInGroupCommand({ UserPoolId: poolId, GroupName: USER_GROUP, Limit: 60, NextToken: t }),
            (r) => (r.Users ?? []).map((u) => u.Username), "NextToken")
        : [];
    const admins = groups.includes("admin")
        ? await listAll(idp,
            (t) => new ListUsersInGroupCommand({ UserPoolId: poolId, GroupName: "admin", Limit: 60, NextToken: t }),
            (r) => (r.Users ?? []).map((u) => u.Username), "NextToken")
        : [];

    const plan = planRepair({ groups, confirmed, inGroup, admins });
    console.log(`[repair] グループ: ${groups.join(", ") || "（無し）"} / 確認済み ${confirmed.length}人 / user ${inGroup.length}人 / admin ${admins.length}人`);
    console.log(`[repair] user グループを作る: ${plan.createGroup ? "はい" : "いいえ（既にある）"}`);
    console.log(`[repair] 入れ直す人: ${plan.add.length}人`);
    for (const u of plan.add) console.log(`           ${u}`);

    if (!apply) {
        console.log("[repair] 読むだけで終わります（--apply で実行）");
        return;
    }
    if (plan.createGroup) {
        await idp.send(new CreateGroupCommand({ UserPoolId: poolId, GroupName: USER_GROUP, Description: "写真の投稿・編集ができる利用者" }));
        console.log("[repair] user グループを作りました");
    }
    let done = 0;
    for (const u of plan.add) {
        await idp.send(new AdminAddUserToGroupCommand({ UserPoolId: poolId, Username: u, GroupName: USER_GROUP }));
        done++;
    }
    console.log(`[repair] 入れ直しました: ${done}人（本人は一度ログインし直すと投稿できます）`);
}

module.exports = { planRepair, USER_GROUP };
if (require.main === module) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
