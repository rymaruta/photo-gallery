#!/usr/bin/env node
/**
 * Apple でサインイン（2026-10-21）のために、**既にあるプール**を用意する。owner が流す。
 *
 *   COGNITO_USER_POOL_ID=<id> STAGE=staging node scripts/setup-apple-signin.js          # 読むだけ
 *   COGNITO_USER_POOL_ID=<id> STAGE=staging node scripts/setup-apple-signin.js --apply  # 実行
 *
 * することは2つ（どちらも済んでいれば何もしない）:
 *
 * 1. プールに独自属性 `custom:apple_sub`（文字列・変えられる・1〜128字）を足す。
 *    ⚠️ **Cognito の独自属性は足したら消せない**（名前も型も変えられない）。
 * 2. アプリのクライアント（Web と iOS で同じもの）の `ExplicitAuthFlows` に `ALLOW_CUSTOM_AUTH` を足す。
 *    クライアントの読める属性（`ReadAttributes`）を絞っているなら `custom:apple_sub` も足す
 *    （ID トークンに入らないと、退会の取り消しの口が「Apple の人ではない」と断る）。
 *
 * 🔴 **`UpdateUserPoolClient` は渡さなかった項目を既定値に戻す**（AWS の仕様。`UpdateUserPool` と同じ）。
 * `DescribeUserPoolClient` の中身を丸ごと送り返し、読み直して**狙った2項目以外が1つも変わっていない**
 * ことまで確かめる（`attach-post-confirmation.js` と同じ作法）。
 *
 * カスタム認証を許しても、パスワードの利用者がこの道で入ることはできない（`api/src/appleChallenge.ts`
 * の Define が `custom:apple_sub` の無い人を断る）。
 *
 * 書き込める属性（`WriteAttributes`）は**変えない**（2026-10-21 判断）。利用者が自分の
 * `custom:apple_sub` を書き換えても、他人のアカウントには入れない（Apple のトークンの sub と一致しないと
 * 通らない）ので害は自分のアカウントのつなぎが外れるだけ。絞り直すと、Web とアプリが書いている属性を
 * 列挙し損ねたときにメールの変更などが壊れる方が怖い。
 */
const {
    AddCustomAttributesCommand, CognitoIdentityProviderClient, DescribeUserPoolClientCommand,
    DescribeUserPoolCommand, ListUserPoolClientsCommand, UpdateUserPoolClientCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const { requireEnv } = require("./lib/env");

const ATTR = "apple_sub";
const ATTR_FULL = `custom:${ATTR}`;
const FLOW = "ALLOW_CUSTOM_AUTH";

/** `UpdateUserPoolClient` が受け取る項目（AWS の API の一覧。これ以外は送らない） */
const CLIENT_WRITABLE = [
    "ClientName", "RefreshTokenValidity", "AccessTokenValidity", "IdTokenValidity", "TokenValidityUnits",
    "ReadAttributes", "WriteAttributes", "ExplicitAuthFlows", "SupportedIdentityProviders", "CallbackURLs",
    "LogoutURLs", "DefaultRedirectURI", "AllowedOAuthFlows", "AllowedOAuthScopes", "AllowedOAuthFlowsUserPoolClient",
    "AnalyticsConfiguration", "PreventUserExistenceErrors", "EnableTokenRevocation",
    "EnablePropagateAdditionalUserContextData", "AuthSessionValidity", "RefreshTokenRotation",
];

/** プールに属性があるか（純関数） */
function hasAppleAttribute(userPool) {
    return (userPool?.SchemaAttributes ?? []).some((a) => a.Name === ATTR_FULL);
}

/**
 * クライアントの更新の本文と、変える項目を決める（純関数・テスト可能）。
 * @returns { params, changes: string[] }  changes が空なら何もしない
 */
function planClientUpdate(client) {
    const params = { UserPoolId: client.UserPoolId, ClientId: client.ClientId };
    for (const k of CLIENT_WRITABLE) if (client[k] !== undefined) params[k] = client[k];
    const changes = [];
    const flows = client.ExplicitAuthFlows ?? [];
    if (!flows.includes(FLOW)) {
        params.ExplicitAuthFlows = [...flows, FLOW];
        changes.push("ExplicitAuthFlows");
    }
    // 空・無し＝全部読める（足さない）。絞っているときだけ足す
    const read = client.ReadAttributes ?? [];
    if (read.length > 0 && !read.includes(ATTR_FULL)) {
        params.ReadAttributes = [...read, ATTR_FULL];
        changes.push("ReadAttributes");
    }
    return { params, changes };
}

/** 更新の前後で、狙った項目以外に変わったもの（純関数） */
function unexpectedClientChanges(before, after, intended) {
    const skip = new Set(["LastModifiedDate", ...intended]);
    const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
    return [...keys].filter((k) => !skip.has(k) && JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])).sort();
}

function poolNameForStage(stage) {
    return `${stage}-journey-photo-client-spa`;
}

async function main() {
    const apply = process.argv.includes("--apply");
    const poolId = requireEnv("COGNITO_USER_POOL_ID");
    const stage = requireEnv("STAGE", "prod か staging。プール名と一致しなければ止まる");
    const idp = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
    console.log(`[apple] pool=${poolId} ${apply ? "（実行）" : "（読むだけ。--apply で実行）"}`);

    const pool = (await idp.send(new DescribeUserPoolCommand({ UserPoolId: poolId }))).UserPool;
    if (!pool) throw new Error(`プール ${poolId} を読めませんでした`);
    if (pool.Name !== poolNameForStage(stage)) {
        throw new Error(`プール ${poolId} の名前は ${pool.Name} で、STAGE=${stage} の ${poolNameForStage(stage)} と合いません`);
    }

    // 1. 属性
    if (hasAppleAttribute(pool)) {
        console.log(`[apple] 属性 ${ATTR_FULL}: 既にあります`);
    } else {
        console.log(`[apple] 属性 ${ATTR_FULL}: 足します（⚠️ 足したら消せません）`);
        if (apply) {
            await idp.send(new AddCustomAttributesCommand({
                UserPoolId: poolId,
                CustomAttributes: [{
                    Name: ATTR, AttributeDataType: "String", Mutable: true,
                    StringAttributeConstraints: { MinLength: "1", MaxLength: "128" },
                }],
            }));
            console.log("[apple] 属性を足しました");
        }
    }

    // 2. クライアント（名前がプールと同じもの＝provision-env.js が作る形。本番は手で作ったので全部見る）
    const list = await idp.send(new ListUserPoolClientsCommand({ UserPoolId: poolId, MaxResults: 60 }));
    const clients = list.UserPoolClients ?? [];
    if (clients.length === 0) throw new Error("アプリのクライアントがありません");
    for (const c of clients) {
        const client = (await idp.send(new DescribeUserPoolClientCommand({ UserPoolId: poolId, ClientId: c.ClientId }))).UserPoolClient;
        const { params, changes } = planClientUpdate(client);
        console.log(`[apple] クライアント ${client.ClientName}（${client.ClientId}）: ${changes.length ? `変える ${changes.join(", ")}` : "何もしない"}`);
        if (!client.WriteAttributes?.length || client.WriteAttributes.includes(ATTR_FULL)) {
            console.log(`[apple]   （${ATTR_FULL} は利用者が自分で書けます。害は小さいので変えません・冒頭の注記）`);
        }
        if (!apply || changes.length === 0) continue;
        await idp.send(new UpdateUserPoolClientCommand(params));
        const after = (await idp.send(new DescribeUserPoolClientCommand({ UserPoolId: poolId, ClientId: c.ClientId }))).UserPoolClient;
        const unexpected = unexpectedClientChanges(client, after, changes);
        if (unexpected.length) {
            console.error(`[apple] ❌ 狙っていない項目が変わりました: ${unexpected.join(", ")}`);
            for (const k of unexpected) console.error(`[apple]    ${k}: ${JSON.stringify(client[k])} → ${JSON.stringify(after[k])}`);
            process.exitCode = 1;
            return;
        }
        console.log("[apple]   変えました（読み直して確認済み・ほかの項目は変わっていない）");
    }
    if (!apply) console.log("[apple] 読むだけで終わります（--apply で実行）");
}

module.exports = { hasAppleAttribute, planClientUpdate, unexpectedClientChanges, poolNameForStage, CLIENT_WRITABLE, ATTR_FULL, FLOW };
if (require.main === module) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
