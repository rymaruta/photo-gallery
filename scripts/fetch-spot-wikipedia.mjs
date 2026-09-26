#!/usr/bin/env node
// scripts/fetch-spot-wikipedia.mjs
//
// **撮影スポットの下書きを Wikipedia と照合するための、記事の控えを作る。**（2026-09-26）
//
// 下書き（content/spots.json の status: "review"）は AI が書いて誰も確かめていない。
// 公式サイトはこの環境から開けないので、**Wikipedia の日本語記事**を照合の相手にする。
// ここではその記事を集めるだけで、台帳は触らない。
//
//   NODE_USE_ENV_PROXY=1 node scripts/fetch-spot-wikipedia.mjs --out=<path>
//
// 1. スポットの Wikidata 項目（`content/.spot-images-log.json` の `wikidata`。
//    写真集めで座標を確かめて選んだもの）から、日本語版の記事名を SPARQL で引く
// 2. 記事の本文（平文）と版番号（revid）を 1件ずつ引く。**版番号を残す**のは、
//    照合した文章がどの版に書いてあったかをあとから辿れるようにするため
//
// 記事の本文は CC BY-SA。**リポジトリには入れない**（照合の材料で、配らない）。
// Wikimedia の API は共有の出口 IP を数えて絞る（429）ので、retry-after を待つ。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const LOG_PATH = path.join(ROOT, "content", ".spot-images-log.json");
const USER_AGENT = "JourneyPhotoSpotCheck/1.0 (https://journey-photo.com)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;

async function politeFetch(url, init = {}) {
    for (let attempt = 0; attempt < 10; attempt++) {
        const wait = lastCall + 1200 - Date.now();
        if (wait > 0) await sleep(wait);
        lastCall = Date.now();
        const res = await fetch(url, { ...init, headers: { "User-Agent": USER_AGENT, ...(init.headers ?? {}) } });
        if (res.status === 429 || res.status >= 500) {
            await sleep((Number(res.headers.get("retry-after")) || 5 * (attempt + 1)) * 1000);
            continue;
        }
        return res;
    }
    throw new Error(`応答しません: ${url}`);
}

/** Wikidata の Q番号 → 日本語版の記事名（200件ずつ） */
async function jaTitles(ids) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += 200) {
        const values = ids.slice(i, i + 200).map((id) => `wd:${id}`).join(" ");
        const query = `SELECT ?item ?title WHERE { VALUES ?item { ${values} } ?a schema:about ?item; schema:isPartOf <https://ja.wikipedia.org/>; schema:name ?title }`;
        const res = await politeFetch("https://query.wikidata.org/sparql", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/sparql-results+json" },
            body: new URLSearchParams({ query }),
        });
        for (const b of (await res.json()).results.bindings) {
            out.set(b.item.value.replace(/^.*\//, ""), b.title.value);
        }
    }
    return out;
}

/** 記事1件の本文（平文）と版番号 */
async function article(title) {
    const params = new URLSearchParams({
        action: "query", prop: "extracts|revisions", rvprop: "ids", explaintext: "1",
        titles: title, redirects: "1", format: "json", maxlag: "5",
    });
    const res = await politeFetch(`https://ja.wikipedia.org/w/api.php?${params}`);
    const body = await res.json();
    const page = Object.values(body.query?.pages ?? {})[0];
    if (!page || page.missing !== undefined) return null;
    return {
        title: page.title,
        url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
        revid: page.revisions?.[0]?.revid ?? null,
        text: page.extract ?? "",
    };
}

async function main(argv) {
    const args = argv.slice(2);
    const out = args.find((a) => a.startsWith("--out="))?.slice(6);
    if (!out) {
        console.error("使い方: --out=<保存先の JSON>");
        return 1;
    }
    const log = JSON.parse(fs.readFileSync(LOG_PATH, "utf8"));
    const saved = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : {};
    const bySlug = Object.entries(log).filter(([, v]) => v.wikidata);
    const titles = await jaTitles([...new Set(bySlug.map(([, v]) => v.wikidata))]);
    console.log(`[wikipedia] 日本語版の記事がある項目: ${titles.size} / ${bySlug.length}`);
    let n = 0;
    for (const [slug, v] of bySlug) {
        n++;
        if (saved[slug]) continue;
        const title = titles.get(v.wikidata);
        if (!title) { saved[slug] = { status: "no-article", wikidata: v.wikidata }; continue; }
        try {
            const a = await article(title);
            saved[slug] = a ? { status: "ok", wikidata: v.wikidata, ...a } : { status: "missing", wikidata: v.wikidata, title };
        } catch (e) {
            console.log(`[${n}] ${slug}: ${e.message}`);
            continue;
        }
        if (n % 20 === 0) {
            fs.writeFileSync(out, JSON.stringify(saved));
            console.log(`[${n}/${bySlug.length}]`);
        }
    }
    fs.writeFileSync(out, JSON.stringify(saved));
    const counts = {};
    for (const v of Object.values(saved)) counts[v.status] = (counts[v.status] ?? 0) + 1;
    console.log("[wikipedia] 集計", counts);
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv).then((c) => process.exit(c));
}
