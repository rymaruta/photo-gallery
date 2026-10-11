import { describe, it, expect } from "vitest";
import {
    GALACTIC_CENTER, appendSkySummary, culminationAltitude, directionSummary, greenwichSiderealDegrees, milkyWay, milkyWaySummary,
    MILKY_WAY_MIN_MINUTES, monthRanges, newMoonJDE, newMoonLabels, newMoonsBetween, skyDescription, skyLead, spotSky, spotSkyDescription, starAltitude,
} from "../spotSky";
import { sunTimes } from "../sunTimes";
import { lightCalendar } from "../lightCalendar";

/**
 * 座標から計算する撮影の事実（2026-10-11）。式は既知の値と突き合わせる:
 *   - 恒星時・新月は Meeus『Astronomical Algorithms』の例題
 *   - 2026 年の新月は日食の時刻（2/17 金環・8/12 皆既）
 *   - 日の出・日の入りの方位は国立天文台の暦（東京の夏至の日の入り ≈300°・冬至 ≈242°）
 */
const TOKYO = { lat: 35.6895, lng: 139.6917 };
const NOW = new Date("2026-10-11T03:00:00Z");

describe("天文の式（既知の値）", () => {
    it("グリニッジ平均恒星時: Meeus 例 12.a・12.b", () => {
        // 1987-04-10 0h UT → 13h10m46.3668s = 197.693195°
        expect(greenwichSiderealDegrees(new Date(Date.UTC(1987, 3, 10, 0, 0, 0)))).toBeCloseTo(197.693195, 4);
        // 1987-04-10 19:21:00 UT → 128.7378734°
        expect(greenwichSiderealDegrees(new Date(Date.UTC(1987, 3, 10, 19, 21, 0)))).toBeCloseTo(128.7378734, 3);
    });

    it("新月: Meeus 例 49.a（1977年2月 k=−283 → JDE 2443192.65118）", () => {
        expect(newMoonJDE(-283)).toBeCloseTo(2443192.65118, 4);
    });

    it("2026年の新月は日食の時刻と5分以内（2/17 12:01 UT・8/12 17:37 UT）", () => {
        const list = newMoonsBetween(new Date("2026-01-01T00:00:00Z"), 365);
        expect(list).toHaveLength(12);
        const near = (iso: string) => Math.min(...list.map((d) => Math.abs(d.getTime() - Date.parse(iso)))) / 60_000;
        expect(near("2026-02-17T12:01:00Z")).toBeLessThan(5);
        expect(near("2026-08-12T17:37:00Z")).toBeLessThan(5);
    });

    it("銀河中心は J2000 で 17h45m40s・−29°00′28″", () => {
        expect(GALACTIC_CENTER.ra).toBeCloseTo((17 + 45 / 60 + 40 / 3600) * 15, 6);
        expect(GALACTIC_CENTER.dec).toBeCloseTo(-29.00778, 4);
        // 南中高度: 東京で約25°・ヘルシンキ（北緯60.17°）で約1°
        expect(culminationAltitude(GALACTIC_CENTER.dec, TOKYO.lat)).toBeCloseTo(25.3, 1);
        expect(Math.round(culminationAltitude(GALACTIC_CENTER.dec, 60.17))).toBe(1);
    });

    it("星の高さは南中高度を超えない（1日を10分刻みで見た最大が南中高度と0.2°以内）", () => {
        let max = -90;
        for (let i = 0; i < 144; i++) {
            max = Math.max(max, starAltitude(GALACTIC_CENTER.ra, GALACTIC_CENTER.dec, TOKYO, new Date(Date.UTC(2026, 5, 15) + i * 600_000)));
        }
        expect(max).toBeLessThanOrEqual(culminationAltitude(GALACTIC_CENTER.dec, TOKYO.lat) + 1e-6);
        expect(max).toBeGreaterThan(culminationAltitude(GALACTIC_CENTER.dec, TOKYO.lat) - 0.2);
    });

    it("東京の夏至の日の入りは約300°・冬至は約242°（±1°）", () => {
        expect(sunTimes("2026-06-21", TOKYO)!.sunsetAzimuth!).toBeGreaterThan(299);
        expect(sunTimes("2026-06-21", TOKYO)!.sunsetAzimuth!).toBeLessThan(301);
        expect(Math.abs(sunTimes("2026-12-22", TOKYO)!.sunsetAzimuth! - 242)).toBeLessThanOrEqual(1);
    });
});

describe("月別の表の方角", () => {
    it("各月の日の出・日の入りの方位を持つ（白夜・極夜の月は null）", () => {
        const c = lightCalendar(TOKYO, "日本")!;
        expect(Math.round(c.rows[5].sunsetAzimuth!)).toBe(300);
        expect(Math.round(c.rows[5].sunriseAzimuth!)).toBe(60);
        expect(c.rows[11].sunsetAzimuth!).toBeLessThan(243);
        const rova = lightCalendar({ lat: 66.5436, lng: 25.8473 }, "フィンランド")!;
        expect(rova.rows[5].sunriseAzimuth).toBeNull();
        expect(rova.rows[5].sunsetAzimuth).toBeNull();
    });
});

describe("天の川（銀河中心）", () => {
    it("東京: 夏の夜に長く、冬は見えない・6月がいちばん長い", () => {
        const mw = milkyWay(TOKYO, "Asia/Tokyo")!;
        const months = mw.months.map((m) => m.month);
        expect(months).toContain(6);
        expect(months).not.toContain(12);
        expect(months).not.toContain(1);
        const june = mw.months.find((m) => m.month === 6)!;
        expect(Math.max(...mw.months.map((m) => m.minutes))).toBe(june.minutes);
        // 6月は日付をまたぐ夜（20時台〜翌2時台）
        expect("text" in june.window && june.window.text).toMatch(/^2\d:\d{2}–翌0[0-3]:\d{2}$/);
    });

    it("東京: 各月の時刻帯と長さ（10分刻みを端も含めて数える）", () => {
        const mw = milkyWay(TOKYO, "Asia/Tokyo")!;
        expect(mw.months.map((m) => [m.month, "text" in m.window ? m.window.text : "", m.minutes])).toEqual([
            [2, "04:26–04:56", 40], [3, "02:41–04:21", 110], [4, "00:32–03:32", 190], [5, "22:38–翌02:48", 260],
            [6, "20:52–翌02:32", 350], [7, "20:48–翌01:08", 270], [8, "20:17–23:07", 180], [9, "19:17–21:07", 120],
            [10, "18:38–19:08", 40],
        ]);
    });

    /** 時刻帯は**その土地の時計**（Asia/Tokyo 固定にすると落ちる）。南半球は6月がいちばん長い */
    it("海外・南半球: シドニーとラパスの時刻帯は現地の時計で、6月がいちばん長い", () => {
        const rows = (mw: ReturnType<typeof milkyWay>) => mw!.months.map((m) => [m.month, "text" in m.window ? m.window.text : "", m.minutes]);
        const syd = milkyWay({ lat: -33.8568, lng: 151.2153 }, "Australia/Sydney");
        expect(rows(syd)).toEqual([
            [2, "02:30–05:00", 160], [3, "00:45–05:25", 290], [4, "21:36–翌04:46", 440], [5, "19:42–翌05:12", 580],
            [6, "18:26–翌05:26", 670], [7, "18:41–翌04:31", 600], [8, "18:51–翌02:31", 470], [9, "19:11–翌00:31", 330],
            [10, "20:42–23:32", 180],
        ]);
        const lapaz = spotSky({ lat: -16.5, lng: -68.15 }, "ボリビア", null, NOW)!;
        expect(lapaz.timeZone).toBe("America/La_Paz");
        expect(rows(lapaz.milkyWay)[4]).toEqual([6, "19:34–翌05:34", 610]);
        for (const mw of [syd!, lapaz.milkyWay, milkyWay({ lat: -24.7, lng: 15.3 }, "Africa/Windhoek")!]) {
            const longest = mw.months.reduce((a, b) => (b.minutes > a.minutes ? b : a));
            expect(longest.month).toBe(6);
        }
    });

    it("30分に満たない月は「見える月」に入れない（北緯39°の2月・10月は10〜20分だけ）", () => {
        const at = { lat: 39, lng: 0 };
        const all = milkyWay(at, "UTC", 2026, 0)!;
        const short = all.months.filter((m) => m.minutes < MILKY_WAY_MIN_MINUTES).map((m) => m.month);
        expect(short).toEqual([2, 10]);
        const shown = milkyWay(at, "UTC")!.months.map((m) => m.month);
        expect(shown).not.toContain(2);
        expect(shown).not.toContain(10);
        expect(shown.length).toBe(all.months.length - 2);
    });

    it("南半球（ナミビア・南緯24.7°）は東京より長く見える（銀河中心が天頂近くまで上がる）", () => {
        const nam = milkyWay({ lat: -24.7, lng: 15.3 }, "Africa/Windhoek")!;
        const tok = milkyWay(TOKYO, "Asia/Tokyo")!;
        expect(nam.maxAltitude).toBeGreaterThan(80);
        const total = (m: typeof nam) => m.months.reduce((n, r) => n + r.minutes, 0);
        expect(total(nam)).toBeGreaterThan(total(tok) * 1.5);
    });

    it("パリ: 6月は天文薄明が明けない（暗くならない）ので入らない", () => {
        const mw = milkyWay({ lat: 48.8584, lng: 2.2945 }, "Europe/Paris")!;
        expect(mw.months.map((m) => m.month)).not.toContain(6);
    });

    it("高緯度は見える月が無く、上がる高さを言う（ヘルシンキ 1°・北極圏は地平線の下）", () => {
        const hel = spotSky({ lat: 60.17, lng: 24.94 }, "フィンランド", null, NOW)!;
        expect(hel.milkyWay.months).toEqual([]);
        expect(milkyWaySummary(hel)).toBe("この緯度では天の川の中心（銀河中心）は地平線から最大 1° までしか上がらず、暗い時間に 10° を超える月はない。");
        const rova = spotSky({ lat: 66.5436, lng: 25.8473 }, "フィンランド", null, NOW)!;
        expect(milkyWaySummary(rova)).toBe("この緯度では天の川の中心（銀河中心）は地平線より上に出ない。");
    });
});

describe("月の幅の言い方", () => {
    it("続いた月は「〜」・12月→1月もつながる・全部は「一年中」", () => {
        expect(monthRanges([4, 5, 6, 7, 8, 9])).toBe("4〜9月");
        expect(monthRanges([11, 12, 1, 2])).toBe("11〜2月");
        expect(monthRanges([3, 5, 6])).toBe("3月・5〜6月");
        expect(monthRanges([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBe("一年中");
        expect(monthRanges([12, 1], false)).toBe("Dec–Jan");
        expect(monthRanges([])).toBe("");
    });
});

describe("新月（ビルドの日から1年分・その土地の暦）", () => {
    it("ビルドの日より後の新月だけ・1年分・時刻帯で日付が変わる", () => {
        const tok = spotSky(TOKYO, "日本", null, NOW)!;
        expect(tok.asOf).toBe("2026-10-11");
        // 2026-10-10 15:50 UT の新月は東京では10月11日 00:50。ビルドがその日の昼でも落とさない（その日の0時から数える）
        expect(tok.newMoons[0]).toBe("2026-10-11");
        expect(tok.newMoons[1]).toBe("2026-11-09");
        expect(tok.newMoons).toHaveLength(13);
        expect(tok.newMoons.every((d) => d >= "2026-10-11" && d < "2027-10-11")).toBe(true);
        // パリではその新月は10月10日（ビルドの日より前）なので入らない
        expect(spotSky({ lat: 48.8584, lng: 2.2945 }, "フランス", null, NOW)!.newMoons[0]).toBe("2026-11-09");
        // 2027-01-07 20:24 UT の新月は、東京では1月8日・パリでは1月7日
        expect(tok.newMoons).toContain("2027-01-08");
        expect(spotSky({ lat: 48.8584, lng: 2.2945 }, "フランス", null, NOW)!.newMoons).toContain("2027-01-07");
    });

    it("年をまたいでも古くならない（ビルドの日を進めると、その先の新月になる）", () => {
        const later = spotSky(TOKYO, "日本", null, new Date("2028-03-01T00:00:00Z"))!;
        expect(later.newMoons[0] > "2028-03-01").toBe(true);
        expect(later.newMoons.every((d) => d < "2029-03-01")).toBe(true);
    });

    it("年の変わる最初の日にだけ年を付ける", () => {
        expect(newMoonLabels(["2026-11-09", "2026-12-09", "2027-01-08"])).toEqual(["2026年11月9日", "12月9日", "2027年1月8日"]);
        expect(newMoonLabels(["2026-11-09", "2027-01-08"], false)).toEqual(["9 Nov 2026", "8 Jan 2027"]);
    });
});

describe("要約の文（作り話を入れない＝計算の値だけ）", () => {
    const tok = spotSky(TOKYO, "日本", null, NOW)!;

    it("撮影の光の頭: 6月21日ごろ・12月21日ごろの日の出と日の入りの方角", () => {
        expect(directionSummary(tok)).toBe(
            "日の出・日の入りの方角は季節で動く。6月21日ごろは日の出が東北東 60°・日の入りが西北西 300°（1年でいちばん北寄り）、"
            + "12月21日ごろは日の出が東南東 119°・日の入りが西南西 241°（いちばん南寄り）。");
    });

    it("撮影ガイドの頭と検索の説明", () => {
        // ガイドの頭は度と時刻を言わない（「撮影の光」「星空の暦」と同じ文を重ねない）
        expect(skyLead(tok)).toBe("日の入りは6月が西北西寄り、12月が西南西寄り。天の川の中心は2〜10月の夜。");
        expect(skyLead(tok, false)).toBe("Sunset is toward WNW in June and WSW in December. Milky Way core: Feb–Oct, at night.");
        // 見える月の無い緯度では天の川の文を外す（頭を否定文で始めない）
        const hel = spotSky({ lat: 60.17, lng: 24.94 }, "フィンランド", null, NOW)!;
        expect(skyLead(hel)).toBe("日の入りは6月が北西寄り、12月が南西寄り。");
        expect(skyDescription(tok)).toBe("日の入りは6月が西北西寄り、12月が西南西寄り。天の川の中心は2〜10月の夜。");
        expect(skyDescription(null)).toBe("");
    });

    it("北極圏は方角の代わりに白夜・極夜と言う", () => {
        const sval = spotSky({ lat: 78.2, lng: 15.6 }, "ノルウェー", null, NOW)!;
        expect(directionSummary(sval)).toBe("日の出・日の入りの方角は季節で動く。6月21日ごろは白夜で日が沈まない、12月21日ごろは極夜で日が昇らない。");
        expect(skyDescription(sval)).toBe("6月21日ごろは白夜で日が沈まない、12月21日ごろは極夜で日が昇らない。");
    });

    it("説明の後半に足す（句点で区切る・空なら元のまま）・座標の無い行は足さない", () => {
        expect(appendSkySummary("岬の灯台。", "日の入りは…。")).toBe("岬の灯台。日の入りは…。");
        expect(appendSkySummary("岬の灯台", "日の入りは…。")).toBe("岬の灯台。日の入りは…。");
        expect(appendSkySummary("岬の灯台。", "")).toBe("岬の灯台。");
        expect(spotSkyDescription({ coords: null })).toBe("");
        expect(spotSkyDescription({ coords: TOKYO, region: { country: "アメリカ" } })).toBe("");
    });
});
