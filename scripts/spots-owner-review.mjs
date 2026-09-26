#!/usr/bin/env node
// scripts/spots-owner-review.mjs
//
// **owner が下書きを確かめて公開する経路。**（2026-09-26）
//
// 台帳の下書き 1,413件を owner が1件ずつ公式サイトと見比べる。見比べる画面は
// claude.ai のアーティファクト「撮影スポット確認帳」で、そこで押した判定
// （公開してよい／直してほしい）をこのスクリプトが台帳へ戻す:
//
//   node scripts/spots-owner-review.mjs --export=<dir>
//       確認帳に載せるデータ（都道府県ごとの JSON と索引）を書き出す
//   node scripts/spots-owner-review.mjs --promote=<reviews.json> --by=<人の名前>
//       「公開してよい」を押された下書きを `status: "published"` にする
//
// 🔴 **押したあとに文章が変わった行は上げない。** 確認帳は各行の中身の指紋
// （`spotContentHash`）を判定と一緒に保存する。上げるときに台帳の今の指紋と
// 突き合わせ、違えば「確かめた文章と違う」として飛ばす（確認帳の側も
// 「内容が変わった」として未確認に戻す）。owner が読んでいない文章を
// owner の名前で公開しないため。
//
// `verifiedBy` は人の名前だけ（AI の名前は `spotsLedger.test.ts` が拒む）。
// ここでも `--by` に AI の名前を渡したら止める。

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    LEDGER_PATH, formatLedger, TEXT_FIELDS, TEXT_ARRAY_FIELDS, TEXT_OBJECT_ARRAY_FIELDS,
} from "./spots-review-stage.mjs";

/** 都道府県の並び（JIS の順）。確認帳の左の列がこの順になる */
export const PREFECTURES = [
    "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
    "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
    "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
    "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
    "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
    "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
    "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];
/** 国内の都道府県に当たらない行（海外）の見出し */
export const ABROAD = "海外";

/** 出典（`checkedBy` つき）が要る項目。`lib/utils/spotGuide.ts` の `SOURCED_FIELDS` と同じ */
export const SOURCED_FIELDS = ["access", "parking", "safetyNotes"];

/** `verifiedBy` に書かせない名前（`spotsLedger.test.ts` と同じ考え方） */
const AI_NAMES = /claude|anthropic|gpt|openai|assistant|\bai\b|bot/i;

/**
 * **owner が読む中身の指紋。** 確認帳が画面に出すもの（名前・公式サイト・
 * 本文の全項目・地図の点）が1文字でも変われば変わる。
 */
export function spotContentHash(spot) {
    const parts = [spot.name ?? "", spot.officialWebsiteUrl ?? ""];
    for (const f of TEXT_FIELDS) parts.push(typeof spot[f] === "string" ? spot[f] : "");
    for (const f of TEXT_ARRAY_FIELDS) parts.push(...(Array.isArray(spot[f]) ? spot[f] : []));
    for (const f of TEXT_OBJECT_ARRAY_FIELDS) {
        parts.push(...(Array.isArray(spot[f]) ? spot[f].map((x) => x?.text ?? "") : []));
    }
    parts.push(spot.coords ? `${spot.coords.lat},${spot.coords.lng}` : "");
    return crypto.createHash("sha1").update(parts.join("␞")).digest("hex").slice(0, 16);
}

function groupOf(spot) {
    const pref = spot.region?.prefecture;
    return PREFECTURES.includes(pref) ? pref : ABROAD;
}

const EXPORT_FIELDS = [
    "slug", "name", "reading", "address", "category", "summary", "description", "highlights",
    "seasonalGuide", "timeOfDayGuide", "compositionTips", "safetyNotes", "officialWebsiteUrl", "coords",
];

/**
 * 確認帳のデータ。**下書き（`review`）だけ**を都道府県ごとに分ける
 * （全件を1本にすると 3MB——スマホで開くたびに落ちてくる）。
 */
export function buildReviewData(spots) {
    const groups = new Map();
    for (const s of spots) {
        if (s.status !== "review") continue;
        const g = groupOf(s);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(s);
    }
    const order = [...PREFECTURES.filter((p) => groups.has(p)), ...(groups.has(ABROAD) ? [ABROAD] : [])];
    const files = {};
    const prefs = order.map((name, i) => {
        const id = `p${String(i + 1).padStart(2, "0")}`;
        const rows = groups.get(name)
            .slice()
            .sort((a, b) => (a.reading ?? a.slug).localeCompare(b.reading ?? b.slug, "ja"))
            .map((s) => {
                const row = {};
                for (const k of EXPORT_FIELDS) {
                    const v = s[k];
                    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
                    row[k] = v;
                }
                const r = s.region ?? {};
                row.city = name === ABROAD
                    ? [r.country, r.prefecture, r.city].filter(Boolean).join(" ")
                    : (r.city ?? "");
                row.hash = spotContentHash(s);
                return row;
            });
        files[id] = rows;
        return { id, name, count: rows.length, slugs: rows.map((r) => r.slug) };
    });
    return { index: { total: prefs.reduce((n, p) => n + p.count, 0), prefs }, files };
}

/**
 * 確認帳の保存形（`reviews/<都道府県の id>` の `items`）を1枚に畳む。
 * 受け取る形: `{ p01: { items: {...} }, ... }`・`{ p01: {...} }`・
 * `[{ id, data: { items } }]`（ArtifactData の読み出しをそのまま保存したもの）
 */
export function flattenReviews(raw) {
    const out = {};
    const docs = Array.isArray(raw)
        ? raw.map((d) => d?.data ?? d)
        : Object.values(raw ?? {});
    for (const doc of docs) {
        const items = doc?.items ?? doc;
        if (!items || typeof items !== "object") continue;
        for (const [slug, r] of Object.entries(items)) {
            if (r && typeof r === "object" && "verdict" in r) out[slug] = r;
        }
    }
    return out;
}

/**
 * 「公開してよい」の下書きを公開に上げる。**台帳の今の指紋と合う行だけ。**
 *
 * - 上げるのは `status: "review"` の行だけ（公開済み・他の状態は触らない）
 * - `verifiedBy` は `by`（人の名前）、`verifiedAt` は**押した日**（今日ではない）
 * - 出典が要る項目（注意点など）を持つ行は、公式サイトを出典として
 *   `checkedBy` つきで足す。確認帳はその項目も公式サイトと見比べる対象として
 *   画面に出している
 */
export function promoteReviewed(spots, reviews, { by, today }) {
    if (!by || !by.trim()) throw new Error("--by（確かめた人の名前）が要ります");
    if (AI_NAMES.test(by)) throw new Error(`--by に AI の名前は書けません: ${by}`);
    const promoted = [];
    const skipped = [];
    const next = spots.map((s) => {
        const r = reviews[s.slug];
        if (!r || r.verdict !== "ok") return s;
        if (s.status !== "review") {
            skipped.push({ slug: s.slug, reason: `status が ${s.status}` });
            return s;
        }
        if (r.hash !== spotContentHash(s)) {
            skipped.push({ slug: s.slug, reason: "確かめた後に文章が変わった（確認帳で再確認）" });
            return s;
        }
        const day = /^\d{4}-\d{2}-\d{2}/.test(r.at ?? "") ? r.at.slice(0, 10) : today;
        const sources = Array.isArray(s.sources) ? [...s.sources] : [];
        for (const field of SOURCED_FIELDS) {
            if (s[field] === undefined) continue;
            const has = sources.some((x) => x.field === field && x.checkedBy?.trim());
            if (has || !s.officialWebsiteUrl) continue;
            sources.push({ field, url: s.officialWebsiteUrl, title: s.name, checkedAt: day, checkedBy: by });
        }
        promoted.push(s.slug);
        const out = { ...s, status: "published", verifiedBy: by, verifiedAt: day, updatedAt: `${today}T00:00:00.000Z` };
        if (sources.length) out.sources = sources;
        return out;
    });
    return { next, promoted, skipped };
}

// ---- CLI --------------------------------------------------------------------

function argValue(args, name) {
    const a = args.find((x) => x.startsWith(`--${name}=`));
    return a ? a.slice(name.length + 3) : null;
}

function main(argv) {
    const args = argv.slice(2);
    const spots = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));

    const exportDir = argValue(args, "export");
    if (exportDir) {
        const { index, files } = buildReviewData(spots);
        fs.mkdirSync(exportDir, { recursive: true });
        fs.writeFileSync(path.join(exportDir, "index.json"), JSON.stringify(index));
        for (const [id, rows] of Object.entries(files)) {
            fs.writeFileSync(path.join(exportDir, `${id}.json`), JSON.stringify(rows));
        }
        console.log(`[spots] 確認帳のデータを書きました: ${exportDir}（${index.prefs.length} 区分・${index.total} 件）`);
        return 0;
    }

    const promoteFile = argValue(args, "promote");
    if (promoteFile) {
        const reviews = flattenReviews(JSON.parse(fs.readFileSync(promoteFile, "utf8")));
        const today = new Date().toISOString().slice(0, 10);
        const { next, promoted, skipped } = promoteReviewed(spots, reviews, { by: argValue(args, "by"), today });
        fs.writeFileSync(LEDGER_PATH, formatLedger(next));
        console.log(`[spots] 公開に上げた: ${promoted.length} 件`);
        for (const s of skipped) console.log(`[spots] 飛ばした: ${s.slug}（${s.reason}）`);
        return 0;
    }

    console.error("使い方: --export=<dir> か --promote=<reviews.json> --by=<名前>");
    return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exit(main(process.argv));
}
