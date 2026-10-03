import { describe, it, expect } from "vitest";
import { sunTimes, clockIn } from "../sunTimes";
import {
    LIGHT_MAX_OFFSET, compass, direction, guideTimes, lightBlocksFor, lightDateLabel, lightNote, lightSheet,
    spanText, splitGuides, ymdAt,
} from "../spotLight";

/**
 * 撮影地ページの「光の時刻」（`sunTimes` の方角と `spotLight`）。アプリの `SpotLightTests.swift` と同じ値。
 *
 * **基準は国立天文台の暦**（暦計算室「日の出入り」2026年・各地）。暦の地点の座標で計算し、
 * 時刻は ±2分・方角は ±0.5° に収まることを確かめる
 */
const TOKYO_TZ = "Asia/Tokyo";

type Almanac = {
    place: string; ymd: string; lat: number; lng: number;
    sunrise: string; riseAzimuth: number; sunset: string; setAzimuth: number;
};

const ALMANAC: Almanac[] = [
    { place: "東京・夏至", ymd: "2026-06-21", lat: 35.6581, lng: 139.7414, sunrise: "04:25", riseAzimuth: 60.0, sunset: "19:00", setAzimuth: 300.0 },
    { place: "東京・冬至", ymd: "2026-12-22", lat: 35.6581, lng: 139.7414, sunrise: "06:47", riseAzimuth: 118.6, sunset: "16:32", setAzimuth: 241.4 },
    { place: "東京・春分", ymd: "2026-03-20", lat: 35.6581, lng: 139.7414, sunrise: "05:45", riseAzimuth: 89.8, sunset: "17:52", setAzimuth: 270.5 },
    { place: "根室・夏至", ymd: "2026-06-21", lat: 43.3333, lng: 145.5833, sunrise: "03:37", riseAzimuth: 55.9, sunset: "19:02", setAzimuth: 304.1 },
    { place: "鹿児島・冬至", ymd: "2026-12-21", lat: 31.6, lng: 130.55, sunrise: "07:13", riseAzimuth: 117.2, sunset: "17:18", setAzimuth: 242.8 },
];

/** 日本時間の "HH:MM" をその日の時刻（ミリ秒）に */
const jst = (ymd: string, hm: string) => Date.parse(`${ymd}T${hm}:00+09:00`);

describe("国立天文台の暦と合う（時刻 ±2分・方角 ±0.5°）", () => {
    for (const a of ALMANAC) {
        it(a.place, () => {
            const s = sunTimes(a.ymd, { lat: a.lat, lng: a.lng })!;
            expect(Math.abs(s.sunrise!.getTime() - jst(a.ymd, a.sunrise))).toBeLessThanOrEqual(120_000);
            expect(Math.abs(s.sunset!.getTime() - jst(a.ymd, a.sunset))).toBeLessThanOrEqual(120_000);
            expect(Math.abs(s.sunriseAzimuth! - a.riseAzimuth)).toBeLessThanOrEqual(0.5);
            expect(Math.abs(s.sunsetAzimuth! - a.setAzimuth)).toBeLessThanOrEqual(0.5);
        });
    }
});

describe("方角の言い方", () => {
    it("16方位と度", () => {
        expect(compass(0)).toBe("北");
        expect(compass(67)).toBe("東北東");
        expect(compass(90)).toBe("東");
        expect(compass(241.4)).toBe("西南西");
        expect(compass(300)).toBe("西北西");
        expect(compass(359)).toBe("北");
        expect(compass(67, false)).toBe("ENE");
        expect(direction(67.4)).toBe("東北東 67°");
        expect(direction(359.7)).toBe("北 0°");
        expect(direction(null)).toBeUndefined();
    });
});

describe("段", () => {
    it("東京の夏至: 段の中は時刻の順・方角つき", () => {
        const blocks = lightBlocksFor("2026-06-21", { lat: 35.6581, lng: 139.7414 }, TOKYO_TZ);
        expect(blocks.map((b) => b.title)).toEqual(["朝", "夕"]);
        const morning = blocks[0].rows;
        expect(morning.map((r) => r.label)).toEqual(["ブルーアワー", "日の出", "ゴールデンアワー"]);
        expect(morning[1].detail).toBe("東北東 60°");
        expect(morning[1].value.startsWith("04:2")).toBe(true);
        const evening = blocks[1].rows;
        expect(evening.map((r) => r.label)).toEqual(["ゴールデンアワー", "日の入り", "ブルーアワー"]);
        expect(evening[1].detail).toBe("西北西 300°");
        // 朝は帯の終わりの順、夕は帯の始まりの順（"HH:MM" は文字の順＝時刻の順）
        const morningEnds = morning.map((r) => r.value.slice(-5));
        expect(morningEnds).toEqual([...morningEnds].sort());
        const eveningStarts = evening.map((r) => r.value.slice(0, 5));
        expect(eveningStarts).toEqual([...eveningStarts].sort());
        // ブルー ↔ ゴールデンが −4° でつながる
        expect(morning[0].value.split("–").pop()).toBe(morning[2].value.slice(0, 5));
        expect(evening[0].value.split("–").pop()).toBe(evening[2].value.slice(0, 5));
    });

    it("英語の札", () => {
        const blocks = lightBlocksFor("2026-06-21", { lat: 35.6581, lng: 139.7414 }, TOKYO_TZ, false);
        expect(blocks.map((b) => b.title)).toEqual(["Morning", "Evening"]);
        expect(blocks[0].rows.map((r) => r.label)).toEqual(["Blue hour", "Sunrise", "Golden hour"]);
        expect(blocks[0].rows[1].detail).toBe("ENE 60°");
    });

    it("白夜（トロムソの夏至）: 時刻を作らず「白夜（沈まない）」・方角は出さない", () => {
        const blocks = lightBlocksFor("2024-06-21", { lat: 69.65, lng: 18.96 }, "Europe/Oslo");
        const sunrise = blocks[0].rows.find((r) => r.label === "日の出");
        expect(sunrise?.value).toBe("白夜（沈まない）");
        expect(sunrise?.detail).toBeUndefined();
        expect(blocks[1].rows.find((r) => r.label === "日の入り")?.value).toBe("白夜（沈まない）");
        expect(blocks[1].rows[0].label).toBe("ゴールデンアワー");
        expect(blocks[1].rows[0].value.endsWith("–（翌朝まで）")).toBe(true);
        expect(sunTimes("2024-06-21", { lat: 69.65, lng: 18.96 })!.sunriseAzimuth).toBeNull();
    });

    it("極夜（トロムソの冬至）: 「極夜（昇らない）」。ゴールデンアワーも出さない", () => {
        const blocks = lightBlocksFor("2024-12-21", { lat: 69.65, lng: 18.96 }, "Europe/Oslo");
        const rows = blocks.flatMap((b) => b.rows);
        expect(blocks[0].rows.find((r) => r.label === "日の出")?.value).toBe("極夜（昇らない）");
        expect(rows.some((r) => r.label === "ゴールデンアワー")).toBe(false);
        expect(rows.some((r) => r.value.endsWith("–") || r.value.startsWith("–"))).toBe(false);
    });

    it("片方の端しか無い帯は言葉で開く", () => {
        const t = new Date(1_000_000_000_000);
        expect(spanText({ start: t, end: null }, "UTC")).toBe("01:46–（翌朝まで）");
        expect(spanText({ start: null, end: t }, "UTC")).toBe("（前夜から）–01:46");
        expect(spanText({ start: null, end: null }, "UTC")).toBeNull();
    });

    it("昇るが 6° まで上がらない日（北緯63°の冬至）は、ゴールデンアワーが朝から夕まで1本", () => {
        const blocks = lightBlocksFor("2026-12-21", { lat: 63.0, lng: 10.4 }, "Europe/Oslo");
        const golden = blocks.flatMap((b) => b.rows).filter((r) => r.label === "ゴールデンアワー");
        expect(golden).toHaveLength(1);
        expect(golden[0].value.endsWith("（一日中・太陽が 6° より上がらない）")).toBe(true);
        expect(golden[0].value).toMatch(/^\d{2}:\d{2}–\d{2}:\d{2}/);
        expect(blocks[0].rows.find((r) => r.label === "日の出")?.detail).toBeTruthy();
    });
});

describe("日付", () => {
    // 2026-10-03 15:30 UTC は東京では 10/4 の 0:30
    const now = new Date(1_791_041_400_000);

    it("その土地の暦で送る・札", () => {
        expect(ymdAt(0, now, TOKYO_TZ)).toBe("2026-10-04");
        expect(ymdAt(0, now, "Europe/Paris")).toBe("2026-10-03");
        expect(ymdAt(-1, now, TOKYO_TZ)).toBe("2026-10-03");
        expect(lightDateLabel("2026-10-03", 0, "2026-10-03", true)).toBe("10月3日（土） · 今日");
        expect(lightDateLabel("2026-10-04", 1, "2026-10-03", true)).toBe("10月4日（日） · 明日");
        expect(lightDateLabel("2027-01-05", 94, "2026-10-03", true)).toBe("2027年1月5日（火）");
        expect(lightDateLabel("2026-10-03", 0, "2026-10-03", false)).toBe("Sat, Oct 3 · Today");
    });

    it("節: 表に無い国・読めない座標は null、送れる幅の外は端で止める", () => {
        const japan = lightSheet("日本", { lat: 35.68, lng: 139.77 }, 0, now, true)!;
        expect(japan.timeZone).toBe(TOKYO_TZ);
        expect(japan.todayYMD).toBe("2026-10-04");
        expect(japan.ymd).toBe("2026-10-04");
        expect(japan.blocks.length).toBeGreaterThan(0);
        expect(lightSheet(undefined, { lat: 35.68, lng: 139.77 }, 0, now, true)?.timeZone).toBe(TOKYO_TZ);
        expect(lightSheet("アメリカ", { lat: 40.7, lng: -74.0 }, 0, now, true)).toBeNull();
        expect(lightSheet("日本", { lat: 95, lng: 139.77 }, 0, now, true)).toBeNull();
        expect(lightSheet("日本", { lat: NaN, lng: 139.77 }, 0, now, true)).toBeNull();
        expect(lightSheet("日本", { lat: 35.68, lng: 139.77 }, 1, now, true)?.ymd).toBe("2026-10-05");
        expect(lightSheet("日本", { lat: 35.68, lng: 139.77 }, 9999, now, true)?.ymd).toBe(ymdAt(LIGHT_MAX_OFFSET, now, TOKYO_TZ));
    });

    it("時刻はその土地の時計（日の出の行がその時刻帯の値）", () => {
        const s = lightSheet("フランス", { lat: 48.8584, lng: 2.2945 }, 0, now, true)!;
        const rise = sunTimes(s.ymd, { lat: 48.8584, lng: 2.2945 })!.sunrise;
        expect(s.blocks[0].rows.find((r) => r.label === "日の出")?.value).toBe(clockIn("Europe/Paris", rise));
    });
});

describe("注記・台帳の文", () => {
    it("注記", () => {
        expect(lightNote(TOKYO_TZ).startsWith("時刻は日本時間。")).toBe(true);
        expect(lightNote("Europe/Paris").startsWith("時刻は現地時間（Europe/Paris）。")).toBe(true);
        expect(lightNote(TOKYO_TZ)).toContain("ゴールデンアワーは太陽の高さが 6° から −4°");
        expect(lightNote(TOKYO_TZ, false)).toContain("Golden hour is when the sun is between 6° and −4°");
    });

    it("夜明け・朝は朝の段、夕方の斜光・日没後は夕の段、日中・夜は撮影ガイドに残す", () => {
        const list = [
            { time: "night", text: "夜景" }, { time: "goldenHour", text: "夕日" },
            { time: "dawn", text: "朝霧" }, { time: "day", text: "日中" }, { time: "dusk", text: "残照" },
        ];
        const split = splitGuides(list);
        expect(split.morning.map((t) => t.time)).toEqual(["dawn"]);
        expect(split.evening.map((t) => t.time)).toEqual(["goldenHour", "dusk"]);
        expect(guideTimes(list, true).map((t) => t.time)).toEqual(["night", "day"]);
        expect(guideTimes(list, false).map((t) => t.time)).toEqual(["night", "goldenHour", "dawn", "day", "dusk"]);
    });
});
