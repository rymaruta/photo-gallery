/**
 * backfill-likes.js — 既にあるいいねから `likes#<uid>` を作る
 *
 * 何が問題か:
 *   「いいねした写真」のページは**この端末の localStorage しか見ていなかった**。
 *   サーバーが持っているのは `like#<写真ID>#<自分>` のマーカーだけで、
 *   このテーブルに**ソートキーは無い**ので前方一致で列挙できない
 *   ——全表 Scan しか手が無く、画面からは引けなかった。
 *
 *   実際に owner が踏んだ: スマホで押したいいねを PC で開くと 0 件。
 *   同じ写真のページは**マーカーを見る**ので「いいね済み」と出る
 *   ＝同じアカウントで画面どうしが食い違っていた。
 *
 *   `likes.ts` は今後 `likes#<uid>` を書くが、**既にあるいいねは誰も
 *   書き足さない**（解除→もう一度いいね しない限り入らない）。ここで埋める。
 *
 * ここでやること:
 *   1. 全表を Scan して `like#` マーカー（`like: true`）を集める
 *   2. 人ごとに「新しくいいねした順」で並べる（`createdAt` 降順）
 *   3. `likes#<uid>` に書く。**既にある行とは併合する**
 *      （このスクリプトが走っている間に押されたいいねを消さない）
 *
 * 使い方:
 *   node scripts/backfill-likes.js            # ドライラン（既定）
 *   node scripts/backfill-likes.js --apply    # 実行
 *
 * 環境変数:
 *   AWS_REGION    (default: ap-northeast-1)
 *   PHOTOS_TABLE  (必須)
 *
 * 冪等: 何度実行しても安全（併合するので重複しない）。
 *
 * **承知のうえの限界: 走っている間の「解除」は復活しうる。**
 * `Scan` から `Put` までの間に解除が起きると、古い Scan の結果を書き戻す
 * ——`mergeIds` は足すだけで消さないので、一覧に幽霊が残る。
 * ただし**害は小さい**: 一覧は表示用の索引で、いいね済みかどうかは
 * マーカーが決める（`GET /user/likes/{id}`）。残った幽霊は、その写真が
 * 手元の一覧に居れば「いいねした写真」に1枚多く出るだけで、
 * もう一度いいね→解除すれば消える。**書き込みの少ない時間に流すこと。**
 */

const fs = require("fs");
const path = require("path");
const { requireEnv } = require("./lib/env");
const { USER_ID_RE } = require("./lib/userId");

const envLocalPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envLocalPath)) {
    for (const line of fs.readFileSync(envLocalPath, "utf8").split("\n")) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
    }
}

/**
 * 一覧の上限。**`api-user/src/likes.ts` の `LIKED_MAX` と同じでなければ
 * ならない**（大きいと 400KB の項目上限に近づき、小さいと埋め戻した直後に
 * サーバー側の書き込みが切り詰めて食い違う）。
 * `scripts/__tests__/likesBackfill.test.ts` が突き合わせる。
 */
const LIKED_MAX = 1000;

/**
 * 捨てた理由。**「マーカー N 件・対象 0 人」を黙って出さないため。**
 * `backfill-followers.js` が本番で「マーカー 2 件 / 対象 0 人」を出し、
 * **正しくゴミを弾いたのか本物を取りこぼしたのか読めなかった**のと同じ型。
 *
 * **IDそのものは出さない**（診断ログに本番の sub を残した事故がある）。
 */
const SKIP_REASONS = {
    NOT_MARKER: "like: true を持たない",
    SHAPE: "like#<写真ID>#<自分> の形でない",
    NOT_USER_ID: "利用者IDが Cognito の sub の形でない",
};

/** `like#<photoId>#<uid>` を分解する。形が違えば `{ skip: 理由 }` */
function parseMarker(item) {
    if (!item || item.like !== true || typeof item.id !== "string") return { skip: SKIP_REASONS.NOT_MARKER };
    const parts = item.id.split("#");
    if (parts.length !== 3 || parts[0] !== "like" || !parts[1] || !parts[2]) return { skip: SKIP_REASONS.SHAPE };
    // **写真IDの形は要求しない。** 採番が変わった時代の写真も拾いたいので、
    // 見るのは「空でないこと」と「`#` を含まないこと」（split が保証）だけ。
    // 利用者IDは、でたらめな値で `likes#<ゴミ>` という誰も読まない行を
    // 作らないために形を見る（`backfill-followers.js` と同じ理由）
    if (!USER_ID_RE.test(parts[2])) return { skip: SKIP_REASONS.NOT_USER_ID };
    return { photoId: parts[1], uid: parts[2], createdAt: typeof item.createdAt === "string" ? item.createdAt : "" };
}

/**
 * 人ごとの「いいねした写真」を組む。**新しい順**（サーバー側と同じ並び）。
 * `createdAt` を持たない古いマーカーは末尾へ（空文字は必ず最小）。
 */
function buildLikes(items) {
    const byUser = new Map();
    const skipped = new Map();
    for (const item of items) {
        const m = parseMarker(item);
        if (m.skip) {
            skipped.set(m.skip, (skipped.get(m.skip) ?? 0) + 1);
            continue;
        }
        if (!byUser.has(m.uid)) byUser.set(m.uid, []);
        byUser.get(m.uid).push(m);
    }
    const out = new Map();
    for (const [uid, list] of byUser) {
        list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
        out.set(uid, list.map((m) => m.photoId));
    }
    out.skipped = skipped;
    return out;
}

/**
 * 既にある一覧と併合する。**走っている間に押されたいいねを消さない**
 * ——既存を先（新しい順なので先頭が新しい）に置き、足りないぶんを後ろへ。
 */
function mergeIds(existing, scanned) {
    const seen = new Set();
    const out = [];
    for (const id of [...existing, ...scanned]) {
        if (typeof id !== "string" || !id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out.slice(0, LIKED_MAX);
}

/**
 * @param deps テスト用の差し込み口。**本番データに1回だけ流す破壊的な
 *   スクリプトなので、`main()` にもテストを当てる**（`backfill-followers.js`
 *   と同じ形）。
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

    console.log(`[likes] テーブル: ${TABLE}`);
    console.log(`[likes] モード: ${apply ? "実行" : "ドライラン（--apply で実行）"}\n`);

    const markers = [];
    let lastKey;
    let scanned = 0;
    do {
        const res = await ddb.send(new ScanCommand({
            TableName: TABLE,
            FilterExpression: "#l = :t",
            ExpressionAttributeValues: { ":t": true },
            ProjectionExpression: "id, createdAt, #l",
            ExpressionAttributeNames: { "#l": "like" },
            ExclusiveStartKey: lastKey,
        }));
        scanned += res.ScannedCount ?? 0;
        for (const item of res.Items ?? []) markers.push(item);
        lastKey = res.LastEvaluatedKey;
    } while (lastKey);

    const byUser = buildLikes(markers);
    console.log(`[likes] 走査 ${scanned} 行 / マーカー ${markers.length} 件 / 対象 ${byUser.size} 人`);
    // **数が合わないときは、必ず理由を出す**（「対象 0 人」が
    // 「いいねが無い」なのか「全部弾いた」なのか読めなくなる）
    for (const [reason, count] of byUser.skipped) {
        console.log(`[likes]   捨てた: ${count} 件（${reason}）`);
    }

    let written = 0;
    let unchanged = 0;
    let skippedRows = 0;
    for (const [uid, photoIds] of byUser) {
        const cur = await ddb.send(new GetCommand({ TableName: TABLE, Key: { id: `likes#${uid}` } }));
        const existing = Array.isArray(cur.Item?.list) ? cur.Item.list : [];
        const next = mergeIds(existing, photoIds);
        if (next.length === existing.length && next.every((v, i) => v === existing[i])) {
            unchanged++;
            continue;
        }
        // **IDは出さない**（人も写真も。件数だけで足りる）
        console.log(`[likes] ある人の一覧: ${existing.length} → ${next.length} 枚`);
        if (!apply) continue;
        const rev = typeof cur.Item?.rev === "number" ? cur.Item.rev : 0;
        try {
            await ddb.send(new PutCommand({
                TableName: TABLE,
                Item: {
                    id: `likes#${uid}`,
                    uid,
                    list: next,
                    // **`rev` は引き継ぐ。** サーバー側は `rev` を条件に書くので、
                    // ここで 0 に戻すと、走っている間の書き込みを黙って上書きする
                    rev: rev + 1,
                    updatedAt: new Date().toISOString(),
                },
                // 読んでから書くまでの間にサーバー側が1件足した場合、
                // 無条件の Put はその書き込みを黙って消す
                ConditionExpression: rev === 0
                    ? "attribute_not_exists(id) OR attribute_not_exists(rev) OR rev = :rev"
                    : "rev = :rev",
                ExpressionAttributeValues: { ":rev": rev },
            }));
            written++;
        } catch (e) {
            if (e?.name !== "ConditionalCheckFailedException") throw e;
            console.log("[likes] ある人の一覧: 競合したので飛ばしました（もう一度流すと入ります）");
            skippedRows++;
        }
    }

    console.log(`\n[likes] 書き込み ${written} 人 / 変更なし ${unchanged} 人 / 競合で飛ばした ${skippedRows} 人`);
    if (!apply) console.log("[likes] ドライランです。--apply で実行します。");
    // **飛ばしたぶんがあれば、黙って終わらない**（exit 0 だと「済んだ」と誤読する）
    if (skippedRows > 0) {
        console.error(`[likes] ${skippedRows} 人ぶんが競合で入っていません。もう一度流してください。`);
        process.exitCode = 1;
    }
}

module.exports = { main, parseMarker, buildLikes, mergeIds, LIKED_MAX, SKIP_REASONS };

if (require.main === module) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
