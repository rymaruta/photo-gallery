import { describe, it, expect } from "vitest";
import { lightCalendar, LIGHT_DAY_OF_MONTH } from "../lightCalendar";

/**
 * 撮影の光の月別の表。**その土地の時計**で、各月15日の計算値。
 * 値の土台は `sunTimes.test.ts`（国立天文台の暦と照らした式）。ここでは組み立てを見る
 */
describe("撮影の光の月別の表", () => {
    const GINZAN = { lat: 38.57, lng: 140.53 };
    const EIFFEL = { lat: 48.8584, lng: 2.2945 };

    it("12か月・各月15日・日本の行（国なし）は日本時間", () => {
        const c = lightCalendar(GINZAN, undefined, 2026)!;
        expect(LIGHT_DAY_OF_MONTH).toBe(15);
        expect(c.timeZone).toBe("Asia/Tokyo");
        expect(c.year).toBe(2026);
        expect(c.rows.map((r) => r.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        // 10/15 の銀山温泉（10/10 の日の入り 17:09 から5日ぶん早い）
        expect(c.rows[9]).toEqual({ month: 10, sunrise: "05:47", sunset: "17:02", eveningGolden: "16:26–17:18" });
        // 夏至のころは日の入りが遅い
        expect(c.rows[5].sunset! > c.rows[11].sunset!).toBe(true);
    });

    it("海外は国の時刻帯で・夏時間も入る（パリの1月は冬時間、6月は夏時間）", () => {
        const c = lightCalendar(EIFFEL, "フランス", 2026)!;
        expect(c.timeZone).toBe("Europe/Paris");
        expect(c.rows[0].sunrise).toBe("08:40");
        expect(c.rows[5]).toMatchObject({ sunrise: "05:47", sunset: "21:56" });
    });

    it("座標が無い・時刻帯が引けない国は表を出さない", () => {
        expect(lightCalendar(undefined, "日本", 2026)).toBeNull();
        expect(lightCalendar({ lat: Number.NaN, lng: 140 }, "日本", 2026)).toBeNull();
        expect(lightCalendar({ lat: 69.65, lng: 18.96 }, "ノルウェー", 2026)).toBeNull();
    });

    it("太陽がその高さを通らない月は欄を空に（作り話の時刻を出さない）", () => {
        // 北緯78度（極夜の1月・白夜の6月）
        const c = lightCalendar({ lat: 78.2, lng: 15.6 }, "日本", 2026)!;
        expect(c.rows[0]).toEqual({ month: 1, sunrise: null, sunset: null, eveningGolden: null });
        expect(c.rows[5].sunrise).toBeNull();
    });
});
