#!/usr/bin/env node
/**
 * 本番の設定を**読むだけ**の診断。
 *
 * 台帳に「要 AWS」として溜まっていた確認を1回で済ませる。作業環境からは
 * AWS を叩けない（資格情報がプレースホルダで `sts:GetCallerIdentity` が
 * `InvalidClientTokenId`）ので、資格情報を持つ CI から読む。
 *
 * **書き込みはしない。** 呼ぶのは Describe / Scan(COUNT) / Get だけ。
 * 直す判断の材料を集めるのが目的で、直すのは別の作業。
 */
const { DynamoDBClient, DescribeTableCommand, ScanCommand } = require("@aws-sdk/client-dynamodb");
const { CognitoIdentityProviderClient, DescribeUserPoolCommand, DescribeUserPoolClientCommand,
    ListGroupsCommand, ListUsersCommand, ListUsersInGroupCommand } = require("@aws-sdk/client-cognito-identity-provider");
const { CloudFrontClient, GetDistributionConfigCommand, GetCachePolicyCommand, ListInvalidationsCommand, GetInvalidationCommand } = require("@aws-sdk/client-cloudfront");
const { LambdaClient, ListFunctionsCommand, GetAccountSettingsCommand, GetFunctionConfigurationCommand, GetPolicyCommand } = require("@aws-sdk/client-lambda");
const { requireEnv } = require("./lib/env");
// 「Cognito から呼べるか」は SourceArn まで見る。付け直す道具と同じ判定を使う
// （別プールに付いた許可を「呼べる」と読まないため）
const { policyAllowsPool, expectedFunctionName } = require("./attach-post-confirmation");

const REGION = process.env.AWS_REGION || "ap-northeast-1";
// **`require` しただけでは何も起きないようにする。** トップレベルで
// `requireEnv` を呼ぶと、読み込んだだけでプロセスが止まる
// （`prepare-static-build.js` が同じ理由で `main()` の中に寄せてある）。
let PHOTOS_TABLE = "";

/**
 * アップロードした実体に付ける `Cache-Control` の秒数。
 * **`api-user/src/upload.ts` と `api/src/upload.ts` の二重管理**なので、
 * ずれたら `diagnoseCdnTtl.test.ts` が落ちる（両方のソースを読んで突き合わせる）。
 */
const UPLOAD_MAX_AGE = 31536000;

const ddb = new DynamoDBClient({ region: REGION });
const idp = new CognitoIdentityProviderClient({ region: REGION });
const cf = new CloudFrontClient({ region: REGION });
const lambda = new LambdaClient({ region: REGION });

const line = (s) => console.log(s);
const head = (s) => console.log(`\n=== ${s} ===`);

/** 索引の名前と射影（GSI-PROJ / LEFT-5 の判断材料） */
async function indexes() {
    head("DynamoDB の索引");
    const res = await ddb.send(new DescribeTableCommand({ TableName: PHOTOS_TABLE }));
    const gsis = res.Table?.GlobalSecondaryIndexes ?? [];
    if (gsis.length === 0) { line("  GSI はありません"); return; }
    for (const g of gsis) {
        const p = g.Projection ?? {};
        line(`  ${g.IndexName}: ${p.ProjectionType}${p.NonKeyAttributes ? ` [${p.NonKeyAttributes.join(", ")}]` : ""} (${g.IndexStatus})`);
    }
    line("  ※ storyFeed-expiresAt-index があれば、ストーリーの掃除間隔を詰められる（LEFT-5）");
}

/** 実データの形（LIST-13 と、GSI から落ちる古い行） */
async function dataShapes() {
    head("実データの形（件数だけ）");
    const count = async (label, params) => {
        let total = 0, key;
        do {
            const res = await ddb.send(new ScanCommand({ TableName: PHOTOS_TABLE, Select: "COUNT", ExclusiveStartKey: key, ...params }));
            total += res.Count ?? 0;
            key = res.LastEvaluatedKey;
        } while (key);
        line(`  ${label}: ${total}`);
    };
    await count("写真の行（src を持つ）", { FilterExpression: "attribute_exists(src)" });
    await count("`Z` 形式の date（LIST-13）", {
        FilterExpression: "contains(#d, :z)",
        ExpressionAttributeNames: { "#d": "date" },
        ExpressionAttributeValues: { ":z": { S: "Z" } },
    });
    // **索引に載らない行を両方数える。** `userId-createdAt-index` は
    // **両方のキーが揃った項目しか載せない**ので、どちらが欠けても
    // 同じ「索引を引く経路から丸ごと消える」になる。効くのは表示だけでなく
    // **退会の掃除**——`deleteAccount` はこの索引の Query だけで消す対象を
    // 列挙するので、載らない行は消えないまま 200 が返り、Cognito の
    // アカウントだけ消える（本人はもう二度と消せない）。
    await count("createdAt を持たない写真（GSI から落ちる）", {
        FilterExpression: "attribute_exists(src) AND attribute_not_exists(createdAt)",
    });
    // **`uploadedBy` の有無で絞らない。** 落ちる条件は「`userId` が無い」
    // ことであって「`uploadedBy` を持つ」ことではない。管理APIの古い口は
    // `uploadedBy` を書かなかった（`api/src/upload.ts` の履歴）ので、
    // **どちらも持たない行**が最初期にありうる——絞ると 0件 と報告して
    // 「無い」と読ませてしまう
    await count("userId を持たない写真（GSI から落ちる・退会でも消えない）", {
        FilterExpression: "attribute_exists(src) AND attribute_not_exists(userId)",
    });
    // 地図ページ（/map）の材料。位置情報を持つ公開写真が無ければ地図は空
    await count("位置情報（coords）を持つ写真", {
        FilterExpression: "attribute_exists(src) AND attribute_exists(coords)",
    });
    await count("撮影地名（location）を持つ写真（地名→座標の補填の材料）", {
        FilterExpression: "attribute_exists(src) AND attribute_exists(#loc) AND attribute_not_exists(coords)",
        ExpressionAttributeNames: { "#loc": "location" },
    });
    await count("うち公開中（published が false でない）", {
        FilterExpression: "attribute_exists(src) AND attribute_exists(coords) AND (attribute_not_exists(published) OR published <> :f)",
        ExpressionAttributeValues: { ":f": { BOOL: false } },
    });
}

/** アカウント列挙の設定（A-5） */
async function cognito() {
    head("Cognito（A-5: アカウントの有無を教えないか）");
    const poolId = process.env.COGNITO_USER_POOL_ID;
    const clientId = process.env.COGNITO_CLIENT_ID;
    if (!poolId || !clientId) { line("  COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID が未設定のため飛ばします"); return; }
    const pool = await idp.send(new DescribeUserPoolCommand({ UserPoolId: poolId }));
    const p = pool.UserPool ?? {};
    line(`  プール: ${p.Name} / AliasAttributes=${JSON.stringify(p.AliasAttributes ?? null)} UsernameAttributes=${JSON.stringify(p.UsernameAttributes ?? null)}`);
    const c = await idp.send(new DescribeUserPoolClientCommand({ UserPoolId: poolId, ClientId: clientId }));
    const prevent = c.UserPoolClient?.PreventUserExistenceErrors ?? "(未設定=LEGACY)";
    line(`  PreventUserExistenceErrors: ${prevent}`);
    if (prevent !== "ENABLED") {
        line("  → LEGACY のままだと、存在しないメールに UserNotFoundException が返る（画面側は塞いである）");
        line("     直すコマンド: aws cognito-idp update-user-pool-client \\");
        line(`       --user-pool-id ${poolId} --client-id ${clientId} --prevent-user-existence-errors ENABLED`);
    }
}

/**
 * **新規登録した人が投稿できない、を切り分ける。**
 *
 * 投稿系のページ（アップロード・編集・下書き）は `useMemberGate` が
 * `cognito:groups` に `user` か `admin` があるかで通す。グループは
 * PostConfirmation トリガー（`api/src/cognitoTrigger.ts`）が
 * `AdminAddUserToGroup` で入れるが、**そこは失敗しても握って先へ進む**
 * ——登録そのものを失敗させない方が軽いという判断で、意図的。
 *
 * その結果、**グループだけ入らなかった人は「ログインできるのに投稿だけ
 * 永久に開けない」**状態になる（再ログインでも直らない。Cognito 側に
 * 無いので）。落ちる理由は2つしかない:
 *
 *   1. プールに `user` グループが無い → ResourceNotFoundException
 *   2. トリガーのロールに権限が無い → AccessDenied
 *
 * どちらかはログを見ないと分からないが、**結果（誰がグループに居ないか）は
 * ここで数えられる**。1なら「グループが1つも無い」と出るし、2なら
 * 「グループはあるのに誰も入っていない」と出る。
 */
/**
 * 出た行を組み立てる（純関数・テスト可能）。
 *
 * **診断は「0件」と言うときがいちばん危ない。** 数え方を間違えると
 * 「問題なし」に見えるので、組み立てだけ切り出して直接見る
 * （`cdnLines` / `reportFunctions` と同じ判断）。
 */
function userGroupLines({ groups, confirmed, inGroup, poolId }) {
    const out = [];
    out.push(`  グループ: ${groups.length ? groups.join(", ") : "**1つも無い**"}`);
    if (!groups.includes("user")) {
        out.push("  ❌ `user` グループがありません。トリガーの AdminAddUserToGroup は必ず失敗します");
        out.push("     → 新規登録した人は全員、投稿・編集・下書きを開けません");
        out.push(`     直すコマンド: aws cognito-idp create-group --user-pool-id ${poolId} --group-name user`);
        return out;
    }
    const missing = confirmed.filter((u) => !inGroup.includes(u));
    out.push(`  確認済みの利用者: ${confirmed.length}人 / \`user\` グループ: ${inGroup.length}人`);
    if (missing.length === 0) {
        out.push("  ✅ 全員がグループに入っています（投稿できない原因は別）");
        return out;
    }
    out.push(`  ❌ グループに入っていない人: ${missing.length}人`);
    out.push("     この人たちは**ログインできるのに投稿・編集・下書きが永久に開けません**");
    out.push("     （再ログインでも直りません。Cognito 側に無いため）");
    for (const u of missing.slice(0, 10)) {
        out.push(`       ${u}`);
        out.push(`         aws cognito-idp admin-add-user-to-group --user-pool-id ${poolId} --username ${u} --group-name user`);
    }
    if (missing.length > 10) out.push(`       …ほか ${missing.length - 10}人`);
    return out;
}

async function userGroups() {
    head("Cognito のグループ（新規登録した人が投稿できるか）");
    const poolId = process.env.COGNITO_USER_POOL_ID;
    if (!poolId) { line("  COGNITO_USER_POOL_ID が未設定のため飛ばします"); return; }

    let groups;
    try {
        const res = await idp.send(new ListGroupsCommand({ UserPoolId: poolId, Limit: 60 }));
        groups = (res.Groups ?? []).map((g) => g.GroupName);
    } catch (e) {
        line(`  グループ一覧を読めませんでした（${e.name}）。この鍵に cognito-idp:ListGroups がありません`);
        line("  → **確認できていません**。AWS コンソール（Cognito → ユーザープール → グループ）で見てください");
        return;
    }
    if (!groups.includes("user")) {
        for (const l of userGroupLines({ groups, confirmed: [], inGroup: [], poolId })) line(l);
        return;
    }

    const confirmed = [];
    try {
        let token;
        do {
            const res = await idp.send(new ListUsersCommand({ UserPoolId: poolId, Limit: 60, PaginationToken: token }));
            for (const u of res.Users ?? []) if (u.UserStatus === "CONFIRMED") confirmed.push(u.Username);
            token = res.PaginationToken;
        } while (token);
    } catch (e) {
        line(`  利用者を数えられませんでした（${e.name}）。この鍵に cognito-idp:ListUsers がありません`);
        line("  → **確認できていません**");
        return;
    }

    const inGroup = [];
    try {
        let token;
        do {
            const res = await idp.send(new ListUsersInGroupCommand({ UserPoolId: poolId, GroupName: "user", Limit: 60, NextToken: token }));
            for (const u of res.Users ?? []) inGroup.push(u.Username);
            token = res.NextToken;
        } while (token);
    } catch (e) {
        line(`  グループの中を読めませんでした（${e.name}）`);
        line("  → **確認できていません**");
        return;
    }

    for (const l of userGroupLines({ groups, confirmed, inGroup, poolId })) line(l);
}

/**
 * PostConfirmation トリガーが**本当に走る状態か**の行（純関数・テスト可能）。
 *
 * 本番の診断（run 52）で「`user` グループは在るのに 5人中4人が入っていない・
 * プロフィール行は2人ぶんしか無い」と出た。プロフィール行はトリガーが作るので、
 * **少なくとも3人はトリガーが走ってすらいない**。走らない理由は3つに絞れる:
 *
 *   1. プールにトリガーが付いていない（LambdaConfig.PostConfirmation が空）
 *   2. 付いているが**別の関数**を指している（古い ARN・別環境）
 *   3. 付いているが Cognito に呼ぶ権限が無い（関数のリソースポリシーに
 *      cognito-idp.amazonaws.com からの InvokeFunction が無い）
 *
 * `existing: true` のトリガーは serverless のカスタムリソースが後から
 * プールへ書き込む形なので、1〜3 のどれも**デプロイは緑のまま**起きる。
 */
function triggerLines({ attachedArn, expectedName, fnExists, policyAllowsCognito, policyReadable }) {
    const out = [];
    if (!attachedArn) {
        out.push("  ❌ プールに PostConfirmation トリガーが**付いていません**");
        out.push("     → 新規登録した人は全員、グループにもプロフィールにも入らない");
        out.push("     直し方: `maintenance` → `attach-post-confirmation`（読むだけ → apply）");
        out.push("     ※ `api` の再デプロイでは付き直らない——付けるのは CloudFormation のカスタムリソースで、");
        out.push("       プロパティが変わらないと走らないうえ、プールを名前で探す（同名が2つあれば先頭に付ける）");
        return out;
    }
    out.push(`  付いているトリガー: ${attachedArn}`);
    if (!attachedArn.endsWith(`:${expectedName}`) && !attachedArn.includes(`:${expectedName}:`)) {
        out.push(`  ❌ 期待する関数（${expectedName}）ではありません。別環境か古い関数を指しています`);
        out.push("     直し方: `maintenance` → `attach-post-confirmation`（期待する関数へ付け替える）");
        return out;
    }
    if (fnExists === false) {
        out.push("  ❌ 指している関数が存在しません（消えた・改名された）");
        out.push("     直し方: `api` をデプロイして関数を作ってから `attach-post-confirmation`");
        return out;
    }
    if (!policyReadable) {
        out.push("  Cognito からの呼び出し権限: **確認できていません**（lambda:GetPolicy が無い）");
        return out;
    }
    if (!policyAllowsCognito) {
        out.push("  ❌ 関数に、このプールからの cognito-idp.amazonaws.com の InvokeFunction が許可されていません");
        out.push("     → プールにはトリガーが付いているのに、Cognito が呼べずに黙って飛ばされる");
        out.push("       （別のプールを SourceArn にした許可は数えない）");
        out.push("     直し方: `maintenance` → `attach-post-confirmation`（このプールを SourceArn にした許可を付ける）");
        return out;
    }
    out.push("  ✅ トリガーは付いていて、関数も在り、Cognito から呼べる");
    out.push("     → それでも入らないなら、関数の中で AdminAddUserToGroup が拒否されている（CloudWatch のログ:");
    out.push(`       /aws/lambda/${expectedName} に「postConfirmation: AdminAddUserToGroup failed」が出る）`);
    return out;
}

/**
 * トリガーが走る状態かを AWS から読んで、`triggerLines` の材料にする。
 * クライアントを引数で受けるのは、配線（SourceArn まで見る判定を通しているか）を
 * 偽の `send` で確かめるため——`triggerLines` だけ見ていると、ここで判定を
 * 差し替えても気づけない（変異で素通りした）。
 */
/**
 * **メールアドレスを変えられるようにしてよいプールか。**
 *
 * このプールは `AliasAttributes: ["email"]`＝**メールがログインID**。
 * `UpdateUserAttributes` で email を変えると `email_verified` が false に
 * 落ちるので、**既定のままだと「新しいメールを確認するまでログインできない」
 * 窓が開く**——確認コードを入れる前にタブを閉じた人は締め出される。
 *
 * それを塞ぐのが `UserAttributeUpdateSettings.AttributesRequireVerificationBeforeUpdate`
 * ——入っていれば、**新しいメールが確認できるまで古いメールが生き続ける**
 * （その間ログインは今までどおり）。
 *
 * また `AutoVerifiedAttributes` に email が無いと、Cognito は確認コードを
 * 送らない＝変更を完了させる手段が無い。
 *
 * **どちらも「入っているか」でしか判断しない**（入れるのは別の作業）。
 */
function emailChangeLines({ alias, autoVerified, requireVerificationBeforeUpdate }) {
    const out = [];
    const isAlias = (alias ?? []).includes("email");
    out.push(`  メールがログインIDか（AliasAttributes に email）: ${isAlias ? "はい" : "いいえ"}`);
    out.push(`  AutoVerifiedAttributes: ${JSON.stringify(autoVerified ?? null)}`);
    out.push(`  AttributesRequireVerificationBeforeUpdate: ${JSON.stringify(requireVerificationBeforeUpdate ?? null)}`);

    if (!(autoVerified ?? []).includes("email")) {
        out.push("  ❌ email が AutoVerifiedAttributes に無い → 確認コードが送られない＝変更を完了できない");
        out.push("     メールアドレス変更を作る前に、ここを入れること");
        return out;
    }
    if (!(requireVerificationBeforeUpdate ?? []).includes("email")) {
        out.push("  ❌ AttributesRequireVerificationBeforeUpdate に email が無い");
        if (isAlias) {
            out.push("     → メールを変えた瞬間に古いメールでログインできなくなり、新しい方はまだ確認前");
            out.push("       ＝**確認コードを入れる前にタブを閉じた人は締め出される**");
        }
        out.push("     メールアドレス変更を作る前に入れること:");
        out.push("       aws cognito-idp update-user-pool --user-pool-id <id> \\");
        out.push("         --user-attribute-update-settings AttributesRequireVerificationBeforeUpdate=email");
        out.push("     ⚠️ update-user-pool は渡さない項目を既定値に戻す。他の設定ごと送り返すこと");
        return out;
    }
    out.push("  ✅ 変更中も古いメールが生きる（締め出されない）");
    return out;
}

async function emailChange() {
    head("メールアドレスを変えられるプールか（変更機能を作る前の関門）");
    const poolId = process.env.COGNITO_USER_POOL_ID;
    if (!poolId) { line("  COGNITO_USER_POOL_ID が未設定のため飛ばします"); return; }
    const p = (await idp.send(new DescribeUserPoolCommand({ UserPoolId: poolId }))).UserPool ?? {};
    for (const l of emailChangeLines({
        alias: p.AliasAttributes,
        autoVerified: p.AutoVerifiedAttributes,
        requireVerificationBeforeUpdate: p.UserAttributeUpdateSettings?.AttributesRequireVerificationBeforeUpdate,
    })) line(l);
}

async function inspectTrigger({ idp, lambda, poolId, stage, warn = line }) {
    const expectedName = expectedFunctionName(stage);
    const pool = await idp.send(new DescribeUserPoolCommand({ UserPoolId: poolId }));
    const attachedArn = pool.UserPool?.LambdaConfig?.PostConfirmation ?? "";
    const poolArn = pool.UserPool?.Arn ?? "";

    let fnExists;
    let policyReadable = false;
    let policyAllowsCognito = false;
    if (attachedArn) {
        try {
            await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: attachedArn }));
            fnExists = true;
        } catch (e) {
            if (e.name === "ResourceNotFoundException") fnExists = false;
            else warn(`  関数の存在を確かめられませんでした（${e.name}）`);
        }
        if (fnExists) {
            try {
                const res = await lambda.send(new GetPolicyCommand({ FunctionName: attachedArn }));
                policyReadable = true;
                policyAllowsCognito = policyAllowsPool(JSON.parse(res.Policy ?? "{}"), poolArn);
            } catch (e) {
                if (e.name === "ResourceNotFoundException") { policyReadable = true; policyAllowsCognito = false; }
            }
        }
    }
    return { attachedArn, expectedName, fnExists, policyAllowsCognito, policyReadable };
}

async function postConfirmationTrigger() {
    head("PostConfirmation トリガー（新規登録した人がグループに入る仕組みが生きているか）");
    const poolId = process.env.COGNITO_USER_POOL_ID;
    if (!poolId) { line("  COGNITO_USER_POOL_ID が未設定のため飛ばします"); return; }
    const stage = process.env.STAGE || "prod";
    for (const l of triggerLines(await inspectTrigger({ idp, lambda, poolId, stage }))) line(l);
}

/** 秒を人が読める長さに（TTL は 31536000 のような桁で出てくる） */
function humanSeconds(sec) {
    if (typeof sec !== "number" || !Number.isFinite(sec)) return "?";
    if (sec >= 86400) return `${sec}秒（約${Math.round(sec / 86400)}日）`;
    if (sec >= 3600) return `${sec}秒（約${Math.round(sec / 3600)}時間）`;
    return `${sec}秒`;
}

/**
 * behavior 1つを1行にする（**純関数**。AWS を叩かないのでテストできる）。
 *
 * 以前は `cachePolicyId=658327ea-…（TTL はポリシー側）` としか出せず、
 * **LEFT-4「削除がエッジに何日残るか」に答えられていなかった**
 * ——ID を見ても秒数は分からない。ポリシーを引いて秒で出す。
 *
 * @param b        CacheBehavior（`DefaultCacheBehavior` は PathPattern を持たない）
 * @param policies Map<policyId, { name, MinTTL, DefaultTTL, MaxTTL }>
 */
/**
 * **圧縮しているか。** ここが `false` だと、届くのは**そのままのバイト数**。
 *
 * 2026-09-12 にビルドの出力を数えて、写真ページの JS を
 * **688KB → gzip 215KB** と報告した。**その gzip は CloudFront が
 * 掛けるもので、リポジトリのどこにも「掛かっている」証拠が無かった**
 * ——`scripts/deploy-static-site.js` は `ContentEncoding` を付けない
 * （＝事前に圧縮して上げてはいない）ので、圧縮するかは配信側の
 * `Compress` ひとつで決まる。なのに診断は TTL しか出しておらず、
 * **見積もりが3倍外れていても誰も気づけない**状態だった。
 *
 * 台帳の型「道具が『0件』と言うとき、数え方を疑う」の裏返し——
 * **道具が何も言わない項目は、無いのではなく見ていない。**
 */
function compressLabel(b) {
    if (b.Compress === true) return "圧縮=ON";
    if (b.Compress === false) return "圧縮=**OFF**";
    return "圧縮=不明";
}

function describeBehavior(b, policies) {
    const path = b.PathPattern ?? "(default)";
    const zip = compressLabel(b);
    // 旧式（ポリシーではなく behavior に直接 TTL を書く形）はそのまま出す
    if (typeof b.DefaultTTL === "number") {
        return `  ${path}: 旧式 defaultTTL=${humanSeconds(b.DefaultTTL)} maxTTL=${humanSeconds(b.MaxTTL)} minTTL=${humanSeconds(b.MinTTL)} ${zip}`;
    }
    const id = b.CachePolicyId;
    const p = id ? policies.get(id) : undefined;
    if (!p) {
        // **読めなかったことを「TTL はポリシー側」で誤魔化さない。**
        // 権限が無い・ID が無いのどちらかで、どちらも「分かっていない」
        return `  ${path}: cachePolicyId=${id ?? "-"}（ポリシーを読めなかった＝TTL 不明） ${zip}`;
    }
    return `  ${path}: ${p.name} defaultTTL=${humanSeconds(p.DefaultTTL)} maxTTL=${humanSeconds(p.MaxTTL)} minTTL=${humanSeconds(p.MinTTL)} ${zip}`;
}

/**
 * 圧縮の結果を「何が起きるか」に翻訳する行（**純関数**）。
 * 秒数と同じで、`Compress=false` とだけ出しても意味が伝わらない。
 */
function compressNote(behaviors) {
    const off = behaviors.filter((b) => b.Compress === false).map((b) => b.PathPattern ?? "(default)");
    const unknown = behaviors.filter((b) => b.Compress !== true && b.Compress !== false)
        .map((b) => b.PathPattern ?? "(default)");
    const out = [];
    if (off.length > 0) {
        out.push(`  !! 圧縮が OFF の経路: ${off.join(" / ")}`);
        out.push("     → HTML と JS が**そのままのバイト数**で届く（実測で約3倍）。");
        out.push("     → CloudFront の該当ビヘイビアで「オブジェクトを自動的に圧縮」を ON に。");
    }
    if (unknown.length > 0) {
        out.push(`  ?? 圧縮の設定を読めなかった経路: ${unknown.join(" / ")}`);
    }
    if (out.length === 0) out.push("  圧縮: 全経路で ON（測った gzip のバイト数がそのまま届く）");
    return out;
}

/** 削除がエッジに残る期間（LEFT-4） */
async function cdnTtl() {
    head("CloudFront の TTL（LEFT-4: 削除がエッジに残る期間）");
    const distId = process.env.CLOUDFRONT_DISTRIBUTION_ID;
    if (!distId) { line("  CLOUDFRONT_DISTRIBUTION_ID が未設定のため飛ばします"); return; }
    const res = await cf.send(new GetDistributionConfigCommand({ Id: distId }));
    const cfg = res.DistributionConfig ?? {};
    const behaviors = [cfg.DefaultCacheBehavior, ...(cfg.CacheBehaviors?.Items ?? [])].filter(Boolean);

    // **同じポリシーを複数の behavior が使う**（本番は5つ中4つが同じ）。
    // ID ごとに1回だけ引く
    const policies = new Map();
    for (const id of new Set(behaviors.map((b) => b.CachePolicyId).filter(Boolean))) {
        try {
            const r = await cf.send(new GetCachePolicyCommand({ Id: id }));
            const cp = r.CachePolicy?.CachePolicyConfig ?? {};
            policies.set(id, {
                name: cp.Name ?? "(名前なし)",
                MinTTL: cp.MinTTL, DefaultTTL: cp.DefaultTTL, MaxTTL: cp.MaxTTL,
            });
        } catch (e) {
            // 1つ読めなくても残りは出す（`describeBehavior` が「不明」と書く）
            console.error(`  [cachePolicy ${id}] 失敗: ${e.name}: ${e.message}`);
        }
    }

    for (const l of cdnLines(behaviors, policies, cfg.CustomErrorResponses?.Items ?? [])) line(l);
}

/**
 * 存在しない URL に何を返しているか（**純関数**）。
 *
 * **静的サイトの 404 は CloudFront の設定で決まる。**
 * `scripts/fix-cdn-error-pages.js` が 403/404 を `/404.html` に振り替え、
 * **ステータスは 404 のまま**返すよう設定する（これが無いと
 * `/404.html` の中身が **200 で**返る＝いわゆる soft-404。
 * 消した写真のURLも「中身のあるページ」として扱われ、
 * **検索エンジンが消えたページを索引に残し続ける**）。
 *
 * ところが**その設定を確かめるものが何も無かった**——圧縮と同じ盲点で、
 * ディストリビューションを作り直した日に静かに戻る。
 * 期待値は `fix-cdn-error-pages.js` の定数と同じ（403/404 → `/404.html`・
 * ステータス 404）。ずれていたら、何が起きるかまで書く。
 */
function errorPageNote(items) {
    const want = [403, 404];
    const out = [];
    if (!Array.isArray(items) || items.length === 0) {
        out.push("  !! カスタムエラー応答が1つも無い");
        out.push("     → 存在しない URL に **S3 の XML エラー**がそのまま出る（自作404が出ない）。");
        out.push("     → Actions → Maintenance → task=cdn-error-pages で設定する。");
        return out;
    }
    for (const code of want) {
        const cur = items.find((e) => Number(e.ErrorCode) === code);
        if (!cur) {
            out.push(`  !! ${code} の振り替えが無い`);
            continue;
        }
        const page = cur.ResponsePagePath ?? "(そのまま)";
        const status = String(cur.ResponseCode ?? "(そのまま)");
        const ok = page === "/404.html" && status === "404";
        out.push(`  ${code} → ${page} / ステータス ${status}${ok ? "" : "  !! 期待は /404.html と 404"}`);
        if (status === "200") {
            out.push("     → **soft-404**（中身のあるページとして返る）。消したページが索引に残り続ける。");
        }
    }
    return out;
}

/**
 * CDN の節に出す行を全部組み立てる（**純関数**）。
 *
 * **配線を「呼んでいるか」ではなく「出た行」で見るため**に切り出した。
 * 前は `cdnTtl()` の中で3種類を順に `line()` していたので、
 * **`compressNote` の呼び出しを丸ごと消しても全テストが緑**だった
 * （変異で確認）。台帳が `reportFunctions` で同じ判断をしている。
 */
function cdnLines(behaviors, policies, errorResponses) {
    return [
        ...behaviors.map((b) => describeBehavior(b, policies)),
        ...compressNote(behaviors),
        ...securityHeadersNote(behaviors),
        ...edgeFunctionNote(behaviors),
        ...errorPageNote(errorResponses ?? []),
        ...residencyNote(),
    ];
}

/**
 * エッジの関数が付いているか（**純関数**）。
 *
 * **このサイトで一番外れたら困る設定なのに、診断が一度も見ていなかった。**
 *
 * サイトマップの54件も内部リンクも全部**拡張子なし**（`/photo/<id>`・
 * `/location/%E6%9D%B1%E4%BA%AC`）なのに、`out/` に拡張子なしのファイルは
 * **0件**で、`deploy-static-site.js` はキーをそのまま上げる
 * （`photo/<id>.html`）。オリジンは S3 の REST + OAC なので、存在しない
 * キーは 403 → カスタムエラー応答で `/404.html`（ステータス404）。
 * **つまり、エッジで `/foo` → `/foo.html` に書き換える関数が無ければ、
 * トップ以外の全ページが 404 になる。**
 *
 * その関数は本番の既定ビヘイビアに付いている Lambda@Edge で、
 * **コードはこのリポジトリに無い**——`fix-cdn-static-behavior.js` も
 * `provision-env.js` も「既定ビヘイビアに viewer-request と
 * origin-response が付いている」前提で書かれている（前者はその実行回数を
 * 減らすため、後者は staging に引き継がないため）。しかも
 * `provision-env.js` の `stripLambdaAssociations` は**まさにこれを外す**
 * 関数で、走らせる先を間違えれば本番の全ページが消える。それを
 * **検知する口がどこにも無かった。**
 *
 * `/_next/static/*` だけは**外れているのが正しい**
 * （`fix-cdn-static-behavior.js` の目的そのもの。付けたままだと1ページで
 * 十数回起動し、コールドな初回アクセスで 503 になって CSS/JS が欠ける）。
 * そこは逆向きに警告する。
 *
 * 圧縮・応答ヘッダーと同じ判断（`4548278a`・`cb1ad087`）——
 * **道具が何も言わない項目は、無いのではなく見ていない。**
 * **読めなかったのを「付いている」に丸めない。**
 */
function edgeAssociations(b) {
    const lambda = (b?.LambdaFunctionAssociations?.Items ?? []).map((f) => f?.EventType).filter(Boolean);
    const fns = (b?.FunctionAssociations?.Items ?? []).map((f) => f?.EventType).filter(Boolean);
    return [...lambda, ...fns];
}

const STATIC_PATTERN = "/_next/static/*";

function edgeFunctionNote(behaviors) {
    const out = [];
    const def = behaviors.find((b) => !b.PathPattern);
    if (!def) {
        out.push("  ?? 既定のキャッシュ動作が見つからない（エッジの関数を確かめられなかった）");
    } else {
        const evts = edgeAssociations(def);
        if (!evts.includes("viewer-request")) {
            out.push("  !! 既定の経路に viewer-request のエッジ関数が無い");
            out.push("     → 拡張子なしのURL（`/photo/<id>`）を `.html` に書き換える先が無い。");
            out.push("       S3 に `photo/<id>` というキーは無いので 403 → 404.html。");
            out.push("       **トップ以外の全ページ（サイトマップの54件すべて）が 404 になる。**");
            out.push("     → 関数のコードはこのリポジトリに無い。CloudFront の既定ビヘイビアに");
            out.push("       viewer-request の Lambda@Edge / CloudFront Function を付け直す。");
        } else {
            out.push(`  エッジの関数（既定）: ${evts.join(" / ")}（拡張子なしURLの書き換えはここ）`);
        }
    }

    const statics = behaviors.filter((b) => b.PathPattern === STATIC_PATTERN);
    if (statics.length === 0) {
        out.push(`  !! ${STATIC_PATTERN} 専用の動作が無い（CSS/JS も既定＝エッジ関数を通る）`);
        out.push("     → 1ページで十数回起動する。コールドな初回アクセスで 503 になり");
        out.push("       CSS/JS が欠けて画面が崩れる（再現済み）。");
        out.push("     → node scripts/fix-cdn-static-behavior.js --apply（maintenance に口は無い）");
    }
    for (const b of statics) {
        const evts = edgeAssociations(b);
        if (evts.length > 0) {
            out.push(`  !! ${STATIC_PATTERN} にエッジ関数が付いている: ${evts.join(" / ")}`);
            out.push("     → 1ページで十数回起動する。コールドな初回アクセスで 503 になり");
            out.push("       CSS/JS が欠けて画面が崩れる（再現済み）。");
            out.push("     → node scripts/fix-cdn-static-behavior.js --apply（maintenance に口は無い）");
        }
    }
    return out;
}

/**
 * 応答ヘッダーのポリシーが付いているか（**純関数**）。
 *
 * **リポジトリのどこにも設定が無い**（`X-Content-Type-Options` /
 * `Referrer-Policy` / `Content-Security-Policy` / HSTS を grep して0件）。
 * ただし**付いていないと断定はできない**——コンソールで付けた場合は
 * コードに現れない。だから**診断に出す**。圧縮のときと同じ判断
 * （`4548278a`「道具が何も言わない項目は、無いのではなく見ていない」）。
 *
 * とくに効くのが `X-Content-Type-Options: nosniff`。**利用者が上げた
 * ファイルを同じオリジンから配っている**（`/uploads/*` は
 * `journey-photo.com` のパス）ので、ブラウザが中身を見て種別を推測すると、
 * 画像のつもりのものが HTML として実行されうる。入口は
 * `uploadPolicy.ts` が SVG を断り、presign が `content-type` を署名に
 * 入れて塞いである（`738bef3`）——`nosniff` はその**二重目**。
 *
 * **読めなかったのを「付いている」に丸めない**（権限が足りない日に
 * 嘘を報告する）。
 */
function securityHeadersNote(behaviors) {
    const named = (b) => b.PathPattern ?? "(default)";
    const without = behaviors.filter((b) => !b.ResponseHeadersPolicyId).map(named);
    const out = [];
    if (without.length === behaviors.length && behaviors.length > 0) {
        out.push("  !! 応答ヘッダーのポリシーが1つも付いていない");
        out.push("     → nosniff / Referrer-Policy / HSTS / CSP がどれも付かない。");
        out.push("     → とくに nosniff。利用者が上げたファイルを同じオリジンから配っているので、");
        out.push("       種別の推測が働くと「画像のつもりのもの」が実行されうる（入口は塞いであるが二重目が無い）。");
        out.push("     → CloudFront のマネージドポリシー SecurityHeadersPolicy を各ビヘイビアに付けるのが最短。");
    } else if (without.length > 0) {
        out.push(`  !! 応答ヘッダーのポリシーが無い経路: ${without.join(" / ")}`);
    } else if (behaviors.length > 0) {
        out.push("  応答ヘッダー: 全経路にポリシーが付いている（中身までは見ていない）");
    }
    return out;
}

/**
 * TTL の秒数を「削除したものが何日残るか」に翻訳する行（**純関数**）。
 *
 * **秒数だけでは答えにならない。** CloudFront は原本の `Cache-Control` を
 * maxTTL まで尊重するので、実効は「原本の max-age と maxTTL の小さい方」。
 * そして**残るかどうかは経路によって違う**——エッジの掃除
 * （`invalidateUploads`）を通る削除と、通らない削除がある。
 *
 * **一度ここに「削除経路に CreateInvalidation は無い」と書いて出した。
 * 誤りだった**（退会・ストーリー削除・期限切れ掃除には前からある）。
 * **そのあと、直した側を書き換え忘れて同じことをもう一度やった**——
 * `0a30de3d` で管理APIに掃除を足したのに、ここは「管理APIには無い」と
 * 言い続け、しかもテストがその古い文面を固定していた（レビュー指摘）。
 * **経路を足したら、ここと `diagnoseCdnTtl.test.ts` も一緒に直す。**
 */
function residencyNote() {
    return [
        `  ※ 実体は max-age=${UPLOAD_MAX_AGE} で置かれる（両 upload.ts）。`,
        "    実効TTL は その値と /uploads/* の maxTTL の小さい方。",
        "    エッジの掃除があるのは 退会・ストーリー削除・期限切れ掃除・自分の写真削除・管理APIの削除。",
        "    残るのは discardUpload（保存前の破棄）だけ——公開前なのでエッジに",
        "    載っているとは限らない（未確認）。載っていれば この値がそのまま残存期間になる（LEFT-4）。",
    ];
}

/**
 * 無効化を**誰が作ったか**を数える（純関数）。
 *
 * **これが LEFT-4 の「本当に効いているか」の唯一の証拠。**
 * `serverless.yml` は `exclude: ['@aws-sdk/*']` なので SDK はバンドルされず
 * **Lambda ランタイム任せ**で、`@aws-sdk/client-cloudfront` が無ければ
 * `invalidateUploads` は警告1行で静かに落ちる（＝削除しても掃除されない）。
 * 中からは分からないので、**外から履歴を見る**。
 *
 * 見分け方は `CallerReference` の頭:
 *   `del-…`  … Lambda（削除・退会・ストーリー掃除）。**これがあれば動いている**
 *   それ以外 … デプロイ（`deploy-static-site.js` は `${Date.now()}-${i}` や
 *              `reheal-…`）、`restrict-originals-…`、`shrink-profiles-…`
 */
function countInvalidationSources(refs) {
    const fromLambda = refs.filter((r) => String(r).startsWith("del-"));
    return { total: refs.length, fromLambda: fromLambda.length, latestLambda: fromLambda[0] ?? null };
}

/** 直近の無効化を読んで、Lambda 由来があるかを見る（LEFT-4 の効き確認） */
async function invalidationHistory() {
    head("CloudFront の無効化履歴（LEFT-4: 削除時の掃除が本当に効いているか）");
    const distId = process.env.CLOUDFRONT_DISTRIBUTION_ID;
    if (!distId) { line("  CLOUDFRONT_DISTRIBUTION_ID が未設定のため飛ばします"); return; }
    // **できるだけ遡る**（CloudFront の上限は100）。デプロイのたびに1本
    // 作られるので、20件だと数日しか見えない——`del-…` を探すには足りない
    const list = await cf.send(new ListInvalidationsCommand({ DistributionId: distId, MaxItems: 100 }));
    const items = list.InvalidationList?.Items ?? [];
    if (items.length === 0) { line("  無効化の履歴がありません"); return; }
    // `ListInvalidations` は CallerReference を返さないので1件ずつ引く（読み取り）
    const refs = [];
    for (const it of items) {
        try {
            const got = await cf.send(new GetInvalidationCommand({ DistributionId: distId, Id: it.Id }));
            refs.push(got.Invalidation?.InvalidationBatch?.CallerReference ?? "(不明)");
        } catch (e) {
            console.error(`  [invalidation ${it.Id}] 失敗: ${e.name}: ${e.message}`);
        }
    }
    const { total, fromLambda, latestLambda } = countInvalidationSources(refs);
    line(`  直近 ${total} 件のうち Lambda 由来（del-…）: ${fromLambda} 件`);
    if (fromLambda > 0) {
        line(`  → **削除時のエッジ掃除は本番で動いている**（最新: ${latestLambda}）`);
    } else {
        line("  → Lambda 由来は0件。**動いていないのか、まだ誰も消していないのかは これだけでは分からない**");
        line("    （写真・ストーリーを1つ消してから、もう一度この診断を流すと分かる）");
    }
}

/**
 * Lambda のロールと環境変数（IAM-1 / IAM-2 の当たり確認）。
 *
 * 直したのは設定ファイルなので、**実際に当たっているかは AWS を見ないと
 * 分からない**。ここで見るのは2つ:
 *   - 未認証で呼べる7つの関数が `*-publicRead` ロールで動いているか
 *   - GitHub の書き込みトークンが、頼む5つ以外の関数から消えているか
 *
 * 値は出さない。**設定名と「有る/無い」だけ**——診断のログは Actions に
 * 残るので、トークンの中身をそこへ書き写したら直した意味が無くなる。
 */
/**
 * 読み取り専用ロールを付けてあるべき関数。**手で並べない。**
 *
 * 2026-09-12 に本番で流したら、`getInvite` に
 * `!! 読み取り専用ロールが付いている` と出た——**誤報**。
 * `api-user/serverless.yml` はあの関数に正しく `role: PublicReadRole` を
 * 付けている。手書きの7個にあとから足した1つが入っていなかっただけ。
 * しかも要約は `7/7` と出るので、**「!! が出ているのに問題なし」**という
 * 読めない報告になっていた。
 *
 * **同じスクリプトが一度「手で並べない」と直した隣**（下の
 * `rebuildFnsFromServerless`）に、手書きの一覧が残っていた
 * ——台帳の型「片方の入口だけ直して、もう片方を置いてくる」。
 */
function publicFnsFromServerless() {
    return fnsFromServerless((part) => /\n\s*role:\s*PublicReadRole\b/.test(part));
}
/**
 * トークンを配ってあるべき関数。**手で並べない。**
 *
 * 一度 `["updatePhotoVisibility", "deleteMyPhoto", "deleteAccount",
 * "updatePhoto", "deletePhoto"]` と書いていたが、実際に配線されているのは
 * **8つ**（api-user は `presignedUrl` / `savePhoto` / `discardUpload` も）。
 * つまり**診断が3つ見落としていた**——トークンを登録して5つにだけ届いた
 * 状態でも `!!` が消え、「済んだ」と読めてしまう。`savePhoto` は公開時に
 * 再ビルドを頼む当のものなので、そこが黙って外れるのがいちばん困る。
 *
 * **診断の数え方を自分で狭くして「0件」と報告する**のは、この台帳で
 * 一度やって戒めた形（そのときも同じスクリプト）。`serverless.yml` から
 * 読む——デプロイが見ているのと同じ場所。
 * 突き合わせは `scripts/__tests__/diagnoseRebuildFns.test.ts`。
 */
/**
 * **名前はパッケージ込みで持つ**（`api:presignedUrl` / `api-user:presignedUrl`）。
 *
 * 2026-09-12 に本番で流したら、管理API（`api`）の `presignedUrl` と
 * `savePhoto` に `!! 再ビルドのトークンが無い` と出た——**誤報**。
 * `api/serverless.yml` がトークンを渡すのは `updatePhoto` と `deletePhoto`
 * だけで、あの2つは渡さないのが正しい。**短い名前がパッケージを落とす**
 * ので、`api-user` 側の同名関数の期待が管理API側に当たっていた。
 *
 * しかも要約は `8/8`（＝重複を畳んだ名前の数）と出るので、
 * **`!!` が2つ出ているのに「全部揃っている」**という自己矛盾になっていた。
 */
function fnsFromServerless(match) {
    const fs = require("fs");
    const path = require("path");
    const out = [];
    for (const dir of ["api", "api-user"]) {
        const file = path.resolve(__dirname, "..", dir, "serverless.yml");
        if (!fs.existsSync(file)) continue;
        const yml = fs.readFileSync(file, "utf8");
        const fnSection = yml.split(/\nfunctions:\n/)[1];
        if (!fnSection) continue;
        for (const part of ("\n" + fnSection.split(/\n(?=[a-zA-Z#])/)[0]).split(/\n(?=  \w+:\n)/)) {
            const m = /^\n?  (\w+):/.exec(part);
            if (m && match(part)) out.push(`${dir}:${m[1]}`);
        }
    }
    return out;
}

function rebuildFnsFromServerless() {
    return fnsFromServerless((part) => part.includes("REBUILD_DISPATCH_TOKEN"));
}
const REBUILD_FNS = rebuildFnsFromServerless();
const PUBLIC_FNS = publicFnsFromServerless();

/**
 * Lambda の関数名から `パッケージ:短い名前` を作る。
 * `photo-gallery-user-api-prod-…-presignedUrl` → `api-user:presignedUrl`
 * `photo-gallery-api-prod-…-presignedUrl`      → `api:presignedUrl`
 */
function qualify(functionName) {
    const m = /^photo-gallery(-user)?-api-[^-]+-(.+)$/.exec(functionName ?? "");
    if (!m) return { pkg: "", short: functionName ?? "", key: functionName ?? "" };
    const pkg = m[1] ? "api-user" : "api";
    return { pkg, short: m[2], key: `${pkg}:${m[2]}` };
}

async function lambdaRoles() {
    head("Lambda のロールと環境変数（IAM-1 / IAM-2 が当たっているか）");
    const stage = process.env.STAGE || "prod";
    const fns = [];
    let marker;
    do {
        const res = await lambda.send(new ListFunctionsCommand({ Marker: marker, MaxItems: 50 }));
        fns.push(...(res.Functions ?? []));
        marker = res.NextMarker;
    } while (marker);

    const mine = fns.filter((f) => (f.FunctionName ?? "").startsWith(`photo-gallery-api-${stage}-`)
        || (f.FunctionName ?? "").startsWith(`photo-gallery-user-api-${stage}-`));
    if (mine.length === 0) { line(`  photo-gallery(-user)-api-${stage}-* が1つも見つかりません`); return; }
    for (const l of reportFunctions(mine)) line(l);
}

/**
 * 関数の一覧から報告の行を組む。**AWS を叩く部分と分ける。**
 *
 * 分けないと、テストが `診断のソースにこの文字列があるか` しか見られない
 * ——実際そうなっていて、`tokenOk` を `REBUILD_FNS.length`（＝全部揃って
 * いると嘘をつく）に変えても、`REBUILD_FNS.length === 0` の分岐を殺しても
 * **509件すべて緑**だった（レビューが変異で実証）。数えた結果を返す形に
 * すれば、嘘の数はそのまま落ちる。
 *
 * `wanted` を引数に取るのは**テストのため**。モジュール定数を閉じ込めると
 * 「1つも読み取れなかった」の分岐に入る入力を作れず、綴りを見るテストしか
 * 書けない（実際そう書いていて、分岐の中身を空にしても緑だった）。
 *
 * @param {Array<{FunctionName?: string, Role?: string, Environment?: {Variables?: Record<string, string>}}>} mine
 * @param {string[]} [wanted] トークンを配ってあるべき関数（既定は serverless.yml から読んだもの）
 * @returns {string[]}
 */
function reportFunctions(mine, wanted = REBUILD_FNS, publics = PUBLIC_FNS) {
    const out = [];
    const line = (s) => out.push(s);
    let publicOk = 0, leaked = 0, tokenOk = 0;
    for (const f of mine.sort((a, b) => a.FunctionName.localeCompare(b.FunctionName))) {
        const { pkg, short, key } = qualify(f.FunctionName);
        const role = (f.Role ?? "").split("/").pop() ?? "";
        const hasToken = Boolean(f.Environment?.Variables?.REBUILD_DISPATCH_TOKEN);
        // **パッケージ込みで突き合わせる**（`api:presignedUrl` と
        // `api-user:presignedUrl` は別の関数で、期待も別）
        const wantPublic = publics.includes(key);
        const wantToken = wanted.includes(key);
        // **表示もパッケージ込み。** `presignedUrl` は2つあるので、
        // 短い名前だけだとどちらの行か読めない（`!!` が出たとき困る）
        const label = pkg ? `${pkg}:${short}` : short;
        const isPublicRole = /publicRead$/.test(role);
        const flags = [];
        if (wantPublic && !isPublicRole) flags.push("!! 共有ロールのまま");
        if (!wantPublic && isPublicRole) flags.push("!! 読み取り専用ロールが付いている");
        if (hasToken && !wantToken) flags.push("!! 再ビルドのトークンが残っている");
        if (!hasToken && wantToken) flags.push("!! 再ビルドのトークンが無い（削除しても静的ページが残る）");
        if (wantPublic && isPublicRole) publicOk++;
        if (hasToken && !wantToken) leaked++;
        if (hasToken && wantToken) tokenOk++;
        line(`  ${label.padEnd(34)} role=${role}${hasToken ? " REBUILD_DISPATCH_TOKEN=あり" : ""}${flags.length ? "  " + flags.join(" / ") : ""}`);
    }
    // **分母を出す。** 出さないと「`!!` が0件」が「全部揃っている」なのか
    // 「見る対象が0件」なのか読めない——一覧を `serverless.yml` から
    // 読むようにしたぶん、**正規表現が壊れたら黙って0件になる**
    // 数えるのは上のループの中（`publicOk` / `leaked` と同じ場所）。
    // ここで数え直すと**関数名を短くする規則の2つ目の写し**ができ、
    // 片方だけ直した日に黙ってずれる——このコミットが直した当のもの
    line(`  → 読み取り専用ロールの関数 ${publicOk}/${publics.length} ・ トークンが余計に付いた関数 ${leaked}`);
    line(`  → 再ビルドのトークンを持つ関数 ${tokenOk}/${wanted.length}`);
    if (wanted.length === 0) {
        line("  !! serverless.yml からトークンを配る関数を1つも読み取れなかった（診断が壊れています）");
    }
    if (publics.length === 0) {
        line("  !! serverless.yml から読み取り専用ロールの関数を1つも読み取れなかった（診断が壊れています）");
    }
    return out;
}

/**
 * 同時実行の総枠（`musicSearch` の予約を戻せるか）。
 *
 * 2026-09-01、本番の api-user が `reservedConcurrency: 10` で
 * 「UnreservedConcurrentExecution がアカウントの最低値(10)を下回る」と
 * 断られ、**デプロイ全体が巻き戻った**（同じ回の IAM 修正まで届かなくなった）。
 * 予約を 0 に倒して復旧したが、**総枠がいくつかは測っていない**。ここで出す。
 *
 * 予約できる上限 = 総枠 - 10（AWS が未予約に残せと言う最低値）。
 */
async function concurrency() {
    head("Lambda の同時実行枠（musicSearch の予約を戻せるか）");
    const res = await lambda.send(new GetAccountSettingsCommand({}));
    const limit = res.AccountLimit?.ConcurrentExecutions;
    const unreserved = res.AccountLimit?.UnreservedConcurrentExecutions;
    line(`  総枠: ${limit ?? "?"} / 未予約: ${unreserved ?? "?"}`);
    if (typeof limit === "number") {
        const room = limit - 10;
        line(room > 0
            ? `  → 予約できるのは合計 ${room} まで（総枠 ${limit} − 未予約の最低値 10）`
            : `  → **1つも予約できない**（総枠 ${limit} が最低値 10 を上回っていない）。枠の引き上げが要る`);
    }
}

/**
 * 登録している人の数と、直近の登録。
 *
 * **名前もメールも出さない。** 診断のログは Actions に残り、閲覧できる人が
 * 利用者本人とは限らない。`who-liked` が「全員分の表示名がログに並ぶ」
 * 事故を起こした前例があるので、ここは**件数と日付だけ**にする
 * （`diagnose-user-search.js` も同じ方針で書かれている）。
 *
 * `userId` は Cognito の sub で、`/users/<sub>` として公開ページのURLに
 * なっている（このリポジトリの他のコメントが「sub は秘密ではない」と
 * 書いているとおり）。それでも並べる理由が無いので出さない。
 */
async function users() {
    head("登録している人");
    const usersTable = process.env.USERS_TABLE;
    if (!usersTable) { line("  USERS_TABLE が未設定のため飛ばします"); return; }

    const rows = [];
    let lastKey;
    let pages = 0;
    do {
        const res = await ddb.send(new ScanCommand({
            TableName: usersTable,
            // 予約行（username#...）と墓石を見分けるのに要るものだけ
            ProjectionExpression: "userId, createdAt, deletedAt, displayName, username",
            ExclusiveStartKey: lastKey,
        }));
        for (const it of res.Items ?? []) {
            rows.push({
                userId: it.userId?.S ?? "",
                createdAt: it.createdAt?.S ?? "",
                deleted: Boolean(it.deletedAt?.S),
                hasName: Boolean(it.displayName?.S),
                hasHandle: Boolean(it.username?.S),
            });
        }
        lastKey = res.LastEvaluatedKey;
        pages++;
    } while (lastKey && pages < 20);
    if (lastKey) line("  ⚠️ 20ページで打ち切りました（実際はもっと居ます）");

    // `username#<handle>` は @名の予約行で、人ではない
    const profiles = rows.filter((r) => !r.userId.startsWith("username#"));
    const live = profiles.filter((r) => !r.deleted);
    line(`  プロフィールの行: ${profiles.length}（うち退会の墓石 ${profiles.length - live.length}）`);
    line(`  @名の予約行: ${rows.length - profiles.length}`);
    line(`  表示名を設定済み: ${live.filter((r) => r.hasName).length} / ${live.length}`);
    line(`  @名を設定済み: ${live.filter((r) => r.hasHandle).length} / ${live.length}`);

    // 登録の新しい順に日付だけ（`createdAt` は PostConfirmation が入れる。
    // それ以前に登録した人は持っていないので「不明」に落ちる）
    const dated = live.filter((r) => r.createdAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    // **「トリガー導入より前」と言い切らない。**
    //
    // 一度ここに「トリガーが落ちた人も日時を持たない」と書いたが、**誤り**
    // だった——救済する `createProfileIfMissing`（`userProfile.ts`）は
    // `createdAt` を入れる。トリガーが落ちた人は「日時が無い」ではなく
    // **登録より遅い日時を持つ**（本人が最初に自分のプロフィールを開いた時刻）。
    //
    // 日時が無いのは、`0bf83d0` でトリガーを入れる前に登録した人。
    // それでも断定しないのは、**この診断から確かめる手段が無い**ため
    // （Cognito の作成日時と突き合わせれば分かるが、ここでは読んでいない）。
    line(`  登録日時を持つ行: ${dated.length}（残り ${live.length - dated.length} 件は日時なし`
        + " ＝トリガー導入より前に登録した人。Cognito の作成日時とは突き合わせていない）");
    if (dated.length > 0) {
        line("  直近の登録（日付のみ）:");
        for (const r of dated.slice(0, 10)) line(`    ${r.createdAt}`);
    }
}

async function main() {
    PHOTOS_TABLE = requireEnv("PHOTOS_TABLE");
    line(`対象テーブル: ${PHOTOS_TABLE} / region: ${REGION}`);
    for (const [name, fn] of [["indexes", indexes], ["dataShapes", dataShapes], ["cognito", cognito], ["emailChange", emailChange], ["userGroups", userGroups], ["postConfirmationTrigger", postConfirmationTrigger], ["cdnTtl", cdnTtl], ["invalidationHistory", invalidationHistory], ["lambdaRoles", lambdaRoles], ["concurrency", concurrency], ["users", users]]) {
        try {
            await fn();
        } catch (e) {
            // **1つ失敗しても残りは出す。** 診断が途中で止まると、
            // 「権限が足りない1件」のために他の材料まで採れない
            console.error(`  [${name}] 失敗: ${e.name}: ${e.message}`);
        }
    }
    line("\n（この作業は読み取りだけです。何も変更していません）");
}

module.exports = { describeBehavior, humanSeconds, residencyNote, UPLOAD_MAX_AGE, countInvalidationSources, rebuildFnsFromServerless, REBUILD_FNS, reportFunctions, compressNote, errorPageNote, cdnLines, securityHeadersNote, edgeFunctionNote, edgeAssociations, STATIC_PATTERN, publicFnsFromServerless, PUBLIC_FNS, qualify, userGroupLines, triggerLines, inspectTrigger, emailChangeLines };

if (require.main === module) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
