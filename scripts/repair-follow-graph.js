/**
 * repair-follow-graph.js — フォロー関係の4種類の行を突き合わせ、食い違いを直す
 *
 * 何が問題か:
 *   フォローは**4種類の行**に分かれて記録されている。
 *
 *     follow#<相手>#<自分>  … 関係そのもの（これが正）
 *     followstats#<uid>     … { followers, following } の数（原子加算）
 *     following#<uid>       … 自分がフォローしている人の並び（画面用）
 *     followers#<uid>       … 自分をフォローしている人の並び（画面用）
 *
 *   1回の書き込みで揃うのは**マーカーと数だけ**（`runMarkerTx`）。
 *   並びの2つは別の書き込みで、しかも `followers#` 側は
 *   `updateFollowersQuietly` が失敗を握る。**ずれる形が最初から入っている。**
 *
 *   さらに `isUserId` を入れる前は ID の形も存在も見ていなかったので、
 *   **でたらめな ID のマーカーが本番に実在する**（2026-09-13 の実測で2件）。
 *   読む側（`follow.ts` の `usableUserIds`）は弾くようにしたが、
 *   **数（`followstats#`）は弾けない**——数は ID を持たない。結果、
 *
 *     ピル「フォロー中 2」→ 押す → 一覧は空 →「一覧はまだ用意できていません」
 *
 *   という、押しても何も出ない状態が**誰にも直せないまま残る**
 *   （解除しようにも、その相手は画面に出ない）。
 *
 * ここでやること（`--apply` のときだけ書く）:
 *   1. 壊れたマーカー（ID が Cognito の sub の形でない）を消す
 *   2. `following#` / `followers#` から、マーカーの無い ID を外す
 *   3. `followstats#` の2つの数を、**マーカーを数えた実測値**に直す
 *
 * ドライラン（既定）は**1行も書かない**。実態を数で出すだけなので、
 * 「なぜ一覧が空なのか」を確かめる道具としてそのまま使える。
 *
 * 使い方:
 *   node scripts/repair-follow-graph.js            # ドライラン（既定）
 *   node scripts/repair-follow-graph.js --apply    # 実行
 *
 * 環境変数:
 *   AWS_REGION    (default: ap-northeast-1)
 *   PHOTOS_TABLE  (必須)
 *
 * 冪等: 何度実行しても安全（2回目は「変更なし」になる）。
 *
 * **承知のうえの限界: Scan から Put までの間に入った書き込みは巻き戻りうる。**
 * `backfill-followers.js` と同じ窓で、こちらは**消す側**なので影響が大きい
 * （走っている最中に成立したフォローを、マーカーごと消しはしないが——
 *  マーカーを消すのは「形が壊れている」ものだけなので新しいフォローは
 *  対象外——`following#` / `followers#` の並びからは外しうる。押し直せば
 *  戻る）。**書き込みの少ない時間に流すこと。**
 *
 * **IDそのものはログに出さない**（診断ログに表示名を書き出した事故がある）。
 * 出すのは件数と理由だけ。
 */

const fs = require("fs");
const path = require("path");
const { requireEnv } = require("./lib/env");
// **規則は借りる。** ID の形とマーカーの分解を書き写すと、片方を直した日に
// 静かにずれる（このリポジトリが何度も踏んでいる形）。
const { parseMarker, SKIP_REASONS } = require("./backfill-followers.js");
// **並びの掃除は「読む側の規則」で見る。** 書き込む側の厳しい規則で
// 外すと、API が通して画面にも出ている ID を一覧から消すことになる
// （＝規則のずれを、直すのではなく実害に変える）
const { apiAccepts } = require("./lib/userId");

const envLocalPath = path.resolve(__dirname, "../.env.local");
if (fs.existsSync(envLocalPath)) {
    for (const line of fs.readFileSync(envLocalPath, "utf8").split("\n")) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
    }
}

/** 行の種別。`follow` で始まる行は5種類あるので、`#` の前で決める */
function rowKind(id) {
    if (typeof id !== "string") return null;
    const head = id.split("#")[0];
    return ["follow", "followstats", "following", "followers", "follownotify"].includes(head) ? head : null;
}

/**
 * 集めた行から「正しい姿」を組む。
 *
 * **正はマーカー。** 数も並びも、マーカーから数え直せる。逆はできない
 * （数は ID を持たず、並びは失敗を握る経路で書かれる）。
 *
 * @returns {{ following: Map<string, Set<string>>, followers: Map<string, Set<string>>, brokenMarkerIds: string[], driftMarkers: number }}
 */
function buildTruth(rows) {
    const following = new Map();   // 自分 → フォローしている人
    const followers = new Map();   // 相手 → フォローしている人たち
    const brokenMarkerIds = [];
    let driftMarkers = 0;
    for (const row of rows) {
        if (rowKind(row.id) !== "follow") continue;
        const m = parseMarker(row);
        if (m.skip) {
            // **規則のずれで弾かれたものは消さない。** API（読む側）が
            // 通す ID なら、それは**本物のフォローかもしれない**。
            // 消すと関係そのものが失われ、押し直すしか戻す手が無い
            // ——しかも相手は画面に出ないので押しようがない。
            // 数えて報告するだけにして、判断は人に渡す
            if (m.skip === SKIP_REASONS.RULE_DRIFT) {
                driftMarkers++;
                // **正しい姿には数える。** 消さないと決めた以上、一覧と数からも
                // 外してはいけない——外すと「消さない」と言いながら、
                // 並びと数の側で同じことをすることになる
                const [, target, follower] = row.id.split("#");
                if (!following.has(follower)) following.set(follower, new Set());
                following.get(follower).add(target);
                if (!followers.has(target)) followers.set(target, new Set());
                followers.get(target).add(follower);
                continue;
            }
            // **`follow: true` を持たない行は「壊れたマーカー」ではない。**
            // 種別で既に絞っているので、ここに来るのは
            // 「`follow#` だが形か ID が違う」だけ。ただし `follow: true` が
            // 無い行（別用途で `follow#` を使った行）を消すと取り返しが
            // つかないので、消す対象は**マーカーだと名乗っている行だけ**
            if (row.follow === true) brokenMarkerIds.push(row.id);
            continue;
        }
        if (!following.has(m.follower)) following.set(m.follower, new Set());
        following.get(m.follower).add(m.target);
        if (!followers.has(m.target)) followers.set(m.target, new Set());
        followers.get(m.target).add(m.follower);
    }
    return { following, followers, brokenMarkerIds, driftMarkers };
}

/**
 * 並びから、マーカーの無い ID を外す。**順序は保つ**（新しい順）。
 * @returns 外したあとの配列。変わらなければ `null`（＝書かない）
 */
function pruneList(list, truthSet) {
    const cur = Array.isArray(list) ? list : [];
    const next = cur.filter((id) => apiAccepts(id) && truthSet.has(id));
    if (next.length === cur.length && next.every((v, i) => v === cur[i])) return null;
    return next;
}

/**
 * 直すべき数の差。**0 と「行が無い」を区別する**——行が無いのに 0 を
 * 書きに行くと、フォローが1件も無い人ぶんの行が新しくできる。
 * @returns `null`（直す必要なし）か `{ followers, following }`
 */
function statsFix(row, truthFollowers, truthFollowing) {
    const cur = {
        followers: typeof row?.followers === "number" ? row.followers : 0,
        following: typeof row?.following === "number" ? row.following : 0,
    };
    if (cur.followers === truthFollowers && cur.following === truthFollowing) return null;
    return { followers: truthFollowers, following: truthFollowing };
}

async function scanFollowRows(ddb, ScanCommand, TABLE) {
    const rows = [];
    let lastKey;
    let scanned = 0;
    do {
        const res = await ddb.send(new ScanCommand({
            TableName: TABLE,
            // `follow` で始まる行だけ持って帰る（写真の行は要らない）
            FilterExpression: "begins_with(id, :p)",
            ExpressionAttributeValues: { ":p": "follow" },
            ProjectionExpression: "id, #f, #l, #fr, #fg, #r",
            ExpressionAttributeNames: {
                "#f": "follow", "#l": "list", "#fr": "followers", "#fg": "following", "#r": "rev",
            },
            ExclusiveStartKey: lastKey,
        }));
        scanned += res.ScannedCount ?? 0;
        for (const item of res.Items ?? []) rows.push(item);
        lastKey = res.LastEvaluatedKey;
    } while (lastKey);
    return { rows, scanned };
}

/**
 * @param deps テスト用の差し込み口（`backfill-followers.js` と同じ形）。
 *   **本番データを書き換えるスクリプトなので `main()` にもテストを当てる。**
 */
async function main(deps) {
    const apply = process.argv.includes("--apply");
    const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
    const TABLE = requireEnv("PHOTOS_TABLE");

    const lib = deps?.lib ?? require("@aws-sdk/lib-dynamodb");
    const { ScanCommand, PutCommand, UpdateCommand, DeleteCommand } = lib;
    let ddb = deps?.ddb;
    if (!ddb) {
        const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
        const raw = new DynamoDBClient({ region: REGION });
        ddb = lib.DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } });
    }

    console.log(`[follow-repair] テーブル: ${TABLE}`);
    console.log(`[follow-repair] モード: ${apply ? "実行" : "ドライラン（--apply で実行）"}\n`);

    const { rows, scanned } = await scanFollowRows(ddb, ScanCommand, TABLE);
    const truth = buildTruth(rows);

    const byKind = new Map();
    for (const row of rows) {
        const k = rowKind(row.id);
        byKind.set(k, (byKind.get(k) ?? 0) + 1);
    }
    let validMarkers = 0;
    for (const set of truth.followers.values()) validMarkers += set.size;

    console.log(`[follow-repair] 走査 ${scanned} 行 / フォロー関係の行 ${rows.length} 件`);
    for (const kind of ["follow", "followstats", "following", "followers", "follownotify"]) {
        console.log(`[follow-repair]   ${kind}#… ${byKind.get(kind) ?? 0} 行`);
    }
    console.log(`[follow-repair] 有効なフォロー ${validMarkers} 件 / 壊れたマーカー ${truth.brokenMarkerIds.length} 件`);
    // **0 でも黙らない。** 出さないと「規則のずれは無い」のか「見ていない」
    // のかが読めない（本番のドライランでまさにそれが読めなかった）
    console.log(`[follow-repair] 規則のずれで保留したマーカー ${truth.driftMarkers} 件`
        + (truth.driftMarkers > 0
            ? "（API は通す ID。**本物のフォローの可能性がある**ので消さず、数にも入れていません）"
            : ""));
    console.log(`[follow-repair] フォローしている人 ${truth.following.size} 人 / されている人 ${truth.followers.size} 人\n`);

    let fixed = 0;
    let unchanged = 0;
    let conflicted = 0;

    // 1. 壊れたマーカーを消す
    for (const id of truth.brokenMarkerIds) {
        console.log("[follow-repair] 壊れたマーカーを削除（IDは出しません）");
        if (!apply) { fixed++; continue; }
        await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { id } }));
        fixed++;
    }

    // 2. 並びから、マーカーの無い ID を外す
    for (const row of rows) {
        const kind = rowKind(row.id);
        if (kind !== "following" && kind !== "followers") continue;
        const uid = row.id.slice(kind.length + 1);
        const truthSet = (kind === "following" ? truth.following : truth.followers).get(uid) ?? new Set();
        const next = pruneList(row.list, truthSet);
        if (!next) { unchanged++; continue; }
        console.log(`[follow-repair] ${kind}#…: ${(row.list ?? []).length} → ${next.length} 人`);
        if (!apply) { fixed++; continue; }
        const rev = typeof row.rev === "number" ? row.rev : 0;
        try {
            await ddb.send(new PutCommand({
                TableName: TABLE,
                Item: { id: row.id, uid, list: next, rev: rev + 1, updatedAt: new Date().toISOString() },
                // **走っている間の書き込みを黙って消さない**（`backfill-followers` と同じ条件）
                ConditionExpression: rev === 0
                    ? "attribute_not_exists(id) OR attribute_not_exists(rev) OR rev = :rev"
                    : "rev = :rev",
                ExpressionAttributeValues: { ":rev": rev },
            }));
            fixed++;
        } catch (e) {
            if (e?.name !== "ConditionalCheckFailedException") throw e;
            console.log(`[follow-repair] ${kind}#…: 競合したので飛ばしました（もう一度流すと入ります）`);
            conflicted++;
        }
    }

    // 3. 数を実測に合わせる。
    //
    // **既にある `followstats#` の行しか触らない。** マーカーから
    // 「この人は 0 人」と分かっても、行が無いなら書く必要が無い
    // （`readStats` は行が無ければ 0 を返す）。書くと、フォローを一度も
    // していない人ぶんの行が新しくできる。
    for (const row of rows) {
        if (rowKind(row.id) !== "followstats") continue;
        const uid = row.id.slice("followstats#".length);
        const fix = statsFix(
            row,
            (truth.followers.get(uid) ?? new Set()).size,
            (truth.following.get(uid) ?? new Set()).size,
        );
        if (!fix) { unchanged++; continue; }
        console.log(
            `[follow-repair] followstats#…: フォロワー ${row.followers ?? 0} → ${fix.followers} / `
            + `フォロー中 ${row.following ?? 0} → ${fix.following}`,
        );
        if (!apply) { fixed++; continue; }
        try {
            await ddb.send(new UpdateCommand({
                TableName: TABLE,
                Key: { id: row.id },
                UpdateExpression: "SET #fr = :nf, #fg = :ng",
                // **読んだときの値のままなら書く。** `statBump` は原子加算なので、
                // 走っている間に1件増えていたら、こちらの実測値は既に古い。
                // 無条件に書くとその1件を消す（数が減って、二度と戻らない）
                ConditionExpression: "attribute_exists(id) AND #fr = :cf AND #fg = :cg",
                ExpressionAttributeNames: { "#fr": "followers", "#fg": "following" },
                ExpressionAttributeValues: {
                    ":nf": fix.followers, ":ng": fix.following,
                    ":cf": typeof row.followers === "number" ? row.followers : 0,
                    ":cg": typeof row.following === "number" ? row.following : 0,
                },
            }));
            fixed++;
        } catch (e) {
            if (e?.name !== "ConditionalCheckFailedException") throw e;
            console.log("[follow-repair] followstats#…: 競合したので飛ばしました（もう一度流すと入ります）");
            conflicted++;
        }
    }

    console.log(`\n[follow-repair] 直した ${fixed} 件 / そのままでよい ${unchanged} 件 / 競合で飛ばした ${conflicted} 件`);
    if (!apply) console.log("[follow-repair] ドライランです。1行も書いていません。--apply で実行します。");
    // **飛ばしたぶんがあれば、黙って終わらない**（`backfill-followers` と同じ）
    if (conflicted > 0) {
        console.error(`[follow-repair] ${conflicted} 件が競合で入っていません。もう一度流してください。`);
        process.exitCode = 1;
    }
}

module.exports = { main, rowKind, buildTruth, pruneList, statsFix };

if (require.main === module) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
