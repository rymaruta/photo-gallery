/**
 * backfill-followers.js — 既にあるフォロー関係から `followers#<uid>` を作る
 *
 * 何が問題か:
 *   これまで持っていたのは「自分がフォローしている人」（`following#<uid>`）と
 *   数（`followstats#<uid>`）だけで、**「誰にフォローされているか」を引ける
 *   行が無かった**。関係の実体は `follow#<相手>#<自分>` のマーカーだが、
 *   このテーブルに**ソートキーは無い**ので前方一致で列挙できない
 *   ——全表 Scan しか手が無く、画面からは引けなかった。
 *
 *   `follow.ts` は今後 `followers#<uid>` を書くが、**既にあるフォロー関係は
 *   誰も書き足さない**（解除→再フォローしない限り入らない）。ここで埋める。
 *
 * ここでやること:
 *   1. 全表を Scan して `follow#` マーカー（`follow: true`）を集める
 *   2. 相手ごとに「新しくフォローされた順」で並べる（`createdAt` 降順）
 *   3. `followers#<相手>` に書く。**既にある行とは併合する**
 *      （このスクリプトが走っている間に入った新しいフォローを消さない）
 *
 * 使い方:
 *   node scripts/backfill-followers.js            # ドライラン（既定）
 *   node scripts/backfill-followers.js --apply    # 実行
 *
 * 環境変数:
 *   AWS_REGION    (default: ap-northeast-1)
 *   PHOTOS_TABLE  (必須)
 *
 * 冪等: 何度実行しても安全（併合するので重複しない）。
 */

const fs = require("fs");
const path = require("path");
const { requireEnv } = require("./lib/env");

const envLocalPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envLocalPath)) {
    for (const line of fs.readFileSync(envLocalPath, "utf8").split("\n")) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
    }
}

/**
 * 一覧の上限。**`api-user/src/follow.ts` の `FOLLOWING_MAX` と同じでなければ
 * ならない**（大きいと 400KB の項目上限に近づき、小さいと埋め戻した直後に
 * サーバー側の書き込みが切り詰めて食い違う）。
 * `scripts/__tests__/followersBackfill.test.ts` が突き合わせる。
 */
const FOLLOWERS_MAX = 2000;

/**
 * Cognito の sub の形。**`api-user/src/userId.ts` と同じ規則**。
 *
 * これを見ないと、`isUserId` を入れる前に作られた**でたらめな ID の
 * マーカー**を拾ってしまう（当時は形も存在も見ていなかった）。拾うと
 *   - `followers#<でたらめ>` という誰も読まない行が新しくできる
 *     （`deleteAccount` は自分の行しか消さないので、消す人がいない）
 *   - でたらめな follower が実在の人の一覧に並び、空のプロフィールへ
 *     リンクする（`0af33008` で直したのと同じ形）
 */
const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** `follow#<target>#<follower>` を分解する。形が違えば null */
function parseMarker(item) {
    if (!item || item.follow !== true || typeof item.id !== "string") return null;
    const parts = item.id.split("#");
    if (parts.length !== 3 || parts[0] !== "follow" || !parts[1] || !parts[2]) return null;
    if (!USER_ID_RE.test(parts[1]) || !USER_ID_RE.test(parts[2])) return null;
    return { target: parts[1], follower: parts[2], createdAt: typeof item.createdAt === "string" ? item.createdAt : "" };
}

/**
 * 相手ごとのフォロワー一覧を組む。**新しい順**（`following#` と同じ並び）。
 * `createdAt` を持たない古いマーカーは末尾へ（空文字は必ず最小）。
 */
function buildFollowers(items) {
    const byTarget = new Map();
    for (const item of items) {
        const m = parseMarker(item);
        if (!m) continue;
        if (!byTarget.has(m.target)) byTarget.set(m.target, []);
        byTarget.get(m.target).push(m);
    }
    const out = new Map();
    for (const [target, list] of byTarget) {
        list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
        out.set(target, list.map((m) => m.follower));
    }
    return out;
}

/**
 * 既にある一覧と併合する。**走っている間に入った新しいフォローを消さない**
 * ——既存を先（新しい順なので先頭が新しい）に置き、足りないぶんを後ろへ。
 */
function mergeFollowers(existing, scanned) {
    const seen = new Set();
    const out = [];
    for (const id of [...existing, ...scanned]) {
        if (typeof id !== "string" || !id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out.slice(0, FOLLOWERS_MAX);
}

/**
 * @param deps テスト用の差し込み口。**本番データに1回だけ流す破壊的な
 *   スクリプトなので、`main()` にもテストを当てる**（`vi.mock` は
 *   関数の中の `require` を確実には掴めなかったので、素直に渡す形にした）。
 */
async function main(deps) {
    const apply = process.argv.includes("--apply");
    const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
    const TABLE = requireEnv("PHOTOS_TABLE");

    const lib = deps?.lib ?? require("@aws-sdk/lib-dynamodb");
    const { ScanCommand, GetCommand, PutCommand } = lib;
    let ddb = deps?.ddb;
    if (!ddb) {
        const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
        const raw = new DynamoDBClient({ region: REGION });
        ddb = lib.DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } });
    }

    console.log(`[followers] テーブル: ${TABLE}`);
    console.log(`[followers] モード: ${apply ? "実行" : "ドライラン（--apply で実行）"}\n`);

    const markers = [];
    let lastKey;
    let scanned = 0;
    do {
        const res = await ddb.send(new ScanCommand({
            TableName: TABLE,
            FilterExpression: "follow = :t",
            ExpressionAttributeValues: { ":t": true },
            ProjectionExpression: "id, createdAt, #f",
            ExpressionAttributeNames: { "#f": "follow" },
            ExclusiveStartKey: lastKey,
        }));
        scanned += res.ScannedCount ?? 0;
        for (const item of res.Items ?? []) markers.push(item);
        lastKey = res.LastEvaluatedKey;
    } while (lastKey);

    const byTarget = buildFollowers(markers);
    console.log(`[followers] 走査 ${scanned} 行 / マーカー ${markers.length} 件 / 対象 ${byTarget.size} 人`);

    let written = 0;
    let unchanged = 0;
    let skipped = 0;
    for (const [target, followers] of byTarget) {
        const cur = await ddb.send(new GetCommand({ TableName: TABLE, Key: { id: `followers#${target}` } }));
        const existing = Array.isArray(cur.Item?.list) ? cur.Item.list : [];
        const next = mergeFollowers(existing, followers);
        if (next.length === existing.length && next.every((v, i) => v === existing[i])) {
            unchanged++;
            continue;
        }
        console.log(`[followers] ${target}: ${existing.length} → ${next.length} 人`);
        if (!apply) continue;
        const rev = typeof cur.Item?.rev === "number" ? cur.Item.rev : 0;
        try {
            await ddb.send(new PutCommand({
                TableName: TABLE,
                Item: {
                    id: `followers#${target}`,
                    uid: target,
                    list: next,
                    // **`rev` は引き継ぐ。** サーバー側は `rev` を条件に書くので、
                    // ここで 0 に戻すと、走っている間の書き込みを黙って上書きする
                    rev: rev + 1,
                    updatedAt: new Date().toISOString(),
                },
                // **条件を付ける。** 読んでから書くまでの間にサーバー側が
                // 1件足すと、無条件の Put はその書き込みを黙って消す
                // ——しかも書く `rev` は相手と同じ値になるので、以後の
                // CAS でも検知されない。落ちたぶんは次に流したときに入る
                ConditionExpression: rev === 0
                    ? "attribute_not_exists(id) OR attribute_not_exists(rev) OR rev = :rev"
                    : "rev = :rev",
                ExpressionAttributeValues: { ":rev": rev },
            }));
            written++;
        } catch (e) {
            if (e?.name !== "ConditionalCheckFailedException") throw e;
            // 走っている間にサーバー側が書いた。**上書きしない**
            console.log(`[followers] ${target}: 競合したので飛ばしました（もう一度流すと入ります）`);
            skipped++;
        }
    }

    console.log(`\n[followers] 書き込み ${written} 人 / 変更なし ${unchanged} 人 / 競合で飛ばした ${skipped} 人`);
    if (!apply) console.log("[followers] ドライランです。--apply で実行します。");
}

module.exports = { main, parseMarker, buildFollowers, mergeFollowers, FOLLOWERS_MAX, USER_ID_RE };

if (require.main === module) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
