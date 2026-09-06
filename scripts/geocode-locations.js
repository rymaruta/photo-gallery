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
 *   GEOCODE_SKIP   (任意) 飛ばす地名（セミコロン区切り）。当て違いと分かったものを
 *                  この回だけ外す。**恒久的な直しは撮影者が編集画面から選ぶ**
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
 * 場所として使えない当たりを外す。
 *
 * Nominatim は道路・建物・番地も返す。「福岡」で**富山県の県道**が
 * 返ったのがそれで、知名度だけで選ぶと街より道路が勝つことがある。
 * ただし撮影地には施設そのもの（「高屋神社」「国営ひたち海浜公園」）も
 * あるので、**捨てるのではなく最後に回す**。
 */
const WEAK_TYPES = new Set(["road", "house", "house_number", "postcode", "railway", "junction", "motorway", "trunk", "primary", "secondary", "tertiary", "residential", "unclassified", "service", "track", "path", "footway"]);

/**
 * Nominatim の応答から座標を1つ選ぶ。**約1km に丸める**（アップロード側の
 * `sanitizeCoords` と同じ精度。地図の粒度も揃う）。
 *
 * **先頭ではなく `importance` が最大のものを採る。** 最初の本番ドライランで
 * 「福岡」が富山県の福岡町（36.71, 136.93）、「土谷棚田」が名古屋近郊に
 * 当たった。Nominatim の並びは文字の一致を優先するので、有名な同名の街
 * より小さな町が先頭に来ることがある。`importance` は知名度の指標なので、
 * 5件の中で最大を採れば福岡市（33.59, 130.40）側へ倒れる。
 * 読めないものは null（呼び出し側は「引けなかった」として飛ばす）。
 * `label` は確認用の表示名（ドライランで人が目で確かめる材料）。
 */
function pickCoords(json) {
    if (!Array.isArray(json) || json.length === 0) return null;
    let best = null;
    for (const r of json) {
        if (!r || typeof r !== "object") continue;
        const lat = Number(r.lat);
        const lng = Number(r.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
        const importance = Number(r.importance);
        const base = Number.isFinite(importance) ? importance : -1;
        // 道路・番地は「場所」としては弱い。捨てずに最後へ回す
        const type = typeof r.addresstype === "string" ? r.addresstype : (typeof r.type === "string" ? r.type : "");
        const score = WEAK_TYPES.has(type) ? base - 1 : base;
        if (!best || score > best.score) {
            best = { score, lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100, label: typeof r.display_name === "string" ? r.display_name : "" };
        }
    }
    if (!best) return null;
    return { lat: best.lat, lng: best.lng, label: best.label };
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

/**
 * 引けた結果が**その地名の話か**を見る。2回目の本番ドライランで
 * 「土谷棚田」（長崎県）が名古屋市の図書館に当たった——Nominatim は何かを
 * 返そうとするので、知らない地名でも別の場所が返る。表示名に地名の語が
 * 1つも入っていなければ「引けなかった」扱いにする。
 * 語は空白・中黒・括弧・読点・スラッシュで切り、1文字の語は見ない（「（パリ）」の
 * ように補足だけが一致する形は許す）。英数字は大小を同一視する。
 * 語が1つも取れない地名・表示名が無いときは判定しない（通す）。
 *
 * **限界**: 表記の種類が違うと正しい結果も弾く——「Paris」に対して日本語の
 * 表示名「パリ, …」が返る／「ベルサイユ」と「ヴェルサイユ」／空白を含まない
 * 複合語（「鎌倉大仏」→「高徳院」）。倒れる先は「書かない」で、ログに
 * 表示名が出るので人が見て判断できる。今の本番の地名（日本語・単純な形）は
 * 全部通ることをドライランで確認した。
 */
function looksRelated(name, label) {
    if (typeof label !== "string" || !label) return true;
    const fold = (v) => v.toLowerCase();
    const tokens = String(name).split(/[\s　・,、()（）/／【】「」]+/).filter((t) => t.length >= 2).map(fold);
    if (tokens.length === 0) return true;
    const hay = fold(label);
    return tokens.some((t) => hay.includes(t));
}

/**
 * 飛ばす地名（`GEOCODE_SKIP`、**セミコロン区切り**）。同名の別の場所に当たる
 * ものは機械では見分けられない（「福岡」→ 富山県の福岡町。表示名にも「福岡」が
 * 入る）。ドライランで目で見て外す。撮影地名を「福岡市」のように直せば次の
 * 実行で拾える。
 * カンマで区切らないのは、地名そのものにカンマが入るため（本番に
 * 「パリ, フランス」がある。カンマで割ると**それは残り、無関係な「パリ」と
 * 「フランス」が飛ぶ**——レビュー指摘）。
 */
function skipSet(raw) {
    return new Set(String(raw ?? "").split(";").map((v) => normalizeLocationName(v)).filter(Boolean));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 地名 → 座標。同じ地名は1回しか引かない */
async function geocodeAll(names, fetchImpl = fetch) {
    const result = new Map();
    let first = true;
    for (const name of names) {
        if (!first) await sleep(INTERVAL_MS);
        first = false;
        // 5件取って知名度で選ぶ（`pickCoords` を参照）
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=ja&q=${encodeURIComponent(name)}`;
        try {
            const res = await fetchImpl(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
            if (!res.ok) { console.warn(`  [geocode] ${name}: HTTP ${res.status}`); result.set(name, null); continue; }
            const picked = pickCoords(await res.json());
            if (picked && !looksRelated(name, picked.label)) {
                console.warn(`  [geocode] ${name}: 別の場所に当たった（${picked.label}）`);
                result.set(name, null);
                continue;
            }
            result.set(name, picked);
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

    const skip = skipSet(process.env.GEOCODE_SKIP);
    const all = planTargets(items);
    const targets = all.filter((t) => !skip.has(t.name));
    const names = [...new Set(targets.map((t) => t.name))];
    console.log(`[geocode] ${items.length}件中 ${all.length}件が「地名あり・座標なし」（地名 ${new Set(all.map((t) => t.name)).size}種）`);
    if (skip.size) {
        console.log(`[geocode] 飛ばす地名（GEOCODE_SKIP・; 区切り）: ${[...skip].join(" / ")} → 対象 ${targets.length}件・${names.length}種`);
        // 1件にも当たらない指定は綴りの違い。黙って進むと「飛ばしたつもり」で書く
        for (const k of skip) if (!all.some((t) => t.name === k)) console.warn(`  [geocode] GEOCODE_SKIP「${k}」に一致する地名は無い（綴りを確認）`);
    }
    if (targets.length === 0) return;

    const coordsByName = await geocodeAll(names);
    let resolved = 0, unresolved = 0, failed = 0;
    for (const name of names) {
        const c = coordsByName.get(name);
        const count = targets.filter((t) => t.name === name).length;
        if (!c) { unresolved++; console.log(`  ✗ ${name}（${count}枚）: 引けなかった`); continue; }
        resolved++;
        // 表示名を添える。地名の当て違い（同名の小さな町など）は数字では
        // 分からないので、ドライランで人が読む
        console.log(`  ✓ ${name}（${count}枚）→ ${c.lat}, ${c.lng}  ${c.label}`);
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
                    ExpressionAttributeValues: { ":c": { lat: c.lat, lng: c.lng }, ":t": true },   // label は保存しない
                }));
            } catch (e) {
                failed++;
                console.error(`    ${t.id} の書き込みに失敗: ${e.name} ${e.message}`);
            }
        }
    }

    console.log(`\n[geocode] 地名 ${names.length}種のうち 引けた ${resolved}・引けなかった ${unresolved}${APPLY ? ` / 書き込み失敗 ${failed}件` : "（ドライラン）"}`);
    // **引けなかったものは、次にやることまで書く。** 出力を見た人が
    // そのまま直せるように、足す先と書き方を示す
    const stuck = names.filter((n) => !coordsByName.get(n));
    if (stuck.length) {
        // **ここで機械が粘らない。** 同名の別の場所はどちらが正しいか
        // 撮影者しか知らない（「福岡」が福岡市か富山県の福岡町か）。
        // 写真の編集画面に「この場所名で候補を出す」があるので、そちらへ回す
        console.log("\n[geocode] 引けなかった地名（撮影者が編集画面から選べます）:");
        for (const n of stuck) console.log(`    ${n}`);
        console.log("    /user/edit を開く →「地図に出す位置」→「この場所名で候補を出す」→ 選ぶ");
    }
    if (resolved > 0 && APPLY) {
        console.log("[geocode] 反映するにはサイトを再ビルドしてください（Deploy Site）。");
    }
    if (failed > 0) process.exit(1);
}

module.exports = { normalizeLocationName, pickCoords, planTargets, geocodeAll, looksRelated, skipSet, INTERVAL_MS };

if (require.main === module) {
    main().catch((e) => {
        console.error("[geocode] ERROR:", e.message ?? e);
        process.exit(1);
    });
}
