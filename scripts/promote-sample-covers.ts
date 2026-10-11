// scripts/promote-sample-covers.ts
//
// **作例から代表写真を埋める。**（2026-10-11・owner「検索で見つけてもらう」「写真が無くても役立つ撮影ガイド」）
//
// 公開済みのスポットのうち、代表写真（`content/spot-images.json`・Wikidata の P18）が無い・場所の確認が
// 無くて出せないものに、作例（`content/spot-samples.json`）から1枚を代表写真に上げる。
//
//   npx tsx scripts/promote-sample-covers.ts --dry-run       数えるだけ（書かない・取りにいかない）
//   npx tsx scripts/promote-sample-covers.ts                 上げる（縮小版を Commons から1枚ずつ取って置く）
//   npx tsx scripts/promote-sample-covers.ts --limit=50      先頭から 50 件だけ
//   npx tsx scripts/promote-sample-covers.ts --slug=a,b      指定のスポットだけ
//
// - **選ぶのは `coverCandidateSample`**（`lib/data/spotSamples.ts`）。写真を1枚ずつ見てその撮影地の
//   景色と確かめた作例（`pickedBy` が "visual-review" か人の名前）だけ。"auto"（名前の一致だけ）は上げない
// - **置くのは `localize-spot-images.mjs` と同じ処理**（`localizeImage`・横 960px の JPEG・EXIF は残さない）
// - 取りにいくのは Commons の縮小版（作例が画面で既に読んでいる URL）だけ。**3秒に1回・1本だけ**。
//   429 は待って取り直す（`localize-spot-images.mjs` の `download`）。止まっても同じコマンドで続きから
// - 画面・アプリ・構造化データに出すかの判定は `shownSpotImage`（`method: "commons-sample"` は
//   `isReviewedPick` を満たす行だけ）。出典（作者・ライセンス・Commons のページ）は必ず一緒に出る

import fs from "node:fs";
import path from "node:path";
import { SPOTS } from "../lib/data/spots";
import { spotCoverImage, SAMPLE_COVER_METHOD, type SpotImage } from "../lib/data/spotImages";
import { coverCandidateSample, sampleCoverEntry } from "../lib/data/spotSamples";
import { isPublished } from "../lib/utils/spotGuide";
import { localizeImage, syncThumbsQuietly } from "./localize-spot-images.mjs";

const IMAGES_PATH = path.join(__dirname, "..", "content", "spot-images.json");
const args = process.argv.slice(2);
const arg = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const dryRun = args.includes("--dry-run");
const only = arg("slug")?.split(",").filter(Boolean);
const limit = Number(arg("limit")) || Infinity;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 書き方は `localize-spot-images.mjs` と同じ（並べ替えない＝差分を足した行だけにする） */
function save(images: Record<string, SpotImage>) {
    fs.writeFileSync(IMAGES_PATH, `${JSON.stringify(images, null, 2)}\n`);
}

async function main() {
    const images = JSON.parse(fs.readFileSync(IMAGES_PATH, "utf8")) as Record<string, SpotImage>;
    const published = SPOTS.filter((s) => isPublished(s) && (only ? only.includes(s.slug) : true));
    const before = published.filter((s) => spotCoverImage(s, images)).length;
    const todo = published
        .filter((s) => !spotCoverImage(s, images))
        .map((spot) => ({ spot, pick: coverCandidateSample(spot) }));
    const targets = todo.filter((t) => t.pick).slice(0, limit);
    console.log(`公開 ${published.length}・代表写真あり ${before}・無し ${todo.length}`
        + `（上げられる作例あり ${todo.filter((t) => t.pick).length}・無し ${todo.filter((t) => !t.pick).length}）`);
    if (dryRun) return;
    const today = new Date().toISOString().slice(0, 10);
    let done = 0;
    let failed = 0;
    for (const { spot, pick } of targets) {
        const previous = images[spot.slug];
        const entry = sampleCoverEntry(pick!, today, previous?.method === SAMPLE_COVER_METHOD ? previous.replaced as SpotImage | undefined : previous);
        const local = await localizeImage(spot.slug, entry.thumbUrl);
        if (!local) {
            failed++;
            console.log(`${spot.slug}: 取れなかった`);
        } else {
            const { bytes, ...placed } = local as { src: string; width: number; height: number; bytes: number };
            images[spot.slug] = { ...entry, local: placed };
            save(images);
            done++;
            console.log(`[${done}/${targets.length}] ${spot.slug}: ${placed.width}x${placed.height} ${Math.round(bytes / 1024)}KB ${entry.license}`);
        }
        await sleep(3000);
    }
    const after = published.filter((s) => spotCoverImage(s, images)).length;
    console.log(`上げた ${done}・取れなかった ${failed}。代表写真 ${before} → ${after} / ${published.length}`);
    await syncThumbsQuietly();
}

main().catch((e) => { console.error(e); process.exit(1); });
