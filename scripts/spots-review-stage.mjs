#!/usr/bin/env node
// scripts/spots-review-stage.mjs
//
// **台帳（content/spots.json）から「人が確かめた」という主張を機械的に外す。**
//
// 2026-09-24、1,417件を書いた Claude のセッションは外部サイトへ出られなかった
// （PR #164 が「到達できない」と明記）のに、全件に `verified: true`・
// `verifiedAt: "2026-09-24"` を書いていた。画面はそれを「情報の最終確認:
// 2026-09-24」と描く。**人は1件も確かめていない。**
//
// このスクリプトは **2026-09-24 に AI が書いた行**（＝旧い `verified` の鍵を
// 持つ行。人が書く行は型から消えたこの鍵を持たない）のうち、`verifiedBy`
// （確かめた人の名前）を持たない行を**下書き（`status: "review"`）** に落とす:
//
//   - `verified` を消す（型からも消えた。`lib/data/spots.ts`）
//   - `verifiedAt` を消す（人の確認日の欄。機械の日付は嘘になる）
//   - `draftedAt`（createdAt の日付部）と `draftedBy: "claude"` を足す
//   - 本文の `**強調**` を剥がす（画面は Markdown を描かない。810件で
//     アスタリスクがそのまま出ていた）
//
// **人が書いた行は触らない。** `verified` を持たない行は、`verifiedAt` が
// あっても消さず、`draftedBy` も付けない（名前の書き忘れは台帳のテストが
// 「verifiedAt があるなら verifiedBy もある」で赤にして知らせる。スクリプトが
// 黙って直すと、人の入力が消える）。強調の剥がしだけは全行に掛ける。
//
// **冪等。** 2回掛けても同じ結果になるので、`--check` をテストから呼んで
// 「verifiedAt や `**` の書き戻し」を二度と入れないようにできる
// （`lib/data/__tests__/spotsLedger.test.ts`）。
//
// 使い方:
//   node scripts/spots-review-stage.mjs            台帳を書き換える
//   node scripts/spots-review-stage.mjs --check    書き換えが要るなら exit 1
//   node scripts/spots-review-stage.mjs --report[=path]
//                                                  owner の確認キューを書き出す
//
// 1,417件を手で触らない。4MB の差分は人が読めないので、スクリプト＋
// テスト＋件数で見る。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LEDGER_PATH = path.join(__dirname, "..", "content", "spots.json");

/** 下書きを書いた主体。台帳の中だけに持つ（画面・アプリには出さない） */
export const DRAFTED_BY = "claude";

/** `**強調**` を剥がす項目（文字列） */
export const TEXT_FIELDS = ["summary", "description"];
/** 同・文字列の配列 */
export const TEXT_ARRAY_FIELDS = ["highlights", "compositionTips", "safetyNotes"];
/** 同・`{ text }` の配列 */
export const TEXT_OBJECT_ARRAY_FIELDS = ["seasonalGuide", "timeOfDayGuide"];

/**
 * `**…**` を剥がす。**`*` 単独や奇数個は触らない**（意図が分からないものは
 * 残して `--report` に出す）。行をまたぐ強調も対象にしない。
 */
export function stripEmphasis(text) {
    if (typeof text !== "string") return text;
    return text.replace(/\*\*([^*\n]+?)\*\*/g, "$1");
}

/** 1件の本文から強調を剥がす（新しいオブジェクトを返す） */
export function stripEmphasisFrom(spot) {
    const out = { ...spot };
    for (const f of TEXT_FIELDS) {
        if (typeof out[f] === "string") out[f] = stripEmphasis(out[f]);
    }
    for (const f of TEXT_ARRAY_FIELDS) {
        if (Array.isArray(out[f])) out[f] = out[f].map(stripEmphasis);
    }
    for (const f of TEXT_OBJECT_ARRAY_FIELDS) {
        if (Array.isArray(out[f])) {
            out[f] = out[f].map((x) => (x && typeof x.text === "string" ? { ...x, text: stripEmphasis(x.text) } : x));
        }
    }
    return out;
}

/** 人が確かめた印を持つか（名前があること。日付だけでは足りない） */
export function hasHumanVerification(spot) {
    return typeof spot.verifiedBy === "string" && spot.verifiedBy.trim().length > 0;
}

/** AI が台帳を書いた日。この日に作られた行だけを「AI の行」と見なす */
export const AI_BATCH_DATE = "2026-09-24";

/**
 * 2026-09-24 に AI が書いた行か。**旧い `verified` の鍵を持ち、その日に
 * 作られたこと**が印。`verified` だけで判定すると、人が古い例を写して
 * `verified: true` を書いた行まで「AI の行」として黙って下書きに落とし、
 * 人の日付が消える。人の行の書き間違いは台帳のテストが赤にして知らせる
 * （「旧い verified の鍵を持つ行は無い」）。
 */
export function isLegacyAiRow(spot) {
    return Object.prototype.hasOwnProperty.call(spot, "verified")
        && String(spot.createdAt ?? "").startsWith(AI_BATCH_DATE);
}

/**
 * 1件を下書きの段階に落とす。
 *
 *   - AI が書いた行でなければ**強調だけ剥がす**（人の入力を消さない）
 *   - AI が書いた行でも確認者を持つなら、旧い `verified` を消すだけ
 *   - それ以外（AI が書き、誰も確かめていない）を review に落とす。
 *     `draft` は `draft` のまま（ページを作らない下書き）
 *
 * 鍵の並びは元の並びを保ち、消した `verified` / `verifiedAt` の位置に
 * `draftedAt` / `draftedBy` を置く（差分を読めるようにするため）。
 */
export function reviewStageOne(spot) {
    const stripped = stripEmphasisFrom(spot);
    if (!isLegacyAiRow(spot)) return stripped;
    if (hasHumanVerification(spot)) {
        const { verified: _legacy, ...rest } = stripped;
        void _legacy;
        return rest;
    }

    const out = {};
    let placed = false;
    const place = () => {
        if (placed) return;
        placed = true;
        out.draftedAt = spot.draftedAt ?? String(spot.createdAt ?? "").slice(0, 10);
        out.draftedBy = spot.draftedBy ?? DRAFTED_BY;
    };
    for (const [k, v] of Object.entries(stripped)) {
        if (k === "verified" || k === "verifiedAt") { place(); continue; }
        if (k === "draftedAt" || k === "draftedBy") { place(); continue; }
        if (k === "status") {
            out.status = v === "published" ? "review" : v;
            place();
            continue;
        }
        out[k] = v;
    }
    place();
    return out;
}

/** 台帳全体。純関数（入力を変えない） */
export function reviewStage(spots) {
    return spots.map(reviewStageOne);
}

/** 書き換えが要るか（冪等性の検査に使う） */
export function needsReviewStage(spots) {
    return JSON.stringify(reviewStage(spots)) !== JSON.stringify(spots);
}

/** 台帳の書式。`JSON.stringify(_, null, 2)` ＋ 改行1つ（現行ファイルと同じ） */
export function formatLedger(spots) {
    return `${JSON.stringify(spots, null, 2)}\n`;
}

// ---- owner の確認キュー -----------------------------------------------------

/** 変わりやすい事実の語。**出典が無いまま本文に書かれている**ものを拾う */
const FACT_WORDS = /駐車|営業時間|開館|閉館|開園|閉園|開門|閉門|所要|規制|通行止|撮影禁止|三脚|ドローン|予約|整理券|立入禁止|入場料|拝観料|料金|運休|運行|時まで|時から|時半/g;
/** 最上級・順位（根拠が要る） */
const SUPERLATIVE_WORDS = /日本一|世界一|最大級|最大|最古|最長|随一|唯一|No\.?\s?1|一番|屈指|三大|百選|トップクラス/g;

function allText(spot) {
    const parts = [];
    for (const f of TEXT_FIELDS) if (typeof spot[f] === "string") parts.push(spot[f]);
    for (const f of TEXT_ARRAY_FIELDS) if (Array.isArray(spot[f])) parts.push(...spot[f]);
    for (const f of TEXT_OBJECT_ARRAY_FIELDS) {
        if (Array.isArray(spot[f])) parts.push(...spot[f].map((x) => x?.text ?? ""));
    }
    return parts.join("\n");
}

function hostOf(url) {
    try { return new URL(url).hostname; } catch { return ""; }
}

/** 確認キュー（Markdown）。**内容は直さない**——何を確かめるべきかを並べるだけ */
export function buildReport(spots) {
    const lines = [];
    lines.push("# 撮影スポット台帳・owner の確認キュー", "");
    lines.push(`全 ${spots.length} 件。確認者（verifiedBy）あり ${spots.filter(hasHumanVerification).length} 件。`, "");

    const facts = [];
    const superlatives = [];
    const oddStars = [];
    const hosts = new Map();
    for (const s of spots) {
        const text = allText(s);
        const f = [...new Set((text.match(FACT_WORDS) ?? []))];
        if (f.length) facts.push(`- ${s.slug}: ${f.join("・")}`);
        const su = [...new Set((text.match(SUPERLATIVE_WORDS) ?? []))];
        if (su.length) superlatives.push(`- ${s.slug}: ${su.join("・")}`);
        if (text.includes("*")) oddStars.push(`- ${s.slug}`);
        const h = hostOf(s.officialWebsiteUrl ?? "");
        if (h) hosts.set(h, [...(hosts.get(h) ?? []), s.slug]);
    }

    lines.push(`## (a) 出典の無い「変わりやすい事実」を本文に含む ${facts.length} 件`, "",
        "駐車場・営業時間・所要時間・交通規制・撮影制限・予約・料金など。owner の",
        "「未確認の…を推測で埋めない」に当たる語を機械で拾ったもの（誤検出あり）。", "",
        ...facts, "");
    lines.push(`## (b) 最上級・順位を含む ${superlatives.length} 件`, "", ...superlatives, "");

    const suspicious = [...hosts.entries()]
        .filter(([h]) => /\.gov\.jp$/.test(h) || !/\.(jp|com|org|net|info|travel|tv|fr|okinawa)$/.test(h))
        .map(([h, slugs]) => `- ${h}: ${slugs.join(", ")}`);
    lines.push(`## (c) 疑わしいドメイン ${suspicious.length} 件`, "",
        "都道府県は `pref.<name>.lg.jp`、市は `city.<name>.<pref>.jp` が普通。`.gov.jp` は国の機関。", "",
        ...suspicious, "");

    const shared = [...hosts.entries()].filter(([, slugs]) => slugs.length >= 5)
        .sort((a, b) => b[1].length - a[1].length)
        .map(([h, slugs]) => `- ${h}（${slugs.length}件）: ${slugs.slice(0, 8).join(", ")}${slugs.length > 8 ? " …" : ""}`);
    lines.push(`## (d) 5件以上で同じ公式 URL を使っている ${shared.length} ドメイン（施設ではなく自治体の玄関）`, "", ...shared, "");

    const sourced = spots.filter((s) => (s.sources ?? []).length > 0)
        .map((s) => `- ${s.slug}: ${(s.sources ?? []).map((x) => `${x.field} ${x.url}`).join(" / ")}`);
    lines.push(`## (e) 出典 URL を持つ ${sourced.length} 件（開いて確かめ、checkedBy を書く）`, "", ...sourced, "");

    lines.push(`## (f) \`*\` が残っている ${oddStars.length} 件（奇数個・入れ子）`, "", ...oddStars, "");
    return `${lines.join("\n")}\n`;
}

// ---- CLI --------------------------------------------------------------------

function main(argv) {
    const args = argv.slice(2);
    const raw = fs.readFileSync(LEDGER_PATH, "utf8");
    const spots = JSON.parse(raw);

    const reportArg = args.find((a) => a.startsWith("--report"));
    if (reportArg) {
        const target = reportArg.includes("=")
            ? reportArg.slice(reportArg.indexOf("=") + 1)
            : path.join(os.tmpdir(), "spots-review-report.md");
        fs.writeFileSync(target, buildReport(spots));
        console.log(`[spots] 確認キューを書きました: ${target}`);
        return 0;
    }

    const next = reviewStage(spots);
    const changed = spots.filter((s, i) => JSON.stringify(s) !== JSON.stringify(next[i])).length;
    if (args.includes("--check")) {
        // 改行コードの違い（CRLF）だけで赤にしない
        const normalized = raw.replace(/\r\n/g, "\n");
        if (changed === 0 && formatLedger(spots) === normalized) {
            console.log("[spots] 台帳は下書きの段階に揃っています");
            return 0;
        }
        console.error(`[spots] 書き換えが要る行: ${changed} 件（node scripts/spots-review-stage.mjs を実行）`);
        return 1;
    }

    fs.writeFileSync(LEDGER_PATH, formatLedger(next));
    const demoted = spots.filter((s, i) => s.status !== next[i].status).length;
    console.log(`[spots] ${changed} 件を書き換え（review に落とした行 ${demoted} 件・全 ${spots.length} 件）`);
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exit(main(process.argv));
}
