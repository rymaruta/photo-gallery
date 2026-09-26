/**
 * restore-account.js — 間違えて退会したアカウントを使える状態に戻す。（2026-09-26）
 *
 * 退会（api-user/src/account.ts の deleteAccount）はプロフィールの行を
 * **削除済みの印（墓石: userId・deletedAt・ttl・username）**に置き換える。
 * 以後 GET /user/profile は 410「このアカウントは削除されています」を返す。
 *
 * iOS から退会した場合、**Cognito のアカウント（ログイン）は消えていない**
 * （AccountService はサーバーを呼んでサインアウトするだけ）。なので墓石を
 * 消せば、次にプロフィールを開いたとき createProfileIfMissing が空の行を
 * 作り直し、同じログインのまま使えるようになる。
 *
 * 戻らないもの: 写真の行と実体・アイコン・表示名・自己紹介・ユーザー名・フォロー。
 * これらを戻せるかは、下の「読むだけ」の回で出す材料（PITR・S3 のバージョン）で判断する。
 *
 * 使い方（Maintenance ワークフローの restore-account）:
 *   owner_user_id を空で実行   → 直近24時間の墓石を一覧（読むだけ）
 *   owner_user_id を指定       → その人の墓石・PITR・S3 の残り具合を出す（読むだけ）
 *   owner_user_id ＋ apply     → **その人の墓石を1行だけ消す**（deletedAt があるときだけ）
 */

const { DynamoDBClient, DescribeContinuousBackupsCommand } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, ScanCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");
const { S3Client, GetBucketVersioningCommand, ListObjectVersionsCommand } = require("@aws-sdk/client-s3");
const { requireEnv } = require("./lib/env");

const REGION = "ap-northeast-1";
const PHOTOS_TABLE = requireEnv("PHOTOS_TABLE");
const USERS_TABLE = requireEnv("USERS_TABLE");
const UPLOAD_BUCKET = requireEnv("UPLOAD_BUCKET");
const USER_ID = (process.env.OWNER_USER_ID || "").trim();
const APPLY = process.argv.includes("--apply");

const raw = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(raw);
const s3 = new S3Client({ region: REGION });

async function safe(label, fn) {
    try {
        return await fn();
    } catch (e) {
        console.log(`  ${label}: 読めませんでした（${e.name}: ${e.message}）`);
        return undefined;
    }
}

async function listRecentTombstones() {
    const since = new Date(Date.now() - 24 * 3600e3).toISOString();
    const items = [];
    let key;
    do {
        const r = await ddb.send(new ScanCommand({
            TableName: USERS_TABLE,
            FilterExpression: "deletedAt > :s",
            ExpressionAttributeValues: { ":s": since },
            ProjectionExpression: "userId, deletedAt, username",
            ExclusiveStartKey: key,
        }));
        items.push(...(r.Items ?? []));
        key = r.LastEvaluatedKey;
    } while (key);
    console.log(`直近24時間の墓石: ${items.length} 件`);
    for (const i of items.sort((a, b) => String(a.deletedAt).localeCompare(String(b.deletedAt)))) {
        console.log(`  ${i.deletedAt}  userId=${i.userId}  username=${i.username ?? "（なし）"}`);
    }
}

async function countVersions(prefix) {
    let current = 0;
    let noncurrent = 0;
    let markers = 0;
    let keyMarker;
    let versionMarker;
    do {
        const r = await s3.send(new ListObjectVersionsCommand({
            Bucket: UPLOAD_BUCKET, Prefix: prefix, KeyMarker: keyMarker, VersionIdMarker: versionMarker,
        }));
        for (const v of r.Versions ?? []) {
            if (v.IsLatest) current++;
            else noncurrent++;
        }
        markers += (r.DeleteMarkers ?? []).length;
        keyMarker = r.NextKeyMarker;
        versionMarker = r.NextVersionIdMarker;
    } while (keyMarker);
    return { current, noncurrent, markers };
}

async function inspect(userId) {
    console.log(`対象: userId=${userId}`);
    const row = await safe("プロフィールの行", async () =>
        (await ddb.send(new GetCommand({ TableName: USERS_TABLE, Key: { userId } }))).Item);
    if (!row) {
        console.log("  プロフィールの行: 無い（墓石も無い＝退会していないか、別の ID）");
    } else if (typeof row.deletedAt === "string") {
        console.log(`  プロフィールの行: 墓石（deletedAt=${row.deletedAt}・username=${row.username ?? "なし"}）`);
    } else {
        console.log("  プロフィールの行: 生きている（墓石ではない）");
    }
    for (const t of [USERS_TABLE, PHOTOS_TABLE]) {
        const pitr = await safe(`${t} の PITR`, async () =>
            (await raw.send(new DescribeContinuousBackupsCommand({ TableName: t })))
                .ContinuousBackupsDescription?.PointInTimeRecoveryDescription);
        if (pitr) {
            console.log(`  ${t} の PITR: ${pitr.PointInTimeRecoveryStatus}（最古 ${pitr.EarliestRestorableDateTime?.toISOString?.() ?? "-"}）`);
        }
    }
    const ver = await safe("S3 のバージョニング", async () =>
        (await s3.send(new GetBucketVersioningCommand({ Bucket: UPLOAD_BUCKET }))).Status);
    if (ver !== undefined) console.log(`  S3 のバージョニング: ${ver ?? "一度も有効にしていない"}`);
    for (const prefix of [`uploads/${userId}/`, `profiles/${userId}`]) {
        const c = await safe(`S3 ${prefix}`, () => countVersions(prefix));
        if (c) console.log(`  S3 ${prefix}: 今ある ${c.current}・古い版 ${c.noncurrent}・削除の印 ${c.markers}`);
    }
}

async function removeTombstone(userId) {
    try {
        await ddb.send(new DeleteCommand({
            TableName: USERS_TABLE,
            Key: { userId },
            // **墓石のときだけ消す。** 生きたプロフィールを消してしまわない
            ConditionExpression: "attribute_exists(deletedAt)",
        }));
        console.log(`墓石を消しました: userId=${userId}。アプリでマイページを開き直すと、空のプロフィールが作り直されます`);
    } catch (e) {
        if (e.name === "ConditionalCheckFailedException") {
            console.log("消していません: その行は墓石ではありません（生きているか、行が無い）");
            return;
        }
        throw e;
    }
}

(async () => {
    if (!USER_ID) {
        if (APPLY) {
            console.error("apply には owner_user_id が要ります（誰の墓石を消すか）");
            process.exit(1);
        }
        await listRecentTombstones();
        return;
    }
    await inspect(USER_ID);
    if (APPLY) await removeTombstone(USER_ID);
    else console.log("（読むだけの回。墓石を消すには apply を付けて実行）");
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
