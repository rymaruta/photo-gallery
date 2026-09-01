/**
 * normalize-image-urls.js
 *
 * DynamoDB に保存された画像URLのホスト名を、配信に使うURLへ揃える。
 *
 * 経緯: サムネ生成（generate-thumbnails.js）が CloudFront の既定ドメインを
 * URL の土台にしていたため、同じサイトの画像が2つのホスト名で保存された。
 * 実測で30件中11件が d1s3dwwzgxf5ni.cloudfront.net、19件が journey-photo.com。
 * サイトマップは両方を <image:loc> に載せるので画像のインデックスが2ホストに
 * 割れ、訪問者にも余計な DNS+TLS が1往復増える。
 * 以後の書き込みは PUBLIC_BASE_URL（= siteUrl）に直したので、
 * ここは**既に保存されているぶん**の後片付け。
 *
 * 既定はドライラン。--apply を付けたときだけ書き込む。
 * 冪等（既に揃っているものは触らない）。
 *
 * 環境変数:
 *   PHOTOS_TABLE     (必須)
 *   PUBLIC_BASE_URL  (必須) 揃える先。例: https://journey-photo.com
 *   OLD_HOSTS        (任意) 置き換え元のホスト名。カンマ区切り。
 *                    未指定なら「PUBLIC_BASE_URL 以外のホスト」を全部対象にする。
 *   AWS_REGION       (default: ap-northeast-1)
 *
 * **パスは変えない。** 変えるのはホスト名だけで、S3 のキーは同じものを指す。
 * 読み取り側（keyFromSrc / deriveUploadKey）はパスしか見ないので、
 * 揃える前後どちらのURLでも削除・派生生成は同じ実体に届く。
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { requireEnv } = require("./lib/env");

const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
const TABLE = requireEnv("PHOTOS_TABLE");
const BASE = requireEnv("PUBLIC_BASE_URL").replace(/\/$/, "");
const OLD_HOSTS = (process.env.OLD_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const APPLY = process.argv.includes("--apply");

/** 揃える対象のフィールド。mediaKeys.MEDIA_FIELDS と同じ並び */
const URL_FIELDS = [
    "src", "srcOriginal", "srcAvif", "src256",
    "thumbSrc", "thumbSm", "thumbAvif", "thumbSmAvif",
];

/**
 * URL のホスト名だけを BASE に揃える。変える必要が無ければ null。
 *
 * - URL として読めないもの、http(s) でないものは触らない
 * - **パスとクエリはそのまま**。ここでエンコードし直すと、保存時の検証と
 *   食い違って削除の対象から外れる余地が生まれる（過去に踏んだ形）
 * - OLD_HOSTS を指定した場合はそのホストだけを対象にする
 */
function normalizeUrl(value, base = BASE, oldHosts = OLD_HOSTS) {
    if (typeof value !== "string" || !value) return null;
    let u;
    try { u = new URL(value); } catch { return null; }
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    let b;
    try { b = new URL(base); } catch { return null; }
    if (u.host === b.host && u.protocol === b.protocol) return null;   // 既に揃っている
    if (oldHosts.length > 0 && !oldHosts.includes(u.host)) return null; // 対象外のホスト
    return `${b.origin}${u.pathname}${u.search}`;
}

/** item から「揃え直すフィールド」を集める */
function changesFor(item, base = BASE, oldHosts = OLD_HOSTS) {
    const out = {};
    for (const f of URL_FIELDS) {
        const next = normalizeUrl(item[f], base, oldHosts);
        if (next) out[f] = next;
    }
    return out;
}

async function main() {
    console.log(`[normalize] table=${TABLE} base=${BASE}${OLD_HOSTS.length ? ` oldHosts=${OLD_HOSTS.join(",")}` : ""}`);
    console.log(APPLY ? "[normalize] --apply: 実際に書き換えます" : "[normalize] ドライラン（--apply で実行）");

    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
    const items = [];
    let lastKey;
    do {
        const res = await ddb.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: lastKey }));
        items.push(...(res.Items ?? []));
        lastKey = res.LastEvaluatedKey;
    } while (lastKey);

    // 写真とストーリーだけ。like#/notifs# などの管理用文書は URL を持たない
    const targets = items.filter((it) => URL_FIELDS.some((f) => typeof it[f] === "string"));
    console.log(`[normalize] ${items.length}件中 ${targets.length}件が画像URLを持っています`);

    let changed = 0;
    let failed = 0;
    for (const item of targets) {
        const changes = changesFor(item);
        const fields = Object.keys(changes);
        if (fields.length === 0) continue;
        changed++;
        console.log(`  ${item.id}`);
        for (const f of fields) console.log(`    ${f}: ${item[f]}\n      → ${changes[f]}`);
        if (!APPLY) continue;
        try {
            await ddb.send(new UpdateCommand({
                TableName: TABLE,
                Key: { id: item.id },
                // 行が消えていたら作らない（UpdateItem はキーが無ければ作る）
                ConditionExpression: "attribute_exists(id)",
                UpdateExpression: "SET " + fields.map((f, i) => `#f${i} = :v${i}`).join(", "),
                ExpressionAttributeNames: Object.fromEntries(fields.map((f, i) => [`#f${i}`, f])),
                ExpressionAttributeValues: Object.fromEntries(fields.map((f, i) => [`:v${i}`, changes[f]])),
            }));
        } catch (e) {
            failed++;
            console.error(`    書き換えに失敗: ${e.name} ${e.message}`);
        }
    }

    console.log(`\n[normalize] 対象 ${changed}件${APPLY ? ` / 失敗 ${failed}件` : "（ドライラン）"}`);
    if (changed > 0 && APPLY) {
        console.log("[normalize] 反映するにはサイトを再ビルドしてください（Deploy Site）。");
    }
    if (failed > 0) process.exit(1);
}

module.exports = { normalizeUrl, changesFor, URL_FIELDS };

if (require.main === module) {
    main().catch((e) => {
        console.error("[normalize] ERROR:", e.message ?? e);
        process.exit(1);
    });
}
