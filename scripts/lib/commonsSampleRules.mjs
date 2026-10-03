// scripts/lib/commonsSampleRules.mjs
//
// **作例（Commons の写真）を選ぶ精度を上げる規則。**（2026-10-03）
//
// `scripts/collect-commons-samples.mjs` が使う純関数だけを置く（通信しない・テストが縛る）。
// 2026-10-03 に全国の自動選定を人の目で見直して 290 枚外した（`content/spot-samples-excluded.json`）。
// そのとき使った判定（題・カテゴリ・説明の語）をここへ移し、次の収集から最初から外す。
//
//   1. 外した一覧（spotId × ファイル）は二度と選ばない          `excludedKeySet`・`isExcluded`
//   2. 駅・車両／料理／室内・展示／看板・店／石碑だけ／人物／夜  `exclusionReasons`
//      ——撮影地そのものが駅・市場・祭りなどのときは外さない（撮影地の名前で例外）
//   3. 撮影地の Wikidata 項目からの当て方                        `parseWikidataEntity`・`SOURCE_BONUS`
//      P18（代表画像）> P373（Commons のカテゴリ）の中 > 半径検索。P180（写っているもの）が
//      撮影地の項目と一致するものも上げる

import fs from "node:fs";

// ---- 外した一覧 ---------------------------------------------------------------

/**
 * ファイル名を比べる形に。"File:" の有無・"_" と空白・頭の大文字小文字・NFC の揺れを吸収する
 * （Wikidata の P18 は "File:" なし、Commons の題は空白、手で書いた一覧は "_" のことがある）
 */
export function fileKey(file) {
    const s = String(file ?? "").normalize("NFC").replace(/_/g, " ").replace(/\s+/g, " ").trim()
        .replace(/^(file|ファイル)\s*:\s*/i, "");
    return s ? s[0].toUpperCase() + s.slice(1) : "";
}

/** 外した一覧（`{spotId, file, reason}` の配列）を引ける形に */
export function excludedKeySet(list) {
    const set = new Set();
    for (const r of Array.isArray(list) ? list : []) {
        if (r?.spotId && r?.file) set.add(`${r.spotId}\n${fileKey(r.file)}`);
    }
    return set;
}

/** このスポットでこのファイルは外したものか */
export function isExcluded(set, spotId, file) {
    return set.has(`${spotId}\n${fileKey(file)}`);
}

/**
 * 外した一覧を読む。**無ければ空**（外したものが無いだけ）。壊れているときは止める
 * ——黙って空にすると、外した写真をまた選んでしまう
 */
export function readExcluded(p) {
    let text;
    try {
        text = fs.readFileSync(p, "utf8");
    } catch (e) {
        if (e?.code === "ENOENT") return new Set();
        throw new Error(`${p} を読めません: ${e?.message ?? e}`);
    }
    try {
        return excludedKeySet(JSON.parse(text));
    } catch (e) {
        throw new Error(`${p} が JSON として読めません（直してから流し直す）: ${e?.message ?? e}`);
    }
}

/** 候補ファイルから、外したものを抜いた写し（元は書き換えない） */
export function withoutExcluded(candidatesFile, set) {
    const spots = {};
    for (const [spotId, entry] of Object.entries(candidatesFile?.spots ?? {})) {
        spots[spotId] = { ...entry, candidates: (entry.candidates ?? []).filter((c) => !isExcluded(set, spotId, c.file)) };
    }
    return { ...candidatesFile, spots };
}

// ---- 題・カテゴリ・説明の語で外す ---------------------------------------------------

/**
 * Python の `\b`（かな・漢字・アクセント付きの字も「語の字」）と同じ境目。
 * JS の `\b` は英数字しか語の字と見ないので、「碑\b」「café\b」が Python と食い違う
 */
const W = String.raw`[\p{L}\p{N}\p{M}_]`;
const PY_B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;
/** Python の正規表現（`re.I`）を同じ意味の JS の正規表現に */
export function pyRegExp(src, flags = "iu") {
    return new RegExp(src.replace(/\\b/g, PY_B), flags);
}

const STN = pyRegExp(String.raw`(?<!power )(?<!transmitting )(?<!police )(?<!fire )(?<!radio )(?<!weather )(?<!pumping )(?<!hydroelectric )(?<!research )(?<!space )(?<!relay )(?<!pump )(?<!drainage pump )(?<!sub)(?<!rest area )(?<!roadside )(?<!road )(?<!observation )\b(railway station|train station|station\b|sta\b|-sta\b|shinkansen|locomotive|rolling stock|rail ?car|\bemu\b|\bdmu\b|tram\b|trams\b|streetcar|trolley|\bbus\b|buses|bus stop|bus terminal|limited express|express train|(?<!from )train\b|trains\b|train line)|駅|電車|列車|車両|気動車|新幹線|バス|路面電車|機関車`);
const FOOD = pyRegExp(String.raw`\b(food|foods|dish|dishes|cuisine|ramen|sushi|soba|udon|meal|meals|lunch|dinner|breakfast|bento|sweets|dessert|cake|ice cream|sashimi|tempura|noodles?|curry|wagashi|mochi|dango|pancakes?|burger|pizza|donburi|shumai|gyoza|oden)\b|料理|弁当|丼|定食|ラーメン|寿司|刺身|スイーツ|団子|グルメ|うどん|餃子|焼売|カレー`);
const IND = pyRegExp(String.raw`\b(interior|interiors|inside of|inside the|exhibit|exhibits|exhibition|exhibited|on display|diorama|museum collection|indoors?|interior of)\b|室内|内部|屋内|展示|収蔵|館内|所蔵`);
const SHOP = pyRegExp(String.raw`\b(hotel|ryokan|hostel|signboard|sign board|information board|notice ?board|billboard|guide ?board|map|maps|vending machine|souvenir|souvenirs|shop|shops|store|restaurant|cafe|café|parking lot|supermarket|convenience store|gift shop|poster)\b|ホテル|旅館|看板|案内板|案内図|地図|自販機|売店|土産|駐車場|ポスター|レストラン|カフェ|食堂`);
const PPL = pyRegExp(String.raw`\b(portrait|cosplay|selfie|group photo|crowd|maiko|geisha|policeman|mascot|yuru-?chara|inauguration|obama|speech|ceremony of|parade of)\b|ポートレート|コスプレ|記念撮影|ゆるキャラ|舞妓|芸妓`);
const MON = pyRegExp(String.raw`\b(stele|stela|stone monument|memorial stone|memorial to|memorial for|monument for|monument commemorating|inscription|plaque|kuhi|sekihi|stone tablet|tombstone|gravestone)\b|石碑|句碑|歌碑|扁額|銘板|碑$|碑\b|の碑|記念碑|慰霊碑|墓`);
const NIGHT = pyRegExp(String.raw`\b(night|at night|nightscape|night view|yoru|notte|nuit|nacht|noche)\b|夜景|夜`);

export const RULE = {
    station: "駅・電車・車両・バス",
    food: "料理・食べ物",
    indoor: "室内・展示物・建物の内部",
    shop: "ホテル・店・看板・案内板・地図",
    people: "人物が主題",
    monument: "石碑・扁額・記念碑のみ",
    night: "夜の暗い写真",
};

/**
 * 規則の一覧。`skip` は**撮影地の名前**に当たれば、その規則を当てない（撮影地そのものが駅・市場・
 * 祭り・碑なら、それが写っているのが正しい）。`desc` は説明（ImageDescription）も見るか
 * ——看板・駅は説明に「〜駅から」「案内板によると」と出やすく、写真の主題でないことが多いので見ない
 */
export const RULES = [
    { name: RULE.station, rx: STN, skip: /駅|ロープウェイ|ケーブル|鉄道|鉄橋|電車|トロッコ|線$|機関車|SL/, cats: true, desc: false },
    { name: RULE.food, rx: FOOD, skip: /料理|グルメ|食堂|ラーメン|寿司|酒造/, cats: true, desc: true },
    { name: RULE.indoor, rx: IND, skip: /資料館|くんち|洞|鍾乳|祭|まつり/, cats: true, desc: true },
    // 看板・店はカテゴリを見ない（"Shops in Kyoto" のような広いカテゴリが風景写真にも付く）
    { name: RULE.shop, rx: SHOP, skip: /ホテル|旅館|宿|温泉|カフェ|道の駅|土産|ショッピング|市場|横丁|商店街|銀座|マーケット|通り$|ロード/, cats: false, desc: false },
    { name: RULE.people, rx: PPL, skip: /舞|祭|まつり|パレード|コスプレ|くんち|ねぶた|ねぷた|花火|ファッション/, cats: true, desc: true },
    { name: RULE.monument, rx: MON, skip: /碑|慰霊|墓|霊園|記念|平和|廟|墳|霊廟|陵/, cats: true, desc: true },
];

/** 夜の写真を外さない撮影地（夜景・ライトアップ・展望・山など＝夜や暗い空が主題になりうる） */
const NIGHT_SPOT = /夜景|イルミ|ライトアップ|夜|花火|ナイト|星|光|展望|山|タワー|ツリー|ヒルズ|スカイ|岳|峰/;

/** 撮影日時の「時」（無ければ undefined） */
export function shotHour(dateTimeOriginal) {
    const m = /(\d{1,2}):(\d{2})/.exec(String(dateTimeOriginal ?? ""));
    return m ? Number(m[1]) : undefined;
}

/** 題: ファイル名から "File:" と拡張子を外したもの（ObjectName ではなくファイル名を見る＝判定を作ったときと同じ） */
function titleOf(c) {
    const f = String(c.file ?? "").replace(/^File:/, "");
    const dot = f.lastIndexOf(".");
    return dot > 0 ? f.slice(0, dot) : f;
}

/** カテゴリの欄（extmetadata は "A|B|C"）を " | " でつないだもの */
function categoriesOf(c) {
    const v = c.categories;
    if (Array.isArray(v)) return v.join(" | ");
    return String(v ?? "").split("|").map((s) => s.trim()).filter(Boolean).join(" | ");
}

/**
 * **作例に向かない理由**（規則の名前・当たった語・どこで当たったか）。空なら外す理由なし。
 * 2026-10-03 に 290 枚を外したときの判定（Python）をそのまま移した。例外の細則も同じ:
 *   - 駅: 長い題（21字以上）の後ろの方（13字目より後）の「駅」は、撮影地の説明（「〜駅から」）と見て外さない
 *   - 駅: "station of"（観測所など）・"triangulation"（三角点）は駅ではない
 *   - 駅: カテゴリだけで当たったときは、カテゴリに "station(s)" の語があるときだけ
 *   - 碑: "natural monument"（天然記念物）は碑ではない
 *   - 夜: 撮影時刻が 6〜17 時なら外さない。00:00 ちょうどは時刻が無いものと見る。"from … night" も外さない
 * @param {{ name?: string }} spot
 * @param {{ file?: string; categories?: string | string[]; description?: string; dateTimeOriginal?: string }} c
 * @returns {Array<{ rule: string; match: string; where: "title" | "cat" | "desc" | "time" }>}
 */
export function exclusionReasons(spot, c) {
    const t = titleOf(c);
    const cats = categoriesOf(c);
    const desc = String(c.description ?? "");
    const name = String(spot?.name ?? "");
    const out = [];
    for (const r of RULES) {
        if (r.skip.test(name)) continue;
        const inTitle = r.rx.exec(t);
        let mm = inTitle ?? (r.cats ? r.rx.exec(cats) : null);
        let where = inTitle ? "title" : "cat";
        if (r.name === RULE.station && mm) {
            if (mm[0] === "駅" && inTitle && inTitle.index > 12 && t.length > 20) mm = null;
            else if (/station of|triangulation/i.test(t)) mm = null;
            else if (!inTitle && !/\bstations?\b/i.test(cats)) mm = null;
        }
        if (r.name === RULE.monument && mm && /natural monument/i.test(t)) mm = null;
        if (!mm && r.desc) {
            const d = r.rx.exec(desc);
            if (d && !(r.name === RULE.monument && /natural monument/i.test(desc))) { mm = d; where = "desc"; }
        }
        if (mm) out.push({ rule: r.name, match: mm[0], where });
    }
    if (!NIGHT_SPOT.test(name)) {
        const dt = String(c.dateTimeOriginal ?? "");
        const h = shotHour(dt);
        const k = NIGHT.exec(t) ?? NIGHT.exec(cats) ?? NIGHT.exec(desc);
        const daytime = h !== undefined && h >= 6 && h <= 17;
        const noTime = h === 0 && dt.includes("00:00");
        const fromNight = /\bfrom\b.*night|night.*\bfrom\b/i.test(t);
        if (k && !daytime && !noTime && !fromNight) out.push({ rule: RULE.night, match: k[0], where: "time" });
    }
    return out;
}

/** 点数の理由に付ける頭（`autoEligible` はこれで始まる理由があれば採らない） */
export const EXCLUDE_PREFIX = "除外:";

// ---- Wikidata からの当て方 ------------------------------------------------------

/**
 * 当て方ごとの加点。**P18（代表画像）は必ず最上位**（ほかの全部を足しても届かない幅）、
 * 次に P373（撮影地の Commons のカテゴリ）の中、P180（写っているもの）が撮影地と一致するもの。
 * どれも「撮影地を写した写真」と人が付けた印なので、名前の一致と同じく自動で採ってよい（`named`）。
 * 半径検索だけで見つかった写真は加点なし（名前が当たらなければ自動で採らない、は今までどおり）。
 * カテゴリ（+8）・P180（+6）は、半径検索で名前が当たった写真（正式名 +4・近い +1 がふつう）より上に来る幅。
 * ただし横長・解像度などの点も足すので、順位は絶対ではない（縦長で小さいカテゴリの写真は下がる）
 */
export const SOURCE_BONUS = { p18: 30, category: 8, depicts: 6 };
export const SOURCE_REASON = { p18: "代表画像（P18）", category: "カテゴリ（P373）", depicts: "写っているもの（P180）" };

/**
 * Wikidata の項目（wbgetentities の entities の1件）から、探すのに使うものを取り出す。
 *   coords   P625（座標）——探す中心を足す
 *   image    P18（代表画像）のファイル名（"File:" 付きに揃える）
 *   category P373（Commons のカテゴリ）の名前（"Category:" なし）
 */
export function parseWikidataEntity(e) {
    const val = (p) => e?.claims?.[p]?.find((s) => s?.rank !== "deprecated")?.mainsnak?.datavalue?.value;
    const out = {};
    const co = val("P625");
    if (co && typeof co.latitude === "number") out.coords = { lat: co.latitude, lng: co.longitude };
    const img = val("P18");
    if (typeof img === "string" && img.trim()) out.image = `File:${fileKey(img)}`;
    const cat = val("P373");
    if (typeof cat === "string" && cat.trim()) out.category = cat.trim().replace(/^Category:/i, "");
    return out;
}

/** 写っているもの（P180）で撮影地の項目を探す検索語（Commons の構造化データ） */
export function depictsSearch(qid) {
    return `haswbstatement:P180=${qid}`;
}
