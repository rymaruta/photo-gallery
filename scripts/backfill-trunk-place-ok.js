/**
 * backfill-trunk-place-ok.js — 本番にもう在る旅のトランクのラベルに「地名を人に見せてよい」印（`o: 1`）を足す。（2026-10-18）
 *
 * 人のトランク（`GET /users/{uid}/trunk`）は**確かめた物だけ見せる**: 印の無いラベルは地名を伏せる
 * （`api-user/src/trunkPlace.ts`）。印を入れる前に配ったラベルには印が無いので、このままでは人に地名が出ない
 * （漏れない側）。それを、写真を1枚ずつ確かめて埋める台本。**流すのは owner の承認のあと。**
 *
 *   node scripts/backfill-trunk-place-ok.js --estimate   # 表の大きさから費用と時間の見積もりだけ（Scan しない）
 *   node scripts/backfill-trunk-place-ok.js              # 読むだけ（何枚に付く・外れるかを数えて出す）
 *   node scripts/backfill-trunk-place-ok.js --apply      # **trunk# の行に書く**
 *
 * 必要な環境変数: PHOTOS_TABLE・USERS_TABLE（判定の関数を読み込むのに要る。USERS_TABLE は読まない）。
 *
 * ## 判定は Lambda と**同じ関数**
 *
 * `api-user/src/trunkPlace.ts` の `storedLabelWithPlaceOk`（＝`placeOkFor`）を tsx で読み込む（写さない）:
 * ラベルの id の写真が**本人の・誰にでも見える公開の写真**（`isPublicListPhoto`）で、撮影地（`placeOf`）が
 * 今もラベルの地名と同じときだけ印を付ける。違えば印を外す。束のラベルは束の最初の1枚（ラベルの id）だけ見る
 * （ほかの兄弟は見ない＝見せない側）。長い鍵の古い形のラベル（`i` が無い）は触らない（印が無いまま＝伏せたまま）。
 *
 * ## 読み方・書き方
 *
 * - photos テーブルを Scan して `trunk#` の行を集める（**全表を読む**。費用は `--estimate` で先に見る）
 * - ラベルの写真を1枚ずつ GetItem（同じ写真は1回）
 * - 書くのは変わる行だけ。**rev 条件で置き直す**（api-user の `updateTrunk` と同じ rev。競合したら読み直して3回まで）
 */

const REGION = "ap-northeast-1";
const PREFIX = "trunk#";
const SHOW = 5;
const WRITE_ATTEMPTS = 3;

/**
 * 1行ぶんの計画（純関数）。`lib` は `trunkPlace` モジュール（テストで差し替えられるように）。
 * `photos` は写真の id → 行（無ければ undefined）。
 * @returns { write, pocket, stuck, added, removed, labels }
 */
function planRow(lib, row, photos) {
    const uid = typeof row.uid === "string" && row.uid ? row.uid : String(row.id).slice(PREFIX.length);
    let added = 0, removed = 0, labels = 0;
    const addedIds = new Set();
    const fix = (list) => (Array.isArray(list) ? list.map((l) => {
        if (!l || typeof l !== "object" || typeof l.i !== "string") return l;
        labels++;
        const next = lib.storedLabelWithPlaceOk(l, photos.get(l.i), uid);
        if (next.o === 1 && l.o !== 1) { added++; addedIds.add(l.i); }
        if (next.o !== 1 && l.o === 1) removed++;
        return next;
    }) : list);
    const pocket = fix(row.pocket);
    const stuck = fix(row.stuck);
    return { write: added + removed > 0, pocket, stuck, added, removed, labels, addedIds: [...addedIds], uid };
}

/** ラベルの写真の id（同じものは1回） */
function photoIdsOf(row) {
    const ids = new Set();
    for (const list of [row.pocket, row.stuck]) {
        if (!Array.isArray(list)) continue;
        for (const l of list) if (l && typeof l.i === "string") ids.add(l.i);
    }
    return [...ids];
}

/**
 * 見積もり（純関数）。Scan は結果整合の読みで 4KB ごとに 0.5 読み取り単位として数える（全表を1回）。
 * 写真の GetItem（強い読み・4KB 以下で1件 1 単位）は、ラベルの枚数が分かってから数える（読むだけの回の出力）。
 * 値段は書かない（地域と課金の形で変わる・owner の課金画面が正）
 */
function estimate({ tableBytes, itemCount }) {
    const scanUnits = Math.ceil(tableBytes / 4096) * 0.5;
    // Scan は1ページ 1MB・1ページおよそ 0.2 秒として
    const seconds = Math.ceil(Math.ceil(tableBytes / (1024 * 1024)) * 0.2);
    return { itemCount, tableBytes, scanUnits, seconds };
}

/**
 * 本体。DynamoDB は `deps.send`（ドキュメントのクライアントの send）と `deps.describe`（表の大きさ）で受け取る
 * （テストで作り物を渡せるように）。`argv` に `--apply` が無ければ**書かない**
 */
async function run({ send, describe, lib, argv, PHOTOS_TABLE, cmds, log = console.log, logError = console.error }) {
    const APPLY = argv.includes("--apply");
    const ESTIMATE = argv.includes("--estimate");
    const { ScanCommand, GetCommand, PutCommand } = cmds;

    // 0) 見積もり（表の大きさは DynamoDB がおよそ6時間ごとに更新する値）
    const table = (await describe()) ?? {};
    const est = estimate({ tableBytes: Number(table.TableSizeBytes ?? 0), itemCount: Number(table.ItemCount ?? 0) });
    log(`表 ${PHOTOS_TABLE}: 約 ${est.itemCount} 件・約 ${(est.tableBytes / 1024 / 1024).toFixed(1)}MB`);
    log(`  Scan の読み取り単位の見積もり: 約 ${est.scanUnits}（全表を1回）・時間: 約 ${est.seconds} 秒`);
    log("  ＋ ラベルの写真1枚につき GetItem（強い読み）1 単位（枚数は読むだけの回で出ます）");
    if (ESTIMATE) return { written: 0 };
    const started = Date.now();

    // 1) trunk# の行を全部（Scan の絞り込みは読んだあとに効く＝全表ぶんを読む）
    const rows = [];
    let lastKey, scanned = 0, consumed = 0;
    do {
        const res = await send(new ScanCommand({
            TableName: PHOTOS_TABLE,
            FilterExpression: "begins_with(id, :p)",
            ExpressionAttributeValues: { ":p": PREFIX },
            ExclusiveStartKey: lastKey,
            ReturnConsumedCapacity: "TOTAL",
        }));
        rows.push(...(res.Items ?? []));
        scanned += res.ScannedCount ?? 0;
        consumed += res.ConsumedCapacity?.CapacityUnits ?? 0;
        lastKey = res.LastEvaluatedKey;
    } while (lastKey);

    const tally = { rows: rows.length, labels: 0, added: 0, removed: 0, toWrite: 0, written: 0, failed: 0, gets: 0, rechecked: 0 };
    const sample = [];
    const cache = new Map();
    // 写真は**強い読み**（いま絞った・非公開にした写真を古い姿で読まない）
    const getPhoto = async (id) => {
        if (cache.has(id)) return cache.get(id);
        tally.gets++;
        const res = await send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id }, ConsistentRead: true, ReturnConsumedCapacity: "TOTAL" }));
        consumed += res.ConsumedCapacity?.CapacityUnits ?? 0;
        cache.set(id, res.Item);
        return res.Item;
    };

    const recheckAdded = async (plan, written) => {
        if (plan.addedIds.length === 0) return;
        const fresh = new Map();
        for (const id of plan.addedIds) {
            const res = await send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id }, ConsistentRead: true }));
            fresh.set(id, res.Item);
            cache.set(id, res.Item);
        }
        let dropped = 0;
        const drop = (list) => (Array.isArray(list) ? list.map((l) => {
            if (!l || l.o !== 1 || !fresh.has(l.i)) return l;
            const next = lib.storedLabelWithPlaceOk(l, fresh.get(l.i), plan.uid);
            if (next.o !== 1) dropped++;
            return next;
        }) : list);
        const pocket = drop(written.pocket), stuck = drop(written.stuck);
        if (dropped === 0) return;
        try {
            await send(new PutCommand({
                TableName: PHOTOS_TABLE,
                Item: { ...written, pocket, stuck, rev: written.rev + 1, updatedAt: new Date().toISOString() },
                ConditionExpression: "rev = :rev",
                ExpressionAttributeValues: { ":rev": written.rev },
            }));
            tally.rechecked += dropped;
        } catch (e) {
            // アプリが先に書いた。外し損ねは本人の GET /user/trunk の外しが拾う（記録だけ）
            tally.failed++;
            logError(`  ${written.id}: 確かめて外す書き込みができませんでした（${e.name}: ${e.message}）`);
        }
    };

    for (let row of rows) {
        for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
            const photos = new Map();
            for (const id of photoIdsOf(row)) photos.set(id, await getPhoto(id));
            const plan = planRow(lib, row, photos);
            if (attempt === 0) {
                tally.labels += plan.labels;
                tally.added += plan.added;
                tally.removed += plan.removed;
                if (plan.write) {
                    tally.toWrite++;
                    if (sample.length < SHOW) sample.push(`${row.id}（+${plan.added} −${plan.removed}）`);
                }
            }
            if (!plan.write || !APPLY) break;
            const rev = typeof row.rev === "number" ? row.rev : 0;
            try {
                await send(new PutCommand({
                    TableName: PHOTOS_TABLE,
                    Item: { ...row, pocket: plan.pocket, stuck: plan.stuck, rev: rev + 1, updatedAt: new Date().toISOString() },
                    ConditionExpression: rev === 0 ? "attribute_not_exists(rev) OR rev = :rev" : "rev = :rev",
                    ExpressionAttributeValues: { ":rev": rev },
                }));
                tally.written++;
                // **書いたあとに確かめる**（Lambda と同じ）: 印を付けた写真だけ強い読みで読み直し、書くまでのあいだに
                // 絞られた・非公開にされた・撮影地が変わったなら外し直す（外すだけ）
                await recheckAdded(plan, { ...row, pocket: plan.pocket, stuck: plan.stuck, rev: rev + 1 });
                break;
            } catch (e) {
                if (e.name !== "ConditionalCheckFailedException" || attempt === WRITE_ATTEMPTS - 1) {
                    tally.failed++;
                    logError(`  ${row.id}: 書けませんでした（${e.name}: ${e.message}）`);
                    break;
                }
                // アプリが先に書いた（あいだに写真を絞った・非公開にしたのかもしれない）。行も写真も強い読みで読み直す
                row = (await send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: row.id }, ConsistentRead: true }))).Item;
                if (!row) break;
                for (const id of photoIdsOf(row)) cache.delete(id);
            }
        }
    }

    const secs = Math.round((Date.now() - started) / 1000);
    log(`trunk# の行 ${tally.rows} 件（Scan で読んだ ${scanned} 件）・ラベル ${tally.labels} 枚`);
    log(`  印が付く: ${tally.added} 枚・外れる: ${tally.removed} 枚・書き直す行: ${tally.toWrite} 件`);
    log(`  写真の GetItem: ${tally.gets} 回・使った読み取り単位: 約 ${consumed.toFixed(1)}・かかった時間: ${secs} 秒`);
    log(`  先頭の ${sample.length} 件: ${sample.join(", ") || "（なし）"}`);
    if (!APPLY) {
        log("  （読むだけ）--apply を付けて流すと書きます。");
        return tally;
    }
    log(`書いた: ${tally.written} 件・書いたあとの確かめで外し直した: ${tally.rechecked} 枚・失敗: ${tally.failed} 件（失敗した行は流し直すと拾えます）`);
    return tally;
}

async function main() {
    const { requireEnv } = require("./lib/env");
    const PHOTOS_TABLE = requireEnv("PHOTOS_TABLE");
    requireEnv("USERS_TABLE", "判定の関数（api-user/src/trunkPlace.ts）を読み込むのに要ります（読みも書きもしません）");
    const { DynamoDBClient, DescribeTableCommand } = require("@aws-sdk/client-dynamodb");
    const ddbLib = require("@aws-sdk/lib-dynamodb");
    const raw = new DynamoDBClient({ region: REGION });
    const ddb = ddbLib.DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } });
    require("tsx/cjs/api").register();
    const lib = require("../api-user/src/trunkPlace");
    await run({
        send: (cmd) => ddb.send(cmd),
        describe: async () => (await raw.send(new DescribeTableCommand({ TableName: PHOTOS_TABLE }))).Table,
        lib, argv: process.argv, PHOTOS_TABLE,
        cmds: { ScanCommand: ddbLib.ScanCommand, GetCommand: ddbLib.GetCommand, PutCommand: ddbLib.PutCommand },
    });
}

module.exports = { planRow, photoIdsOf, estimate, run, main };

if (require.main === module) {
    main().catch((e) => {
        console.error(`失敗: ${e.name}: ${e.message}`);
        process.exit(1);
    });
}
