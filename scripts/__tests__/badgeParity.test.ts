import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PREFECTURES } from "../../lib/data/prefectures";
import { sunTimes, COUNTRY_TIME_ZONES, spotTimeZone } from "../../lib/utils/sunTimes";
import { sunriseSunset, PREFECTURE_NAMES } from "../../api-user/src/badges";
import LEDGER from "../../api-user/src/data/badgeLedger.json";

/**
 * メダルの数え方（`api-user/src/badges.ts`）が Web 側の表・式の**写し**を持っているので、
 * 食い違っていないかを見る。Lambda に `lib/` を持ち込まないための写しで、片方だけ直すと
 * 「アプリの光の時刻では朝なのにメダルに数えない」が起きる。
 *
 * 台帳の写し（`api-user/src/data/badgeLedger.json`）は**足した・消した行は見ない**
 * ——撮影スポットの作業（台帳を毎日足す）を止めないため。見るのは
 * 「写しに在る行が、台帳の今の行と食い違っていないか」だけ。
 * 新しいスポットを数えたくなったら `npx tsx scripts/gen-badge-ledger.ts` で書き直す。
 */
type Ledger = {
    prefectures: string[];
    timeZones: string[];
    spots: [string, string, number, number][];
    points: [number, number, number][];
    countryTimeZones: Record<string, string>;
};
const L = LEDGER as unknown as Ledger;
const ROOT = join(__dirname, "..", "..");

describe("メダルの写し: Web と同じ表・同じ式", () => {
    it("県の表が lib/data/prefectures.ts と同じ並び", () => {
        expect(PREFECTURE_NAMES).toEqual(PREFECTURES.map((p) => p.name));
        expect(L.prefectures).toEqual(PREFECTURES.map((p) => p.name));
    });

    it("国の時刻帯が lib/utils/sunTimes.ts の COUNTRY_TIME_ZONES と同じ", () => {
        expect(L.countryTimeZones).toEqual(COUNTRY_TIME_ZONES);
    });

    it("日の出・日の入りの式が lib/utils/sunTimes.ts と同じ（ミリ秒まで）", () => {
        const cases: [string, number, number][] = [
            ["2024-06-21", 35.68, 139.76], ["2024-12-21", 35.68, 139.76], ["2025-03-20", 43.06, 141.35],
            ["2024-06-21", 48.86, 2.35], ["2024-01-10", -33.87, 151.21], ["2024-09-01", 64.13, -21.9],
            ["2024-02-29", 26.21, 127.68], ["2023-11-05", 40.71, -74.0],
        ];
        for (const [ymd, lat, lng] of cases) {
            const [y, m, d] = ymd.split("-").map(Number);
            const mine = sunriseSunset(y, m, d, lat, lng);
            const web = sunTimes(ymd, { lat, lng });
            expect(mine?.rise, `${ymd} ${lat},${lng}`).toBe(web?.sunrise?.getTime());
            expect(mine?.set, `${ymd} ${lat},${lng}`).toBe(web?.sunset?.getTime());
        }
    });
});

describe("メダルの写し: 台帳（content/spots.json）と食い違っていない", () => {
    type Row = { spotId?: string; slug?: string; region?: { country?: string; prefecture?: string }; timeZone?: string };
    const ledger = JSON.parse(readFileSync(join(ROOT, "content", "spots.json"), "utf8")) as Row[];
    const byId = new Map(ledger.map((s) => [s.spotId, s]));

    it("写しは空でない（走査が空振りしていない）", () => {
        expect(L.spots.length).toBeGreaterThan(1000);
        expect(L.points.length).toBeGreaterThan(500);
        // 47都道府県すべてに点がある（座標を寄せる先が無い県を作らない）
        expect(new Set(L.points.map((p) => p[2])).size).toBe(47);
    });

    it("写しに在るスポットは、台帳の今のスラッグ・県・時刻帯と同じ", () => {
        const wrong: string[] = [];
        for (const [id, slug, pref, tz] of L.spots) {
            const row = byId.get(id);
            if (!row) continue;   // 台帳から消えた行は見ない（数えられなくなるだけ）
            const country = row.region?.country?.trim() || "日本";
            const wantPref = country === "日本" ? PREFECTURES.findIndex((p) => p.name === row.region?.prefecture) : -1;
            const wantTz = spotTimeZone(row.timeZone ?? null, country);
            const gotTz = tz >= 0 ? L.timeZones[tz] : null;
            if (row.slug !== slug || wantPref !== pref || wantTz !== gotTz) {
                wrong.push(`${id}: slug ${slug}→${row.slug} / 県 ${pref}→${wantPref} / 時刻帯 ${gotTz}→${wantTz}`);
            }
        }
        expect(wrong, "台帳が変わった。npx tsx scripts/gen-badge-ledger.ts で写しを書き直す").toEqual([]);
    });
});
