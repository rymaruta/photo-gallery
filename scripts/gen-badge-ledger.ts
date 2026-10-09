// scripts/gen-badge-ledger.ts
//
// **メダルの数え方が使う、台帳（`content/spots.json`）の小さな写し**を書き出す。
//
//   npx tsx scripts/gen-badge-ledger.ts          # api-user/src/data/badgeLedger.json を書き直す
//   npx tsx scripts/gen-badge-ledger.ts --check  # 書き直さずに、いまのファイルと同じか確かめる
//
// ## なぜ写しなのか
//
// 台帳は 8MB あり、Lambda に持ち込むと全文がバンドルに乗る（`api-user/src/tripPlans.ts`
// の注記）。メダルが要るのは次の3つだけなので、それだけを抜いて約150KB にする:
//
//   - `spots`  … スポットの鍵（`sp_…`）・スラッグ・県（日本のみ）・時刻帯。
//                「行きたい場所」の鍵（`SPOT-<スラッグ>`）を写真の `spotId` に結ぶ／
//                スポットを選んだ写真の県と時刻帯を決める
//   - `points` … 日本のスポットの座標と県。撮影地の文字から県が分からない写真を
//                **いちばん近いスポットの県**に寄せる（通信しない・ジオコーディングを使わない）
//   - `countryTimeZones` … 国 → 時刻帯（`lib/utils/sunTimes.ts` の表そのもの）
//
// **台帳を足しても、このファイルを書き直さなければメダルの数は変わらない**（新しい
// スポットの「行きたい」がまだ数えられないだけで、間違って数えることは無い）。
// 写しの中身が台帳と食い違っていないかは `api-user/src/__tests__/badgeLedger.test.ts` が
// 見張る（足した・消した行は見ない＝台帳の作業を止めない）。

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PREFECTURES } from "../lib/data/prefectures";
import { COUNTRY_TIME_ZONES, spotTimeZone } from "../lib/utils/sunTimes";

type LedgerSpot = {
    spotId?: unknown;
    slug?: unknown;
    region?: { country?: unknown; prefecture?: unknown } | null;
    coords?: { lat?: unknown; lng?: unknown } | null;
    timeZone?: unknown;
};

export type BadgeLedger = {
    /** 都道府県（JIS 順）。`spots` と `points` の県はこの添字 */
    prefectures: string[];
    /** 時刻帯の名前。`spots` の時刻帯はこの添字（-1 は「決められない」） */
    timeZones: string[];
    /** [spotId, slug, 県の添字（日本でなければ -1）, 時刻帯の添字（-1 は無し）] */
    spots: [string, string, number, number][];
    /** [緯度, 経度, 県の添字]。日本のスポットだけ・小数第2位（約1km） */
    points: [number, number, number][];
    countryTimeZones: Record<string, string>;
};

export function buildBadgeLedger(rows: LedgerSpot[]): BadgeLedger {
    const prefectures = PREFECTURES.map((p) => p.name);
    const prefIndex = new Map(prefectures.map((n, i) => [n, i]));
    const tzList: string[] = [];
    const tzIndex = (tz: string | null): number => {
        if (!tz) return -1;
        let i = tzList.indexOf(tz);
        if (i < 0) { tzList.push(tz); i = tzList.length - 1; }
        return i;
    };
    const spots: BadgeLedger["spots"] = [];
    const points: BadgeLedger["points"] = [];
    for (const s of rows) {
        const spotId = typeof s.spotId === "string" ? s.spotId : "";
        const slug = typeof s.slug === "string" ? s.slug : "";
        if (!/^sp_[0-9a-f]{12}$/.test(spotId) || !slug) continue;
        const country = typeof s.region?.country === "string" && s.region.country.trim() ? s.region.country.trim() : "日本";
        const prefName = typeof s.region?.prefecture === "string" ? s.region.prefecture : "";
        const pref = country === "日本" ? (prefIndex.get(prefName) ?? -1) : -1;
        const tz = spotTimeZone(typeof s.timeZone === "string" ? s.timeZone : null, country);
        spots.push([spotId, slug, pref, tzIndex(tz)]);
        const lat = Number(s.coords?.lat), lng = Number(s.coords?.lng);
        if (pref >= 0 && Number.isFinite(lat) && Number.isFinite(lng)) {
            points.push([Math.round(lat * 100) / 100, Math.round(lng * 100) / 100, pref]);
        }
    }
    // 並びを固定する（台帳の並びが変わっただけで差分を出さない）
    spots.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    points.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    // 同じ升に同じ県が重なる点は1つにする（近いスポットが固まっている所で太らせない）
    const uniq = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1] || p[2] !== points[i - 1][2]);
    return { prefectures, timeZones: tzList, spots, points: uniq, countryTimeZones: { ...COUNTRY_TIME_ZONES } };
}

function main() {
    const root = resolve(__dirname, "..");
    const rows = JSON.parse(readFileSync(resolve(root, "content/spots.json"), "utf8")) as LedgerSpot[];
    const out = resolve(root, "api-user/src/data/badgeLedger.json");
    const json = JSON.stringify(buildBadgeLedger(rows)) + "\n";
    if (process.argv.includes("--check")) {
        let cur = "";
        try { cur = readFileSync(out, "utf8"); } catch { /* 無ければ違う扱い */ }
        if (cur !== json) {
            console.log("[badge-ledger] 台帳の写しが古くなっています。npx tsx scripts/gen-badge-ledger.ts で書き直せます");
            process.exit(1);
        }
        console.log("[badge-ledger] 台帳の写しは最新です");
        return;
    }
    writeFileSync(out, json);
    const led = JSON.parse(json) as BadgeLedger;
    console.log(`[badge-ledger] ${out}: スポット ${led.spots.length} 件・県の点 ${led.points.length} 件・${Buffer.byteLength(json)} バイト`);
}

if (require.main === module) main();
