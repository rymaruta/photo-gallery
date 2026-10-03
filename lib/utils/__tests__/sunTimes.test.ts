import { describe, it, expect } from "vitest";
import { sunTimes, clockIn, timeZoneForCountry, todayIn } from "../sunTimes";

/**
 * その場所・その日の光の時刻。**国立天文台の暦と1分以内**で合うことを見る
 * （東京 2024-09-27：日の出 5:33・日の入り 17:32）。アプリ（`SunTimes.swift`）と同じ値を使う。
 */
const TOKYO = { lat: 35.6895, lng: 139.6917 };
const t = (tz: string, d: Date | null) => clockIn(tz, d);

describe("sunTimes", () => {
    it("東京 2024-09-27: 日の出 05:33・日の入り 17:32（国立天文台の暦と一致）", () => {
        const s = sunTimes("2024-09-27", TOKYO)!;
        expect(t("Asia/Tokyo", s.sunrise)).toBe("05:33");
        expect(t("Asia/Tokyo", s.sunset)).toBe("17:32");
    });

    it("夕方: ゴールデンアワー（+6°→−4°）→ ブルーアワー（−4°→−6°）の順につながる", () => {
        const s = sunTimes("2026-10-10", { lat: 38.58, lng: 140.53 })!;   // 銀山温泉
        expect(t("Asia/Tokyo", s.eveningGolden.start)).toBe("16:34");
        expect(t("Asia/Tokyo", s.sunset)).toBe("17:09");
        expect(t("Asia/Tokyo", s.eveningGolden.end)).toBe("17:26");
        expect(s.eveningBlue.start!.getTime()).toBe(s.eveningGolden.end!.getTime());
        expect(t("Asia/Tokyo", s.eveningBlue.end)).toBe("17:36");
        expect(t("Asia/Tokyo", s.morningBlue.start)).toBe("05:15");
        expect(t("Asia/Tokyo", s.sunrise)).toBe("05:42");
    });

    it("西の経度でも、その暦日の時刻になる（パリの夏至）", () => {
        const s = sunTimes("2024-06-21", { lat: 48.8566, lng: 2.3522 })!;
        expect(t("Europe/Paris", s.sunrise)).toBe("05:48");
        expect(t("Europe/Paris", s.sunset)).toBe("21:58");
    });

    it("白夜で太陽がその高度を通らない日は null（作り話の時刻を出さない）", () => {
        const s = sunTimes("2024-06-21", { lat: 69.65, lng: 18.96 })!;    // トロムソ
        expect(s.sunrise).toBeNull();
        expect(s.sunset).toBeNull();
    });

    it("不正な日付・緯度は null", () => {
        expect(sunTimes("2024/09/27", TOKYO)).toBeNull();
        expect(sunTimes("2024-09-27", { lat: 95, lng: 0 })).toBeNull();
    });
});

describe("時刻帯", () => {
    it("台帳の国を時刻帯に。国が無い行は日本・知らない国は null", () => {
        expect(timeZoneForCountry(undefined)).toBe("Asia/Tokyo");
        expect(timeZoneForCountry("フランス")).toBe("Europe/Paris");
        expect(timeZoneForCountry("アメリカ")).toBeNull();
    });

    it("その時刻帯での今日", () => {
        const now = new Date("2026-09-30T20:00:00Z");   // 東京は 10/1 5:00
        expect(todayIn("Asia/Tokyo", now)).toBe("2026-10-01");
        expect(todayIn("Europe/Paris", now)).toBe("2026-09-30");
    });
});
