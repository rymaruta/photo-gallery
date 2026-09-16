#!/usr/bin/env node
/**
 * プールに PostConfirmation トリガーを**プール ID を指名して**付け直す。
 *
 * 新規登録した人を `user` グループとプロフィール行に入れるのはこのトリガー
 * だけ。本番の `diagnose`（2026-09-16）で**プールにトリガーが付いていない**
 * と出た——グループはあり、関数もあるのに、Cognito が呼ぶ相手を知らない。
 *
 * 「api を再デプロイすれば付く」は**当てにならない**:
 *   - トリガーを付けるのは serverless の `Custom::CognitoUserPool`
 *     （`existing: true`）で、CloudFormation のカスタムリソースは
 *     **プロパティが変わったときしか走らない**。コードを直しただけの
 *     デプロイでは Update イベントが起きず、プールには触らない
 *   - 走ったとしても相手は**名前で探す**（`ListUserPools` の先頭一致）。
 *     同じ名前のプールが2つあれば、先に見つかった方に付ける
 *   - Cognito からの呼び出し許可（`lambda:AddPermission`）も同じ
 *     カスタムリソースが `SourceArn=そのプール` で付けるので、
 *     別のプールに付いていれば、こちらのプールからは呼べない
 *
 * だからここでは ID で指名し、**トリガーと呼び出し許可の両方**を揃える。
 *
 *   node scripts/attach-post-confirmation.js            # 読むだけ（何をするか出す）
 *   node scripts/attach-post-confirmation.js --apply    # 実行
 *
 * `UpdateUserPool` は**渡さなかった項目を既定値に戻す**（AWS の仕様）。
 * ここは serverless の `getUpdateConfigFromCurrentSetup` と同じ手順で
 * `DescribeUserPool` の中身を丸ごと送り返し、読み取り専用の項目だけ落とす。
 * トリガー以外は1つも変えない。
 */
const {
    CognitoIdentityProviderClient, DescribeUserPoolCommand, ListUserPoolsCommand, UpdateUserPoolCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const {
    LambdaClient, GetFunctionConfigurationCommand, GetPolicyCommand, AddPermissionCommand,
} = require("@aws-sdk/client-lambda");
const { requireEnv } = require("./lib/env");

const TRIGGER = "PostConfirmation";

function expectedFunctionName(stage) {
    return `photo-gallery-api-${stage}-postConfirmation`;
}

/**
 * DescribeUserPool が返すが UpdateUserPool には渡せない項目。
 * serverless v3（`custom-resources/.../user-pool.js`）の一覧をそのまま。
 */
const READ_ONLY = [
    "Id", "Name", "Status", "LastModifiedDate", "CreationDate", "SchemaAttributes",
    "AliasAttributes", "UsernameAttributes", "EstimatedNumberOfUsers",
    "SmsConfigurationFailure", "EmailConfigurationFailure", "Domain", "CustomDomain",
    "UsernameConfiguration", "Arn",
];

/**
 * 何をするかを決める（純関数・テスト可能）。
 *
 * @returns { action: "none" | "attach" | "replace", warnings: string[] }
 */
function planAttach({ attachedArn, expectedArn, sameNamePoolIds }) {
    const warnings = [];
    if (sameNamePoolIds.length > 1) {
        warnings.push(
            `同じ名前のプールが ${sameNamePoolIds.length} 個ある（${sameNamePoolIds.join(", ")}）。`
            + " api のデプロイ（カスタムリソース）は名前で探して最初の1つに付けるので、"
            + " 次にそれが走ると別のプールへ付き直す可能性がある",
        );
    }
    if (attachedArn === expectedArn) return { action: "none", warnings };
    if (!attachedArn) return { action: "attach", warnings };
    return { action: "replace", warnings };
}

/**
 * UpdateUserPool に渡す本文を組む（純関数・テスト可能）。
 *
 * DescribeUserPool の `UserPool` を丸ごと写し、読み取り専用の項目を落とし、
 * `LambdaConfig` の PostConfirmation だけ差し替える。**他のトリガーは残す。**
 *
 * `UnusedAccountValidityDays`（旧）と `TemporaryPasswordValidityDays`（新）は
 * 両方送ると API が断るので、旧が返ってきたときだけ新へ写して旧を落とす
 * （serverless と同じ。無いときは触らない——`undefined` を書くと既定値に戻る）。
 */
function buildUpdateParams(userPool, expectedArn) {
    const p = { ...userPool };
    for (const k of READ_ONLY) delete p[k];
    const admin = { ...(p.AdminCreateUserConfig ?? {}) };
    if (admin.UnusedAccountValidityDays !== undefined) {
        const policies = { ...(p.Policies ?? {}) };
        policies.PasswordPolicy = { ...(policies.PasswordPolicy ?? {}), TemporaryPasswordValidityDays: admin.UnusedAccountValidityDays };
        p.Policies = policies;
        delete admin.UnusedAccountValidityDays;
        p.AdminCreateUserConfig = admin;
    }
    p.LambdaConfig = { ...(userPool.LambdaConfig ?? {}), [TRIGGER]: expectedArn };
    p.UserPoolId = userPool.Id;
    return p;
}

/**
 * 関数のリソースポリシーが「このプールからの Cognito の呼び出し」を通すか
 * （純関数・テスト可能）。SourceArn の条件が無い文も通す（広い側）。
 */
function policyAllowsPool(policyDoc, poolArn) {
    return (policyDoc?.Statement ?? []).some((st) => {
        if (st.Effect !== "Allow") return false;
        if (!String(st.Principal?.Service ?? "").includes("cognito-idp.amazonaws.com")) return false;
        if (!String(st.Action).includes("InvokeFunction")) return false;
        const src = st.Condition?.ArnLike?.["AWS:SourceArn"] ?? st.Condition?.ArnEquals?.["AWS:SourceArn"];
        return src === undefined || src === poolArn;
    });
}

async function listPoolsNamed(idp, name) {
    const ids = [];
    let token;
    do {
        const res = await idp.send(new ListUserPoolsCommand({ MaxResults: 60, NextToken: token }));
        for (const p of res.UserPools ?? []) if (p.Name === name) ids.push(p.Id);
        token = res.NextToken;
    } while (token);
    return ids;
}

async function main() {
    const apply = process.argv.includes("--apply");
    const poolId = requireEnv("COGNITO_USER_POOL_ID");
    const stage = process.env.STAGE || "prod";
    const region = process.env.AWS_REGION ?? "ap-northeast-1";
    const idp = new CognitoIdentityProviderClient({ region });
    const lambda = new LambdaClient({ region });
    const fnName = expectedFunctionName(stage);

    console.log(`[attach] pool=${poolId} function=${fnName} ${apply ? "（実行）" : "（読むだけ。--apply で実行）"}`);

    const pool = (await idp.send(new DescribeUserPoolCommand({ UserPoolId: poolId }))).UserPool;
    if (!pool) throw new Error(`プール ${poolId} を読めませんでした`);
    const attachedArn = pool.LambdaConfig?.[TRIGGER] ?? "";
    const sameNamePoolIds = await listPoolsNamed(idp, pool.Name);

    let expectedArn;
    try {
        expectedArn = (await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: fnName }))).FunctionArn;
    } catch (e) {
        if (e.name === "ResourceNotFoundException") {
            throw new Error(`関数 ${fnName} がありません。先に api をデプロイしてください（deploy-api.yml）`);
        }
        throw e;
    }

    let policyOk = false;
    try {
        const res = await lambda.send(new GetPolicyCommand({ FunctionName: fnName }));
        policyOk = policyAllowsPool(JSON.parse(res.Policy ?? "{}"), pool.Arn);
    } catch (e) {
        if (e.name !== "ResourceNotFoundException") throw e;   // ポリシーが無い＝誰も呼べない
    }

    const plan = planAttach({ attachedArn, expectedArn, sameNamePoolIds });
    console.log(`[attach] プール名: ${pool.Name} / いま付いている ${TRIGGER}: ${attachedArn || "（無し）"}`);
    console.log(`[attach] 期待する関数: ${expectedArn}`);
    console.log(`[attach] Cognito からこの関数を呼べる許可（SourceArn=このプール）: ${policyOk ? "あり" : "**無し**"}`);
    for (const w of plan.warnings) console.log(`[attach] ⚠️ ${w}`);
    const label = { none: "何もしない（既に付いている）", attach: "付ける", replace: "別の関数から付け替える" }[plan.action];
    console.log(`[attach] トリガー: ${label}`);
    console.log(`[attach] 呼び出し許可: ${policyOk ? "何もしない" : "付ける"}`);

    if (!apply) {
        console.log("[attach] 読むだけで終わります（--apply で実行）");
        return;
    }
    if (!policyOk) {
        await lambda.send(new AddPermissionCommand({
            Action: "lambda:InvokeFunction",
            FunctionName: fnName,
            Principal: "cognito-idp.amazonaws.com",
            // カスタムリソースの StatementId（<関数名>-<プール名>）とは別の名前にする。
            // 同じだと、あちらが RemovePermission したときにこちらまで消える
            StatementId: `cognito-${poolId}`.replace(/[^A-Za-z0-9_-]/g, "-"),
            SourceArn: pool.Arn,
        }));
        console.log("[attach] 呼び出し許可を付けました");
    }
    if (plan.action !== "none") {
        await idp.send(new UpdateUserPoolCommand(buildUpdateParams(pool, expectedArn)));
        const after = (await idp.send(new DescribeUserPoolCommand({ UserPoolId: poolId }))).UserPool?.LambdaConfig?.[TRIGGER];
        if (after !== expectedArn) throw new Error(`付けたあとに読み直したら ${TRIGGER}=${after ?? "（無し）"} でした`);
        console.log(`[attach] ${TRIGGER} を付けました（読み直して確認済み）`);
    }
    console.log("[attach] 完了。次に新規登録した人から user グループとプロフィール行に入ります");
}

module.exports = { planAttach, buildUpdateParams, policyAllowsPool, expectedFunctionName, READ_ONLY, TRIGGER };
if (require.main === module) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
