// scripts/gen-light-ledger.ts
//
// **「光と天気の知らせ」が使う、台帳（`content/spots.json`）の小さな写し**を書き出す。
//
//   npx tsx scripts/gen-light-ledger.ts          # api-user/src/data/lightLedger.json を書き直す
//   npx tsx scripts/gen-light-ledger.ts --check  # 書き直さずに、いまのファイルと同じか確かめる
//
// ## なぜ写しなのか
//
// 台帳は 8MB あり、Lambda に持ち込むと全文がバンドルに乗る（`gen-badge-ledger.ts` と同じ理由）。
// 天気の予報に要るのは「行きたい場所」の鍵（`SPOT-<スラッグ>`）から引く
// **名前・座標・時刻帯**だけなので、それだけを抜く。
//
// ## 入れるのは画面に出ているスポットだけ（`visibleSpots`）
//
// 「行きたい」に入れられるのは画面に出ているスポットだけ。下書き（運営未確認）の名前を
// 通知の文面に出さない。
//
// **台帳を足しても、このファイルを書き直さなければ新しいスポットは予報に出ない**（出ないだけで、
// 間違った場所の予報を出すことは無い）。写しの中身が台帳と食い違っていないかは
// `scripts/__tests__/lightParity.test.ts` が見張る（メダルの写しと同じく、足した行は見ない
// ＝台帳の作業を止めない）。

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { visibleSpots } from "../lib/utils/spotGuide";
import { spotTimeZone } from "../lib/utils/sunTimes";
import type { Spot } from "../lib/data/spots";

export type LightLedger = {
    /** 時刻帯の名前。`spots` の時刻帯はこの添字 */
    timeZones: string[];
    /** [slug, 名前, 英語の名前（無ければ ""）, 緯度, 経度, 時刻帯の添字] */
    spots: [string, string, string, number, number, number][];
};

export function buildLightLedger(rows: readonly Spot[]): LightLedger {
    const tzList: string[] = [];
    const tzIndex = (tz: string): number => {
        let i = tzList.indexOf(tz);
        if (i < 0) { tzList.push(tz); i = tzList.length - 1; }
        return i;
    };
    const spots: LightLedger["spots"] = [];
    for (const s of visibleSpots(rows)) {
        const slug = typeof s.slug === "string" ? s.slug : "";
        const name = typeof s.name === "string" ? s.name.trim() : "";
        const lat = Number(s.coords?.lat), lng = Number(s.coords?.lng);
        const country = typeof s.region?.country === "string" ? s.region.country : null;
        const tz = spotTimeZone(s.timeZone ?? null, country);
        // 時刻帯の決まらない行は入れない（その土地の時計で言えない＝光の時刻を出さない）
        if (!slug || !name || !Number.isFinite(lat) || !Number.isFinite(lng) || !tz) continue;
        const nameEn = typeof s.nameEn === "string" ? s.nameEn.trim() : "";
        spots.push([slug, name, nameEn, lat, lng, tzIndex(tz)]);
    }
    spots.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    // 時刻帯の添字を並びに依らない形にする（台帳の並びが変わっただけで差分を出さない）
    const sortedTz = [...tzList].sort();
    const remap = tzList.map((tz) => sortedTz.indexOf(tz));
    return { timeZones: sortedTz, spots: spots.map((r) => [r[0], r[1], r[2], r[3], r[4], remap[r[5]]]) };
}

function main() {
    const root = resolve(__dirname, "..");
    const rows = JSON.parse(readFileSync(resolve(root, "content/spots.json"), "utf8")) as Spot[];
    const out = resolve(root, "api-user/src/data/lightLedger.json");
    const json = JSON.stringify(buildLightLedger(rows)) + "\n";
    if (process.argv.includes("--check")) {
        let cur = "";
        try { cur = readFileSync(out, "utf8"); } catch { /* 無ければ違う扱い */ }
        if (cur !== json) {
            console.log("[light-ledger] 写しが古くなっています。npx tsx scripts/gen-light-ledger.ts で書き直せます");
            process.exit(1);
        }
        console.log("[light-ledger] 写しは最新です");
        return;
    }
    writeFileSync(out, json);
    const led = JSON.parse(json) as LightLedger;
    console.log(`[light-ledger] ${out}: スポット ${led.spots.length} 件・時刻帯 ${led.timeZones.length} 種・${Buffer.byteLength(json)} バイト`);
}

if (require.main === module) main();
