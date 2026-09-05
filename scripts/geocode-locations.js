#!/usr/bin/env node
/**
 * geocode-locations.js
 *
 * 撮影地名（`location`）はあるのに座標（`coords`）が無い写真に、
 * **地名から引いたおおよその座標**を補う（`geoApprox: true` を立てる）。
 *
 * 経緯: 地図ページ（/map）を作ろうとしたら、本番の写真32枚に座標が
 * **1枚も無かった**（`diagnose` 実測 2026-09-05）。アップロードは GPS 付きの
 * 写真なら約1km精度で保存する作りだが、32枚とも GPS を持っていなかった。
 * 一方、撮影地名は半分強に付いている（古い断面で 17/30・14種）。
 * 地名は既に公開している情報なので、その**街の中心**の座標を足しても
 * 新しい情報は漏れない。逆に、GPS 由来の座標（正確）を上書きすることは
 * **絶対にしない**——`attribute_not_exists(coords)` を条件に入れる。
 *
 * 問い合わせ先は OpenStreetMap Nominatim（無料・キー不要）。利用規約に従い、
 * **1リクエスト/秒・識別できる User-Agent・結果は使い回す**。同じ地名は
 * 1回しか引かない（14種なら14回）。
 *
 * 既定はドライラン。`--apply` を付けたときだけ書き込む。冪等
 * （座標のある行は触らない）。
 *
 * 環境変数:
 *   PHOTOS_TABLE   (必須)
 *   GEOCODE_UA     (任意) Nominatim に名乗る User-Agent。既定はサイト名
 *   AWS_REGION     (default: ap-northeast-1)
 */

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { requireEnv } = require("./lib/env");

const REGION = process.env.AWS_REGION ?? "ap-northeast-1";
const APPLY = process.argv.includes("--apply");
/** Nominatim の利用規約: 1リクエスト/秒。余裕を持って 1.1 秒 */
const INTERVAL_MS = 1100;
const UA = process.env.GEOCODE_UA || "journey-photo.com (photo gallery; maintenance script)";

/**
 * 地名を「同じ場所か」を見る鍵に寄せる。
 * 前後の空白・連続する空白・全角空白を整える。大文字小文字は畳まない
 * （地名の表記はそのまま Nominatim に渡す方が当たる）。
 */
function normalizeLocationName(raw) {
    if (typeof raw !== "string") return "";
    return raw.replace(/[\s　]+/g, " ").trim();
}

/**
 * Nominatim の応答から座標を1つ選ぶ。**約1km に丸める**（アップロード側の
 * `sanitizeCoords` と同じ精度。地図の粒度も揃う）。
 * 読めないものは null（呼び出し側は「引けなかった」として飛ばす）。
 */
function pickCoords(json) {
    if (!Array.isArray(json) || json.length === 0) return null;
    const first = json[0];
    const lat = Number(first && first.lat);
    const lng = Number(first && first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}

/**
 * 対象の行を選ぶ（純関数。テストはここに当てる）。
 * 写真（`src` を持つ）で、地名があり、座標が無いもの。ストーリー・
 * 管理用文書（like#/notifs#…）は `src` が無いか `story` なので外れる。
 */
function planTargets(items) {
    const out = [];
    for (const it of items) {
        if (!it || typeof it.src !== "string") continue;
        if (it.story === true) continue;
        if (it.coords && typeof it.coords === "object") continue;   // 正確な座標を上書きしない
        const name = normalizeLocationName(it.location);
        if (!name) continue;
        out.push({ id: it.id, name });
    }
    return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 地名 → 座標。同じ地名は1回しか引かない */
async function geocodeAll(names, fetchImpl = fetch) {
    const result = new Map();
    let first = true;
    for (const name of names) {
        if (!first) await sleep(INTERVAL_MS);
        first = false;
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ja&q=${encodeURIComponent(name)}`;
        try {
            const res = await fetchImpl(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
            if (!res.ok) { console.warn(`  [geocode] ${name}: HTTP ${res.status}`); result.set(name, null); continue; }
            result.set(name, pickCoords(await res.json()));
        } catch (e) {
            console.warn(`  [geocode] ${name}: ${e && e.message}`);
            result.set(name, null);
        }
    }
    return result;
}

async function main() {
    const TABLE = requireEnv("PHOTOS_TABLE");
    console.log(`[geocode] table=${TABLE}`);
    console.log(APPLY ? "[geocode] --apply: 実際に書き込みます" : "[geocode] ドライラン（--apply で実行）");

    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
    const items = [];
    let lastKey;
    do {
        const res = await ddb.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey: lastKey }));
        items.push(...(res.Items ?? []));
        lastKey = res.LastEvaluatedKey;
    } while (lastKey);

    const targets = planTargets(items);
    const names = [...new Set(targets.map((t) => t.name))];
    console.log(`[geocode] ${items.length}件中 ${targets.length}件が「地名あり・座標なし」（地名 ${names.length}種）`);
    if (targets.length === 0) return;

    const coordsByName = await geocodeAll(names);
    let resolved = 0, unresolved = 0, failed = 0;
    for (const name of names) {
        const c = coordsByName.get(name);
        const count = targets.filter((t) => t.name === name).length;
        if (!c) { unresolved++; console.log(`  ✗ ${name}（${count}枚）: 引けなかった`); continue; }
        resolved++;
        console.log(`  ✓ ${name}（${count}枚）→ ${c.lat}, ${c.lng}`);
    }

    if (APPLY) {
        for (const t of targets) {
            const c = coordsByName.get(t.name);
            if (!c) continue;
            try {
                await ddb.send(new UpdateCommand({
                    TableName: TABLE,
                    Key: { id: t.id },
                    // 行が消えていたら作らない・**正確な座標があれば触らない**
                    ConditionExpression: "attribute_exists(id) AND attribute_not_exists(coords)",
                    UpdateExpression: "SET coords = :c, geoApprox = :t",
                    ExpressionAttributeValues: { ":c": c, ":t": true },
                }));
            } catch (e) {
                failed++;
                console.error(`    ${t.id} の書き込みに失敗: ${e.name} ${e.message}`);
            }
        }
    }

    console.log(`\n[geocode] 地名 ${names.length}種のうち 引けた ${resolved}・引けなかった ${unresolved}${APPLY ? ` / 書き込み失敗 ${failed}件` : "（ドライラン）"}`);
    if (resolved > 0 && APPLY) {
        console.log("[geocode] 反映するにはサイトを再ビルドしてください（Deploy Site）。");
    }
    if (failed > 0) process.exit(1);
}

module.exports = { normalizeLocationName, pickCoords, planTargets, geocodeAll, INTERVAL_MS };

if (require.main === module) {
    main().catch((e) => {
        console.error("[geocode] ERROR:", e.message ?? e);
        process.exit(1);
    });
}
