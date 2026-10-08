import { describe, it, expect } from "vitest";
import { COUNTRY_TIME_ZONES, isTimeZoneName, spotTimeZone, sunTimes, clockIn } from "../sunTimes";
import { lightSheet, lightZone } from "../spotLight";
import { lightCalendar } from "../lightCalendar";
import { parseTripSpotBody } from "../tripLight";

/**
 * 台帳の行の `timeZone`（IANA 名・2026-10-07）。**あれば国の表より先**、無ければ国の表。
 * アメリカ・カナダ・オーストラリアのように時刻帯が複数ある国は、国から決められない。
 * アプリ（`SunTimesTests`）と同じ地点・同じ日・同じ値。
 */
const NY = { lat: 40.7128, lng: -74.006 };
const SYD = { lat: -33.8688, lng: 151.2093 };

describe("時刻帯の決め方", () => {
    it("timeZone があれば国より先", () => {
        expect(spotTimeZone("America/New_York", "アメリカ")).toBe("America/New_York");
        // 国の表に在る国でも、行の時刻帯が勝つ（スペインのカナリア諸島）
        expect(spotTimeZone("Atlantic/Canary", "スペイン")).toBe("Atlantic/Canary");
        expect(spotTimeZone(" Australia/Sydney ", "オーストラリア")).toBe("Australia/Sydney");
    });

    it("timeZone が無ければ国の表。複数の時刻帯の国は決まらない（null）", () => {
        expect(spotTimeZone(undefined, "スペイン")).toBe("Europe/Madrid");
        expect(spotTimeZone(undefined, undefined)).toBe("Asia/Tokyo");
        for (const c of ["アメリカ", "カナダ", "オーストラリア", "ブラジル", "メキシコ", "ロシア", "インドネシア"]) {
            expect(spotTimeZone(undefined, c), c).toBeNull();
            expect(COUNTRY_TIME_ZONES[c], c).toBeUndefined();
        }
    });

    it("読めない timeZone は国の表に落とす（略号・ずれ・綴り違いは受けない）", () => {
        for (const bad of ["EST", "+09:00", "Asia/Tokio", "", "  ", "UTC"]) {
            expect(isTimeZoneName(bad), bad).toBe(false);
            expect(spotTimeZone(bad, "フランス"), bad).toBe("Europe/Paris");
            expect(spotTimeZone(bad, "アメリカ"), bad).toBeNull();
        }
    });

    it("国の表の時刻帯はどれも読める名前", () => {
        for (const [c, z] of Object.entries(COUNTRY_TIME_ZONES)) expect(isTimeZoneName(z), `${c}: ${z}`).toBe(true);
    });

    it("節・月の表・旅行プランも timeZone を先に使う", () => {
        expect(lightZone(NY, "アメリカ")).toBeNull();
        expect(lightZone(NY, "アメリカ", "America/New_York")).toBe("America/New_York");
        expect(lightCalendar(NY, "アメリカ")).toBeNull();
        expect(lightCalendar(NY, "アメリカ", "America/New_York")?.timeZone).toBe("America/New_York");
        const now = new Date("2026-07-15T12:00:00Z");
        expect(lightSheet("アメリカ", NY, 0, now, true)).toBeNull();
        expect(lightSheet("アメリカ", NY, 0, now, true, "America/New_York")?.timeZone).toBe("America/New_York");
        const body = parseTripSpotBody({ slug: "ny", name: "NY", coords: NY, country: "アメリカ", timeZone: "America/New_York", seasonalGuide: [] }, "ny");
        expect(body?.timeZone).toBe("America/New_York");
    });
});

describe("夏時間のある地点の日の出・日の入り（timeanddate.com と1分以内）", () => {
    const at = (tz: string, ymd: string, c: { lat: number; lng: number }) => {
        const s = sunTimes(ymd, c)!;
        return [clockIn(tz, s.sunrise), clockIn(tz, s.sunset)];
    };

    it("ニューヨーク: 冬（EST）・夏（EDT）、夏時間の始まり（2026-03-08）の前後で1時間ずれる", () => {
        expect(at("America/New_York", "2026-01-15", NY)).toEqual(["07:19", "16:53"]);
        expect(at("America/New_York", "2026-07-15", NY)).toEqual(["05:38", "20:27"]);
        expect(at("America/New_York", "2026-03-07", NY)).toEqual(["06:22", "17:54"]);
        expect(at("America/New_York", "2026-03-09", NY)).toEqual(["07:18", "18:56"]);
    });

    it("シドニー: 南半球の夏（AEDT）・冬（AEST）、夏時間の終わり（2026-04-05）の前後で1時間ずれる", () => {
        expect(at("Australia/Sydney", "2026-01-15", SYD)).toEqual(["06:00", "20:10"]);
        expect(at("Australia/Sydney", "2026-07-15", SYD)).toEqual(["06:59", "17:04"]);
        expect(at("Australia/Sydney", "2026-04-04", SYD)).toEqual(["07:10", "18:48"]);
        expect(at("Australia/Sydney", "2026-04-06", SYD)).toEqual(["06:11", "17:45"]);
    });

    it("節の日の出も、その土地の夏時間の時計で出る", () => {
        const sheet = lightSheet("アメリカ", NY, 0, new Date("2026-07-15T16:00:00Z"), true, "America/New_York")!;
        expect(sheet.ymd).toBe("2026-07-15");
        const rise = sheet.blocks.find((b) => b.isMorning)!.rows.find((r) => r.label === "日の出")!;
        expect(rise.value).toBe("05:38");
    });
});
