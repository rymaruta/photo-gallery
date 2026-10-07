// scripts/export-spots-json.ts
//
// **ビルドを回さずに、アプリ向けの索引 JSON を書き出す。**
//
//   npx tsx scripts/export-spots-json.ts <出力ディレクトリ>
//
// 中身は `app/app/data/spots.json/route.ts` が配るものと**同じ関数**
// （`lib/data/spotFeed.ts`）から出る。iOS のテスト用 fixture や、owner が
// 手元で読むための一覧を、`next build`（約10分）無しで作るための口。
//
// GitHub Actions は使わない。Web のデプロイも要らない。

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spotIndexFeed, spotIndexFeedJson } from "../lib/data/spotFeed";
import { spotFeedFileJson, spotFeedFiles } from "../lib/data/spotFeedShards";

const outDir = resolve(process.argv[2] ?? "out-spots");
mkdirSync(join(outDir, "app", "data"), { recursive: true });
const target = join(outDir, "app", "data", "spots.json");
writeFileSync(target, spotIndexFeedJson());
const items = spotIndexFeed();
const drafts = items.filter((s) => s.stage === "review").length;
console.log(`[spots] ${target}: ${items.length} 件（下書き ${drafts}・公開 ${items.length - drafts}）`);

// 数を増やした置き場（`/app/data/spot-feed/`・2026-10-07・`docs/spot-feed-sharding.md`）
const feedDir = join(outDir, "app", "data", "spot-feed");
mkdirSync(feedDir, { recursive: true });
let feedBytes = 0;
for (const file of spotFeedFiles()) {
    const json = spotFeedFileJson(file)!;
    feedBytes += Buffer.byteLength(json, "utf8");
    writeFileSync(join(feedDir, file), json);
}
console.log(`[spots] ${feedDir}: ${spotFeedFiles().length} ファイル（索引と区分）・計 ${feedBytes} バイト`);
