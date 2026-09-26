#!/usr/bin/env node
// scripts/check-spot-wikipedia.mjs
//
// **撮影スポットの下書きを Wikipedia の記事と機械で突き合わせる。**（2026-09-26）
//
// 材料は `fetch-spot-wikipedia.mjs` が集めた記事の控え（リポジトリには入れない）。
// ここは**台帳を書き換えない**——突き合わせた結果の一覧を出すだけで、公開に
// 上げるのは owner（`spots-owner-review.mjs --promote --by`）。
//
//   node scripts/check-spot-wikipedia.mjs --articles=<控えの JSON> --out=<結果の JSON>
//
// 見るのは機械で白黒がつくところだけ:
//   1. 場所   台帳の県（海外は国）と市町村が記事に出てくるか
//   2. 位置   台帳の座標が Wikidata の座標と許す距離の内か（写真集めの記録）
//   3. 数字   説明に書いた高さ・距離・年などの数が記事に出てくるか
//
// **「記事に無い」は「間違い」ではない。** 見頃の月や撮り方は Wikipedia に
// 書かれないことが多いので、数字は**記事にある数とだけ**突き合わせ、
// 見つからない数は「裏付けなし」として一覧に出す（嘘と決めつけない）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
export const LEDGER_PATH = path.join(ROOT, "content", "spots.json");
export const LOG_PATH = path.join(ROOT, "content", ".spot-images-log.json");

/** 全角の数字・記号を半角に、桁区切りの `,` を外す（比べる形） */
export function normalizeDigits(text) {
    return String(text ?? "")
        .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
        .replace(/[．]/g, ".")
        // 後ろが単位の字でも外す（`\b` だと `3,911m` の `1m` の間が境目にならず
        // `911m` と読んでいた）
        .replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
}

// 数える単位と、記事の側での書き方。**月・時・分・度は数えない**——見頃や時刻は
// 記事に書かれないことが多く、「裏付けなし」ばかりになって一覧が読めなくなる
const UNIT_FORMS = {
    m: ["メートル", "ｍ", "m"],
    km: ["キロメートル", "km", "㎞", "キロ"],
    年: ["年"],
    段: ["段"],
    万本: ["万本"],
    本: ["本"],
    万株: ["万株"],
    種: ["種"],
    ha: ["ヘクタール", "ha"],
};
/** 書き方 → 単位（長い書き方から当てる。`キロメートル` を `キロ` と読まない） */
const FORM_TO_UNIT = Object.entries(UNIT_FORMS)
    .flatMap(([unit, forms]) => forms.map((f) => [f, unit]))
    .sort((x, y) => y[0].length - x[0].length);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ANY_FORM = FORM_TO_UNIT.map(([f]) => escapeRe(f)).join("|");
const CLAIM_RE = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${ANY_FORM})(?![a-zA-Z])`, "g");
/** 丸めて書かれる量（長さ・面積）。数え物と年は含めない */
const MEASURES = new Set(["m", "km", "ha"]);
const unitOf = (form) => FORM_TO_UNIT.find(([f]) => f === form)?.[1];

/**
 * 文章に書いた数（高さ・距離・年など）と、その単位。
 * **10 未満の数は拾わない**（「2本の滝」の類は記事と照らしても意味が薄い）。
 * 同じ数と単位は1つにまとめる。
 */
export function numericClaims(text) {
    const seen = new Map();
    for (const m of normalizeDigits(text).matchAll(CLAIM_RE)) {
        const value = m[1];
        if (Number(value) < 10) continue;
        const unit = unitOf(m[2]);
        const key = `${value}${unit}`;
        if (!seen.has(key)) seen.set(key, { value, unit, raw: m[0] });
    }
    return [...seen.values()];
}

/**
 * **同じ単位で**その数が記事に出てくるか。
 *
 * - 単位まで見る。数だけ見ると「300本」が「300円」に、「700段」が「樹齢700年」に
 *   当たっていた（実データの match に29件）
 * - 長さ・面積だけ、丸めた数を許す: 説明の「24m」と記事の「24.4メートル」は
 *   同じ数と見る（差が 3% 以内。「約」で丸めて書くため）。**年・段・本は
 *   ぴったりだけ**（3% だと「1959年」が「1933年」に当たる）
 * - 前後が数字の一部でないこと（`300` が `1300` に当たらない）
 */
export function articleHasNumber(article, claim) {
    const text = normalizeDigits(article);
    const target = Number(claim.value);
    for (const m of text.matchAll(CLAIM_RE)) {
        const before = text[m.index - 1];
        if (before && /[\d.]/.test(before)) continue;
        if (unitOf(m[2]) !== claim.unit) continue;
        const found = Number(m[1]);
        if (found === target) return true;
        if (MEASURES.has(claim.unit) && Math.abs(found - target) / target <= 0.03) return true;
    }
    return false;
}

/**
 * 市町村の探す形。郡を外した形も候補にする。
 *
 * **`市`・`町`・`村` を外した短い形は使わない。** `府中` `中央` のような形は
 * たいていの記事に出てくるので、場所の裏付けにならない。
 */
export function placeNames(city) {
    if (!city) return [];
    const bare = city.replace(/^.+?郡/, "");
    return [...new Set([city, bare].filter((s) => s.length >= 2))];
}

/**
 * 県・国の探す形。
 *
 * **`府`・`県` を外した短い形は使わない。** `京都` は `東京都` に含まれる。
 * `東京都` だけは `東京` も認める（記事は「東京の〜」と書くことが多く、
 * `東京` を含む別の県名は無い）。
 */
export function regionNames(region) {
    if (!region) return [];
    if (region.country && region.country !== "日本") return [region.country];
    const pref = region.prefecture ?? "";
    if (!pref) return [];
    return pref === "東京都" ? ["東京都", "東京"] : [pref];
}

/** 名前を比べる形。括弧書き・空白・中黒・鉤括弧・「の」を落とし、異体字と `ヶ/ヵ/ケ` を揃える */
export function subjectKey(name) {
    return String(name ?? "")
        .replace(/[（(][^）)]*[）)]/g, "")
        .replace(/[\s・･　「」『』"“”]/g, "")
        // 「三保の松原」と「三保松原」を同じに
        .replace(/の/g, "")
        .replace(/[圓]/g, "円").replace(/[龍]/g, "竜").replace(/[澤]/g, "沢")
        // 「ヶ」の書き分けだけ揃える。**`ガ` は揃えない**（`ガルニエ` が崩れる）
        .replace(/[ヶヵ]/g, "ケ");
}

/**
 * 記事がそのスポット**そのもの**の記事か。
 *
 * **近くの別の施設・関連する別の記事を弾く。** 写真集めは「名前が近い・座標が
 * 近い」で Wikidata の項目を選ぶので、実データで次のずれがあった:
 *   明石城跡 → 兵庫県立明石公園第一野球場 / 櫛田神社 → 博多祇園山笠（別名に
 *   祭りが入っていた）/ 座間味島 古座間味ビーチ → 座間味島（島の記事）
 * そこで県や数字が合っても、確かめたのは別のものになる。
 *
 * だから**別名は使わない**（関連する別のものが入っている）。比べるのは名前の
 * **最後の語**（`利尻島 姫沼` の `姫沼`）と括弧の中の呼び名だけ。
 */
export function subjectNames(name) {
    const raw = String(name ?? "").trim();
    const inner = [...raw.matchAll(/[（(]([^）)]*)[）)]/g)].map((m) => m[1]);
    const last = raw.replace(/[（(][^）)]*[）)]/g, "").trim().split(/[\s　]+/).pop();
    return [...new Set([last, ...inner].map(subjectKey).filter((n) => n.length >= 2))];
}

export function sameSubject(spot, title) {
    const t = subjectKey(title);
    if (t.length < 2) return false;
    // **題がスポット名を含む向きは認めない。** `神島` に `鳥羽市立神島中学校`、
    // `西海橋` に `新西海橋`、`七里ヶ浜` に `七里ヶ浜駅` が当たっていた。
    // 認めるのは「同じ」か「スポット名が題を含む」（`勝連城跡` と `勝連城`・
    // `史跡足利学校` と `足利学校`）だけで、後者は題が3字以上のとき
    return subjectNames(spot.name).some((n) => n === t || (t.length >= 3 && n.includes(t)));
}

/** スポットの文章（数を拾う範囲）。題・要約・説明・見どころ */
function spotText(spot) {
    return [spot.summary, spot.description, ...(spot.highlights ?? [])].filter(Boolean).join("\n");
}

/**
 * 1件を突き合わせる。
 *
 * - `match`       題・場所・位置が合い、**説明の数が1つ以上、全部**記事と合う
 * - `located`     題・場所・位置は合うが、説明に照らせる数が無い
 *                 （中身は一度も照合していない。`match` と分けて数える）
 * - `unsupported` 題・場所・位置は合うが、記事に出てこない数か市町村がある
 * - `coords`      台帳の座標が記事の場所から遠い（座標を直すまで出さない）
 * - `subject`     記事の題がスポットの名前・別名と合わない（別のものの記事）
 * - `place`       記事に県（国）が出てこない（別の場所の記事の疑い）
 * - `no-article`  日本語の記事が無い・引けなかった
 */
export function checkSpot(spot, logRow, article) {
    if (!article || article.status !== "ok" || !article.text) {
        return { verdict: "no-article" };
    }
    const text = article.text;
    const regionHit = regionNames(spot.region).some((n) => text.includes(n));
    const cityNames = placeNames(spot.region?.city);
    const cityHit = cityNames.length === 0 || cityNames.some((n) => text.includes(n));
    const claims = numericClaims(spotText(spot));
    const missing = claims.filter((c) => !articleHasNumber(text, c)).map((c) => c.raw);
    const base = {
        title: article.title,
        url: article.url,
        revid: article.revid,
        distanceKm: logRow?.distanceKm ?? null,
        claims: claims.length,
        missing,
        cityHit,
    };
    if (!sameSubject(spot, article.title)) return { verdict: "subject", ...base };
    if (!regionHit) return { verdict: "place", ...base };
    if (logRow?.coordsMismatch) return { verdict: "coords", ...base };
    if (!cityHit || missing.length > 0) return { verdict: "unsupported", ...base };
    return { verdict: claims.length > 0 ? "match" : "located", ...base };
}

function main(argv) {
    const args = argv.slice(2);
    const articlesPath = args.find((a) => a.startsWith("--articles="))?.slice(11);
    const out = args.find((a) => a.startsWith("--out="))?.slice(6);
    if (!articlesPath || !out) {
        console.error("使い方: --articles=<控えの JSON> --out=<結果の JSON>");
        return 1;
    }
    const ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
    const log = JSON.parse(fs.readFileSync(LOG_PATH, "utf8"));
    const articles = JSON.parse(fs.readFileSync(articlesPath, "utf8"));
    const results = {};
    const counts = {};
    for (const spot of ledger) {
        if (spot.status !== "review") continue;
        const r = checkSpot(spot, log[spot.slug], articles[spot.slug]);
        results[spot.slug] = { name: spot.name, ...r };
        counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
    }
    fs.writeFileSync(out, JSON.stringify(results, null, 1));
    console.log("[check] 下書きの突き合わせ", counts);
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exit(main(process.argv));
}
