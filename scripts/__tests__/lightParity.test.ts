import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sunTimes as webSunTimes, spotTimeZone } from "../../lib/utils/sunTimes";
import { SPOT_KEY_PREFIX as WEB_PREFIX } from "../../lib/utils/savedSpotKey";
import { visibleSpots } from "../../lib/utils/spotGuide";
import type { Spot } from "../../lib/data/spots";
import { sunTimes as apiSunTimes } from "../../api-user/src/sunTimes";
import { SPOT_KEY_PREFIX as API_PREFIX, LIGHT_LEDGER_SIZE } from "../../api-user/src/lightLedger";
import LEDGER from "../../api-user/src/data/lightLedger.json";

/**
 * 光と天気の知らせ（`api-user/src/lightForecast.ts`）が Web 側の式・台帳の**写し**を持っているので、
 * 食い違っていないかを見る（`badgeParity.test.ts` と同じ立場）。
 *
 * - 日の出の式: `api-user/src/sunTimes.ts` は `lib/utils/sunTimes.ts` の写し。片方だけ直すと
 *   「アプリの光の時刻」と「知らせの時刻」がずれる
 * - 台帳の写し（`api-user/src/data/lightLedger.json`）: **足した・消した行は見ない**（台帳の作業を
 *   止めない）。見るのは「写しに在る行が、台帳の今の行と食い違っていないか」だけ。
 *   新しいスポットを予報に出すには `npx tsx scripts/gen-light-ledger.ts` で書き直す
 */
type Ledger = { timeZones: string[]; spots: [string, string, string, number, number, number][] };
const L = LEDGER as unknown as Ledger;
const ROOT = join(__dirname, "..", "..");

describe("光の写し: Web と同じ式", () => {
    it("日の出・日の入り・ゴールデンアワー・ブルーアワーがミリ秒まで同じ", () => {
        const cases: [string, number, number][] = [
            ["2024-06-21", 35.68, 139.76], ["2024-12-21", 35.68, 139.76], ["2025-03-20", 43.06, 141.35],
            ["2024-06-21", 48.86, 2.35], ["2024-01-10", -33.87, 151.21], ["2024-09-01", 64.13, -21.9],
            ["2024-02-29", 26.21, 127.68], ["2023-11-05", 40.71, -74.0], ["2024-06-21", 69.65, 18.96],
        ];
        const ms = (d: Date | null) => d?.getTime() ?? null;
        for (const [ymd, lat, lng] of cases) {
            const a = apiSunTimes(ymd, { lat, lng })!, w = webSunTimes(ymd, { lat, lng })!;
            const pick = (s: typeof a | typeof w) => [
                s.sunrise, s.sunset, s.morningBlue.start, s.morningBlue.end, s.morningGolden.start, s.morningGolden.end,
                s.eveningGolden.start, s.eveningGolden.end, s.eveningBlue.start, s.eveningBlue.end,
            ].map(ms);
            expect(pick(a), `${ymd} ${lat},${lng}`).toEqual(pick(w));
        }
    });

    it("公式スポットの鍵の頭が同じ（`SPOT-`）", () => {
        expect(API_PREFIX).toBe(WEB_PREFIX);
    });
});

describe("光の写し: 台帳（content/spots.json）と食い違っていない", () => {
    const rows = JSON.parse(readFileSync(join(ROOT, "content", "spots.json"), "utf8")) as Spot[];
    const visible = new Map(visibleSpots(rows).map((s) => [s.slug, s]));

    it("写しは空でない（走査が空振りしていない）", () => {
        expect(LIGHT_LEDGER_SIZE).toBeGreaterThan(1000);
        expect(L.spots.length).toBe(LIGHT_LEDGER_SIZE);
    });

    it("写しに在るスポットは、台帳の今の名前・座標・時刻帯と同じ（下書きは入れない）", () => {
        const wrong: string[] = [];
        for (const [slug, name, nameEn, lat, lng, tz] of L.spots) {
            const row = visible.get(slug);
            if (!row) {
                // 消えた・下書きに戻った行は出さない（通知に未確認の名前を出さない）
                if (rows.some((r) => r.slug === slug)) wrong.push(`${slug}: いまは画面に出ていない`);
                continue;
            }
            const wantTz = spotTimeZone(row.timeZone ?? null, row.region?.country ?? null);
            if (row.name.trim() !== name || (row.nameEn?.trim() ?? "") !== nameEn
                || row.coords?.lat !== lat || row.coords?.lng !== lng || L.timeZones[tz] !== wantTz) {
                wrong.push(`${slug}: ${name}/${nameEn}/${lat},${lng}/${L.timeZones[tz]} → ${row.name}/${row.nameEn}/${row.coords?.lat},${row.coords?.lng}/${wantTz}`);
            }
        }
        expect(wrong, "台帳が変わった。npx tsx scripts/gen-light-ledger.ts で写しを書き直す").toEqual([]);
    });
});
