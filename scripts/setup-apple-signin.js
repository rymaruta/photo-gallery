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
 * 3. 🔴 **利用者が `custom:apple_sub` を書けないようにする**（`WriteAttributes`・2026-10-21 の見直し）。
 *    書けるままだと、一時的にログインを奪った人が**自分の Apple の sub を書き込み、裏口として残せる**
 *    （パスワードを変えても消えない）。サーバーは Admin の API で書くので、クライアントの許可は要らない。
 *    - いま一覧を持っている（絞っている）なら、そこから `custom:apple_sub` だけを外す（ほかは残す）
 *    - 一覧が無い（＝全部書ける）なら、**アプリが実際に書く属性だけ**の一覧にする: `APP_WRITES`
 *      （Web の登録とメールの変更・`lib/auth/cognito.ts`、iOS の登録・`AuthGateway.signUp` が書くのは
 *      `email` だけ）。プールの必須の属性があれば足す（登録で要る）
 *    前の一覧は画面に出す（戻すときに使う）。
 */
const {
    AddCustomAttributesCommand, CognitoIdentityProviderClient, DescribeUserPoolClientCommand,
    DescribeUserPoolCommand, ListUserPoolClientsCommand, UpdateUserPoolClientCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const { requireEnv } = require("./lib/env");

const ATTR = "apple_sub";
const ATTR_FULL = `custom:${ATTR}`;
const FLOW = "ALLOW_CUSTOM_AUTH";
/** アプリ（Web・iOS）が利用者の鍵で書く属性。増やした日はここにも足す */
const APP_WRITES = ["email"];

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
function planClientUpdate(client, userPool = {}) {
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
    // 書ける属性から custom:apple_sub を外す（裏口にさせない）
    const write = client.WriteAttributes ?? [];
    const required = (userPool.SchemaAttributes ?? []).filter((a) => a.Required).map((a) => a.Name);
    const nextWrite = write.length > 0
        ? write.filter((a) => a !== ATTR_FULL)
        : [...new Set([...APP_WRITES, ...required])].filter((a) => a !== ATTR_FULL);
    if (JSON.stringify(nextWrite) !== JSON.stringify(write)) {
        params.WriteAttributes = nextWrite;
        changes.push("WriteAttributes");
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
        const { params, changes } = planClientUpdate(client, pool);
        console.log(`[apple] クライアント ${client.ClientName}（${client.ClientId}）: ${changes.length ? `変える ${changes.join(", ")}` : "何もしない"}`);
        if (changes.includes("WriteAttributes")) {
            console.log(`[apple]   書ける属性: ${client.WriteAttributes?.length ? JSON.stringify(client.WriteAttributes) : "（一覧なし＝全部）"} → ${JSON.stringify(params.WriteAttributes)}`);
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

module.exports = { APP_WRITES, hasAppleAttribute, planClientUpdate, unexpectedClientChanges, poolNameForStage, CLIENT_WRITABLE, ATTR_FULL, FLOW };
if (require.main === module) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
