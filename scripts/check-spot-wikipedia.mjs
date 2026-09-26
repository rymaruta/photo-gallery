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

// 数える単位。**月・時・分・度は数えない**——見頃や時刻は記事に書かれないことが
// 多く、「裏付けなし」ばかりになって一覧が読めなくなる
const UNIT = "(?:メートル|ｍ|m|キロメートル|km|キロ|年|段|本|万本|万株|種|haha|ヘクタール|ha)";
const CLAIM_RE = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT})(?![a-zA-Z])`, "g");

/**
 * 文章に書いた数（高さ・距離・年など）。
 * **10 未満の数は拾わない**（「2本の滝」の類は記事と照らしても意味が薄い）。
 * 同じ数は1つにまとめる。
 */
export function numericClaims(text) {
    const seen = new Map();
    for (const m of normalizeDigits(text).matchAll(CLAIM_RE)) {
        const value = m[1];
        if (Number(value) < 10) continue;
        const unit = m[2] === "ｍ" ? "m" : m[2];
        const key = `${value}${unit}`;
        if (!seen.has(key)) seen.set(key, { value, unit, raw: m[0] });
    }
    return [...seen.values()];
}

/** 数が記事に出てくるか。前後が数字の一部でないこと（`300` が `1300` に当たらない） */
export function articleHasNumber(article, value) {
    const text = normalizeDigits(article);
    // 後ろが `.5` のような小数の続きでも別の数（`300` が `300.5` に当たらない）
    const re = new RegExp(`(?<![\\d.])${value.replace(".", "\\.")}(?!\\d|\\.\\d)`);
    return re.test(text);
}

/** 市町村の探す形。郡を外し、`市`・`町`・`村`・`区` を外した形も候補にする */
export function placeNames(city) {
    if (!city) return [];
    const bare = city.replace(/^.+?郡/, "");
    const stem = bare.replace(/(市|町|村|区)$/, "");
    return [...new Set([city, bare, stem].filter((s) => s.length >= 2))];
}

/** 県・国の探す形（`東京都`→`東京`・`北海道`はそのまま） */
export function regionNames(region) {
    if (!region) return [];
    if (region.country && region.country !== "日本") return [region.country];
    const pref = region.prefecture ?? "";
    const stem = pref === "北海道" ? pref : pref.replace(/(都|府|県)$/, "");
    return [...new Set([pref, stem].filter((s) => s.length >= 2))];
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
 * **最後の語**（`利尻島 姫沼` の `姫沼`）と括弧の中の呼び名だけで、題とどちらかが
 * もう一方を含むこと。「明石」のような共通の欠片だけでは合わせない。
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
    return subjectNames(spot.name).some((n) => n.includes(t) || t.includes(n));
}

/** スポットの文章（数を拾う範囲）。題・要約・説明・見どころ */
function spotText(spot) {
    return [spot.summary, spot.description, ...(spot.highlights ?? [])].filter(Boolean).join("\n");
}

/**
 * 1件を突き合わせる。
 *
 * - `match`       場所・位置・数が全部合う（公開の候補）
 * - `unsupported` 場所と位置は合うが、記事に出てこない数か市町村がある
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
    const missing = claims.filter((c) => !articleHasNumber(text, c.value)).map((c) => c.raw);
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
    return { verdict: "match", ...base };
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
