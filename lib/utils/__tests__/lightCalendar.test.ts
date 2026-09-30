import { describe, it, expect } from "vitest";
import { lightCalendar, lightCellText, lightLegend, LIGHT_DAY_OF_MONTH, LIGHT_REFERENCE_YEAR, type LightRow } from "../lightCalendar";
import { sunAltitudeRange } from "../sunTimes";

/**
 * 撮影の光の月別の表。**その土地の時計**で、各月15日の計算値。
 * 値の土台は `sunTimes.test.ts`（国立天文台の暦と照らした式）。ここでは組み立てと言い分けを見る
 */
const text = (row: LightRow) => [row.sunrise, row.sunset, row.eveningGolden].map((c) => lightCellText(c, true));

describe("撮影の光の月別の表", () => {
    const GINZAN = { lat: 38.57, lng: 140.53 };
    const EIFFEL = { lat: 48.8584, lng: 2.2945 };
    const ROVANIEMI = { lat: 66.5436, lng: 25.8473 };   // サンタクロース村（公開中の最北）

    it("12か月・各月15日・日本の行（国なし）は日本時間・年は決めた年（ビルドの日付で変えない）", () => {
        const c = lightCalendar(GINZAN, undefined)!;
        expect(LIGHT_DAY_OF_MONTH).toBe(15);
        expect(LIGHT_REFERENCE_YEAR).toBe(2026);
        expect(c.timeZone).toBe("Asia/Tokyo");
        expect(c.rows.map((r) => r.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        expect(text(c.rows[9])).toEqual(["05:47", "17:02", "16:26–17:18"]);
        expect(lightLegend(c.rows, true)).toEqual([]);
    });

    it("海外は国の時刻帯で・夏時間も入る（パリの1月は冬時間、6月は夏時間）", () => {
        const c = lightCalendar(EIFFEL, "フランス")!;
        expect(c.timeZone).toBe("Europe/Paris");
        expect(text(c.rows[0])[0]).toBe("08:40");
        expect(text(c.rows[5]).slice(0, 2)).toEqual(["05:47", "21:56"]);
    });

    it("座標が無い・時刻帯が引けない国は表を出さない", () => {
        expect(lightCalendar(undefined, "日本")).toBeNull();
        expect(lightCalendar({ lat: Number.NaN, lng: 140 }, "日本")).toBeNull();
        expect(lightCalendar({ lat: 69.65, lng: 18.96 }, "ノルウェー")).toBeNull();
    });

    /** 🔴 「—」だけだと「無い」「データが無い」と読める（9d7ba04e のレビュー） */
    it("北極圏: 冬は一日中マジックアワー（終日）・夏至は白夜・日付をまたぐ時刻は「翌」", () => {
        const c = lightCalendar(ROVANIEMI, "フィンランド")!;
        // 1月: 太陽が 6° まで上がらない（いちばん高くて約2°）
        expect(sunAltitudeRange("2026-01-15", ROVANIEMI)!.max).toBeLessThan(6);
        expect(text(c.rows[0])).toEqual(["10:21", "14:32", "終日"]);
        // 6月: 白夜（日の出・日の入りが無い）・マジックアワーは終わらない
        expect(text(c.rows[5])).toEqual(["白夜", "白夜", "22:18–（沈まない）"]);
        // 7月: 日の入りは日付をまたぐ・沈むので「沈まない」とは言わない（明け方までつながる）
        expect(text(c.rows[6])).toEqual(["02:36", "翌00:10", "21:59–（明け方まで）"]);
        // 5月: マジックアワーの終わりが翌日
        expect(text(c.rows[4])[2]).toBe("21:16–翌00:18");
        expect(lightLegend(c.rows, true)).toEqual([
            "白夜＝一日中太陽が沈まない",
            "終日＝太陽が一日中低く、昼のあいだずっとマジックアワー",
            "沈まない＝白夜で、マジックアワーが終わらない",
            "明け方まで＝沈んでも暗くなりきらず、マジックアワーが明け方までつながる",
            "翌＝日付をまたいだ翌日の時刻",
        ]);
    });

    it("極夜は「極夜」（北緯78度の1月）", () => {
        const c = lightCalendar({ lat: 78.2, lng: 15.6 }, "日本")!;
        expect(text(c.rows[0])).toEqual(["極夜", "極夜", "極夜"]);
        expect(lightLegend(c.rows, true)).toContain("極夜＝一日中太陽が昇らない");
    });

    it("英語の言葉（現象の名前・翌日は (+1)）", () => {
        const c = lightCalendar(ROVANIEMI, "フィンランド")!;
        expect(lightCellText(c.rows[0].eveningGolden, false)).toBe("All day");
        expect(lightCellText(c.rows[5].sunrise, false)).toBe("Midnight sun");
        expect(lightCellText(c.rows[6].sunset, false)).toBe("00:10 (+1)");
        expect(lightCellText(c.rows[4].eveningGolden, false)).toBe("21:16–00:18 (+1)");
    });

    it("昇らない日（極夜）は「終日」と言わない（北緯69度の12月）", () => {
        const c = lightCalendar({ lat: 69.05, lng: 20.8 }, "フィンランド")!;
        expect(text(c.rows[11])).toEqual(["極夜", "極夜", "極夜"]);
    });

    it("計算できない座標は表ごと出さない（理由の分からない「極夜」を作らない）", () => {
        expect(lightCalendar({ lat: 95, lng: 0 }, "日本")).toBeNull();
    });
});
