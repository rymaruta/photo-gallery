/**
 * scrub-deleted-names.js — 退会した人の名前の「写し」を、他人の行から伏せる。（2026-10-18・札 #295）
 *
 * **なぜ要るか。** コメント・通知・ストーリーの返信・閲覧者は、書いた時点の表示名を
 * 自分の行に写して持つ。退会してもこの写しは消えず、今は**読むたびに**墓石
 * （users テーブルの `deletedAt` の行）を引いて「退会したユーザー」に伏せている
 * （`api-user/src/notify.ts` の `deletedAmong`）。墓石は `ttl`（退会＋365日）で
 * 消える作りなので、TTL を有効にすると「行が無い＝生きている人」と読まれ、
 * **退会した人の実名が公開の口に戻る**（`api-user/src/account.ts` の
 * `TOMBSTONE_RETENTION_DAYS` の説明）。
 *
 * そこで、墓石が在るうちに写しそのものを書き換える:
 *   - 名前 → `退会したユーザー`（`DELETED_USER_NAME`。`notify.ts` と同じ文字列。
 *     食い違いは `scripts/__tests__/scrubDeletedNames.test.ts` が見張る）
 *   - `deleted: true` を写しに刻む（読む口はこの印をそのまま返すので、
 *     墓石が消えたあとも画面はプロフィールへの導線を出さない）
 *
 * 写しの一覧（どの表のどの属性・どこで写すか）は `docs/tombstone-ttl.md`。
 * この台本が触るのは photos テーブルの次の4種類だけ:
 *   - `comments#<写真ID>`     の `items[].name`   （本人の判定は `items[].uid`）
 *   - `storyreplies#<ID>`     の `items[].name`   （本人の判定は `items[].uid`）
 *   - `notifs#<受け取る人>`   の `items[].byName` （本人の判定は `items[].byId`。
 *                                                  メダルの通知は byId を持たないので触らない）
 *   - ストーリーの行          の `viewers.<閲覧者>.displayName`
 *
 * **生きている人の写しには触らない。** 守りは3重:
 *   1. 対象にするのは、users テーブルを走査して `deletedAt` が文字列の行（墓石）の人だけ
 *   2. 書き込みは**写しの要素1つずつ**（`items[3].name` のように番地で指す）。
 *      配列を丸ごと書き戻さないので、同じ文書の生きている人の要素には一切書かない。
 *      番地の要素がまだその人のもの（`items[3].uid = 退会者`）であることを条件にする
 *      ——読んでから書くまでに通知が先頭へ積まれて番地がずれても、別人の要素は書かない
 *   3. 同じトランザクションで、users テーブルの墓石がまだ在ることを確かめる
 *      （`ConditionCheck`: `attribute_type(deletedAt, S)`）。読んだあとに
 *      `restore-account.js` で戻された人は書かない
 *
 * **既定は読むだけ。** 件数と、読み取り・書き込みの量（読みは実際に使った量、
 * 書きは `--apply` で使う見込み）を出す。`--apply` のときだけ書く。
 * 何度流しても同じ結果になる（伏せ済みの写しは数えない・書かない）。
 *
 * 使い方:
 *   PHOTOS_TABLE=… USERS_TABLE=… node scripts/scrub-deleted-names.js           # 読むだけ
 *   PHOTOS_TABLE=… USERS_TABLE=… node scripts/scrub-deleted-names.js --apply   # 書く
 * 本番に流すのは owner の許可のあと（札 rymaruta/journey.photo-ios#295）。
 */

const { requireEnv } = require("./lib/env");

/** `api-user/src/notify.ts` の `DELETED_USER_NAME` と同じ文字列（テストで突き合わせる） */
const DELETED_USER_NAME = "退会したユーザー";

/**
 * 1回のトランザクションに入れる写しの数の上限。
 * DynamoDB の式は 4KB まで（`#i[123].#n = :m, #i[123].#d = :t` で約 40 字・条件も同じくらい）、
 * 1回のトランザクションは 100 件まで（更新1＋墓石の確かめ＝退会者の人数）。
 * 40 なら式は 2KB 前後、確かめは最大 40 件で両方に余裕がある
 */
const MAX_ENTRIES_PER_WRITE = 40;

/** 配列で写しを持つ文書の種類。`prefix` で始まる ID の行 */
const LIST_KINDS = [
    { kind: "comments", prefix: "comments#", uidField: "uid", nameField: "name" },
    { kind: "storyreplies", prefix: "storyreplies#", uidField: "uid", nameField: "name" },
    { kind: "notifs", prefix: "notifs#", uidField: "byId", nameField: "byName" },
];

/** 行の種類。対象外なら null */
function rowKind(item) {
    const id = typeof item?.id === "string" ? item.id : "";
    for (const k of LIST_KINDS) if (id.startsWith(k.prefix)) return k;
    if (item && typeof item.viewers === "object" && item.viewers !== null && !Array.isArray(item.viewers)) {
        return { kind: "viewers" };
    }
    return null;
}

/** 伏せ済みか（名前が伏せの文字列で、印も立っている） */
function isScrubbed(entry, nameField) {
    return entry?.[nameField] === DELETED_USER_NAME && entry?.deleted === true;
}

/**
 * 1行のうち、伏せるべき写し。
 * @param item     photos テーブルの行
 * @param deleted  退会者の userId の集合
 * @returns `[{ index | key, uid }]`（配列なら番地、閲覧者なら閲覧者の ID）。対象外の行は空
 */
function findScrubs(item, deleted) {
    const k = rowKind(item);
    if (!k) return [];
    const out = [];
    if (k.kind === "viewers") {
        for (const [uid, v] of Object.entries(item.viewers)) {
            if (!deleted.has(uid)) continue;
            // 形の違う値（地図でない）には道を書けない（ValidationException）。名前も持たない
            if (typeof v !== "object" || v === null || Array.isArray(v)) continue;
            if (isScrubbed(v, "displayName")) continue;
            out.push({ key: uid, uid });
        }
        return out;
    }
    const list = Array.isArray(item.items) ? item.items : [];
    list.forEach((entry, index) => {
        const uid = entry?.[k.uidField];
        if (typeof uid !== "string" || !deleted.has(uid)) return;
        if (isScrubbed(entry, k.nameField)) return;
        out.push({ index, uid });
    });
    return out;
}

/**
 * 書き込み（`TransactWriteItems` の中身）を組み立てる。写しが多い行は分ける。
 * @returns トランザクションごとの `TransactItems` の配列
 */
function buildWrites(item, scrubs, tables) {
    const k = rowKind(item);
    if (!k || scrubs.length === 0) return [];
    const out = [];
    for (let s = 0; s < scrubs.length; s += MAX_ENTRIES_PER_WRITE) {
        const chunk = scrubs.slice(s, s + MAX_ENTRIES_PER_WRITE);
        const names = { "#d": "deleted" };
        const values = { ":m": DELETED_USER_NAME, ":t": true };
        const sets = [];
        const conds = [];
        const uids = [...new Set(chunk.map((c) => c.uid))];
        uids.forEach((uid, i) => { values[`:u${i}`] = uid; });
        const uidRef = (uid) => `:u${uids.indexOf(uid)}`;
        if (k.kind === "viewers") {
            names["#v"] = "viewers";
            names["#n"] = "displayName";
            chunk.forEach((c, i) => {
                names[`#k${i}`] = c.key;
                sets.push(`#v.#k${i}.#n = :m`, `#v.#k${i}.#d = :t`);
                // 閲覧者の鍵そのものが退会者の ID。まだ在るときだけ書く
                // （無いのに書くと ValidationException ＝道の途中が無い）
                conds.push(`attribute_exists(#v.#k${i})`);
            });
        } else {
            names["#i"] = "items";
            names["#n"] = k.nameField;
            names["#u"] = k.uidField;
            for (const c of chunk) {
                sets.push(`#i[${c.index}].#n = :m`, `#i[${c.index}].#d = :t`);
                // **番地の要素がまだ退会者のものであること。** 読んでから書くまでに
                // 先頭へ通知が積まれる・コメントが消されると番地がずれる。
                // ずれた先が生きている人の要素なら、ここで外れて何も書かない
                conds.push(`#i[${c.index}].#u = ${uidRef(c.uid)}`);
            }
        }
        const tx = uids.map((uid) => ({
            ConditionCheck: {
                TableName: tables.users,
                Key: { userId: uid },
                // `isDeletedProfile`（`api-user/src/types.ts`）と同じ物差し: deletedAt が文字列
                ConditionExpression: "attribute_type(deletedAt, :s)",
                ExpressionAttributeValues: { ":s": "S" },
            },
        }));
        tx.push({
            Update: {
                TableName: tables.photos,
                Key: { id: item.id },
                UpdateExpression: `SET ${sets.join(", ")}`,
                ConditionExpression: conds.join(" AND "),
                ExpressionAttributeNames: names,
                ExpressionAttributeValues: values,
            },
        });
        out.push(tx);
    }
    return out;
}

/** 行のおおよその大きさ（バイト）。書き込み単位の見込みに使う */
function approxBytes(item) {
    return Buffer.byteLength(JSON.stringify(item ?? {}), "utf8");
}

/**
 * 1回のトランザクションの書き込み単位の見込み。
 * トランザクションの書き込みは通常の2倍（1KB ごとに 2）。
 * 更新は行の大きさで、墓石の確かめは1件あたり 1KB 未満なので 2
 */
function estimateWriteUnits(item, tx) {
    const checks = tx.filter((t) => t.ConditionCheck).length;
    return 2 * Math.max(1, Math.ceil(approxBytes(item) / 1024)) + 2 * checks;
}

async function scanAll(ddb, ScanCommand, input) {
    const items = [];
    let lastKey;
    let scanned = 0;
    let units = 0;
    do {
        const res = await ddb.send(new ScanCommand({ ...input, ExclusiveStartKey: lastKey, ReturnConsumedCapacity: "TOTAL" }));
        scanned += res.ScannedCount ?? 0;
        units += res.ConsumedCapacity?.CapacityUnits ?? 0;
        for (const it of res.Items ?? []) items.push(it);
        lastKey = res.LastEvaluatedKey;
    } while (lastKey);
    return { items, scanned, units };
}

/** 墓石（退会者）を全部読む。打ち切らない（打ち切ると、その先の退会者の写しが残る） */
async function readTombstones(ddb, ScanCommand, USERS_TABLE) {
    const r = await scanAll(ddb, ScanCommand, {
        TableName: USERS_TABLE,
        FilterExpression: "attribute_type(deletedAt, :s)",
        ProjectionExpression: "userId, deletedAt, #ttl",
        ExpressionAttributeNames: { "#ttl": "ttl" },
        ExpressionAttributeValues: { ":s": "S" },
    });
    const deleted = new Set();
    let withoutTtl = 0;
    let earliestTtl;
    for (const it of r.items) {
        if (typeof it.userId !== "string" || typeof it.deletedAt !== "string") continue;
        deleted.add(it.userId);
        if (typeof it.ttl !== "number") withoutTtl++;
        else if (earliestTtl === undefined || it.ttl < earliestTtl) earliestTtl = it.ttl;
    }
    return { deleted, withoutTtl, earliestTtl, scanned: r.scanned, units: r.units };
}

/** 写しを持ちうる行だけ読む（photos テーブルは単一キーなので Scan。絞り込みは返す行を減らすだけ） */
async function readCopyRows(ddb, ScanCommand, PHOTOS_TABLE) {
    return scanAll(ddb, ScanCommand, {
        TableName: PHOTOS_TABLE,
        FilterExpression:
            "begins_with(id, :c) OR begins_with(id, :r) OR begins_with(id, :n) OR attribute_exists(viewers)",
        ExpressionAttributeValues: { ":c": "comments#", ":r": "storyreplies#", ":n": "notifs#" },
    });
}

/**
 * @param deps テスト用の差し込み口（`repair-follow-graph.js` と同じ形）。
 *   **本番データを書き換える台本なので `main()` にもテストを当てる。**
 */
async function main(deps) {
    const apply = process.argv.includes("--apply");
    const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
    const PHOTOS_TABLE = requireEnv("PHOTOS_TABLE");
    const USERS_TABLE = requireEnv("USERS_TABLE");
    const tables = { photos: PHOTOS_TABLE, users: USERS_TABLE };

    const lib = deps?.lib ?? require("@aws-sdk/lib-dynamodb");
    const { ScanCommand, TransactWriteCommand } = lib;
    let ddb = deps?.ddb;
    if (!ddb) {
        const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
        ddb = lib.DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
    }

    console.log(`[scrub-names] テーブル: ${PHOTOS_TABLE} / ${USERS_TABLE}`);
    console.log(`[scrub-names] モード: ${apply ? "実行（--apply）" : "読むだけ（--apply で書く）"}\n`);

    const tomb = await readTombstones(ddb, ScanCommand, USERS_TABLE);
    console.log(`[scrub-names] 墓石（退会者） ${tomb.deleted.size} 人（users を ${tomb.scanned} 行走査）`);
    console.log(`[scrub-names]   ttl を持たない墓石 ${tomb.withoutTtl} 件（TTL を有効にしても消えない）`);
    if (tomb.earliestTtl !== undefined) {
        console.log(`[scrub-names]   いちばん早く期限が来る墓石: ${new Date(tomb.earliestTtl * 1000).toISOString()}`);
    }

    const counts = { comments: 0, storyreplies: 0, notifs: 0, viewers: 0 };
    const rowCounts = { comments: 0, storyreplies: 0, notifs: 0, viewers: 0 };
    let photosScanned = 0;
    let readUnits = tomb.units;
    let writeUnits = 0;
    let txCount = 0;
    let written = 0;
    let conflicted = 0;

    if (tomb.deleted.size > 0) {
        const rows = await readCopyRows(ddb, ScanCommand, PHOTOS_TABLE);
        photosScanned = rows.scanned;
        readUnits += rows.units;
        for (const item of rows.items) {
            const scrubs = findScrubs(item, tomb.deleted);
            if (scrubs.length === 0) continue;
            const kind = rowKind(item).kind;
            counts[kind] += scrubs.length;
            rowCounts[kind]++;
            for (const tx of buildWrites(item, scrubs, tables)) {
                txCount++;
                writeUnits += estimateWriteUnits(item, tx);
                if (!apply) continue;
                try {
                    await ddb.send(new TransactWriteCommand({ TransactItems: tx }));
                    written++;
                } catch (e) {
                    // 条件が外れた（番地がずれた・墓石が戻された・行が消えた）か、
                    // 同じ行への書き込みと競合した。どちらも**書かずに飛ばす**のが正しい。
                    // 番地のずれはもう一度流せば読み直して入る
                    if (e?.name !== "TransactionCanceledException") throw e;
                    console.log(`[scrub-names] ${kind}: 条件が外れたので飛ばしました（もう一度流すと読み直して入ります）`);
                    conflicted++;
                }
            }
        }
    }

    console.log(`\n[scrub-names] photos を ${photosScanned} 行走査`);
    console.log("[scrub-names] 伏せる写し（行数 / 写しの数）:");
    console.log(`[scrub-names]   コメント       comments#…     ${rowCounts.comments} 行 / ${counts.comments} 件`);
    console.log(`[scrub-names]   ストーリー返信 storyreplies#… ${rowCounts.storyreplies} 行 / ${counts.storyreplies} 件`);
    console.log(`[scrub-names]   通知           notifs#…       ${rowCounts.notifs} 行 / ${counts.notifs} 件`);
    console.log(`[scrub-names]   閲覧者         viewers        ${rowCounts.viewers} 行 / ${counts.viewers} 件`);
    console.log(`[scrub-names] 読み取り: ${readUnits} 単位（この回で使った量）`);
    console.log(`[scrub-names] 書き込み: トランザクション ${txCount} 回・約 ${writeUnits} 単位${apply ? "" : "（--apply で使う見込み）"}`);
    if (!apply) {
        console.log("[scrub-names] 読むだけです。1行も書いていません。--apply で書きます。");
        return;
    }
    console.log(`[scrub-names] 書いた ${written} 回 / 条件が外れて飛ばした ${conflicted} 回`);
    if (conflicted > 0) {
        console.error(`[scrub-names] ${conflicted} 回が入っていません。もう一度流してください。`);
        process.exitCode = 1;
    }
}

module.exports = { main, rowKind, findScrubs, buildWrites, estimateWriteUnits, DELETED_USER_NAME, MAX_ENTRIES_PER_WRITE };

if (require.main === module) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
