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
const { CognitoIdentityProviderClient, DescribeUserPoolCommand, DescribeUserPoolClientCommand } = require("@aws-sdk/client-cognito-identity-provider");
const { CloudFrontClient, GetDistributionConfigCommand, GetCachePolicyCommand } = require("@aws-sdk/client-cloudfront");
const { LambdaClient, ListFunctionsCommand, GetAccountSettingsCommand } = require("@aws-sdk/client-lambda");
const { requireEnv } = require("./lib/env");

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
    await count("createdAt を持たない写真（GSI から落ちる）", {
        FilterExpression: "attribute_exists(src) AND attribute_not_exists(createdAt)",
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
function describeBehavior(b, policies) {
    const path = b.PathPattern ?? "(default)";
    // 旧式（ポリシーではなく behavior に直接 TTL を書く形）はそのまま出す
    if (typeof b.DefaultTTL === "number") {
        return `  ${path}: 旧式 defaultTTL=${humanSeconds(b.DefaultTTL)} maxTTL=${humanSeconds(b.MaxTTL)} minTTL=${humanSeconds(b.MinTTL)}`;
    }
    const id = b.CachePolicyId;
    const p = id ? policies.get(id) : undefined;
    if (!p) {
        // **読めなかったことを「TTL はポリシー側」で誤魔化さない。**
        // 権限が無い・ID が無いのどちらかで、どちらも「分かっていない」
        return `  ${path}: cachePolicyId=${id ?? "-"}（ポリシーを読めなかった＝TTL 不明）`;
    }
    return `  ${path}: ${p.name} defaultTTL=${humanSeconds(p.DefaultTTL)} maxTTL=${humanSeconds(p.MaxTTL)} minTTL=${humanSeconds(p.MinTTL)}`;
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

    for (const b of behaviors) line(describeBehavior(b, policies));

    for (const l of residencyNote()) line(l);
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
const PUBLIC_FNS = [
    "getPublicProfile", "searchUsers", "getLikeCount", "getComments", "getFollowStats",
    "getPhotos", "getPhoto",
];
const REBUILD_FNS = ["updatePhotoVisibility", "deleteMyPhoto", "deleteAccount", "updatePhoto", "deletePhoto"];

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

    let publicOk = 0, leaked = 0;
    for (const f of mine.sort((a, b) => a.FunctionName.localeCompare(b.FunctionName))) {
        const short = f.FunctionName.replace(/^photo-gallery(-user)?-api-[^-]+-/, "");
        const role = (f.Role ?? "").split("/").pop() ?? "";
        const hasToken = Boolean(f.Environment?.Variables?.REBUILD_DISPATCH_TOKEN);
        const wantPublic = PUBLIC_FNS.includes(short);
        const wantToken = REBUILD_FNS.includes(short);
        const isPublicRole = /publicRead$/.test(role);
        const flags = [];
        if (wantPublic && !isPublicRole) flags.push("!! 共有ロールのまま");
        if (!wantPublic && isPublicRole) flags.push("!! 読み取り専用ロールが付いている");
        if (hasToken && !wantToken) flags.push("!! 再ビルドのトークンが残っている");
        if (!hasToken && wantToken) flags.push("!! 再ビルドのトークンが無い（削除しても静的ページが残る）");
        if (wantPublic && isPublicRole) publicOk++;
        if (hasToken && !wantToken) leaked++;
        line(`  ${short.padEnd(26)} role=${role}${hasToken ? " REBUILD_DISPATCH_TOKEN=あり" : ""}${flags.length ? "  " + flags.join(" / ") : ""}`);
    }
    line(`  → 読み取り専用ロールの関数 ${publicOk}/${PUBLIC_FNS.length} ・ トークンが余計に付いた関数 ${leaked}`);
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
    for (const [name, fn] of [["indexes", indexes], ["dataShapes", dataShapes], ["cognito", cognito], ["cdnTtl", cdnTtl], ["lambdaRoles", lambdaRoles], ["concurrency", concurrency], ["users", users]]) {
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

module.exports = { describeBehavior, humanSeconds, residencyNote, UPLOAD_MAX_AGE };

if (require.main === module) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
