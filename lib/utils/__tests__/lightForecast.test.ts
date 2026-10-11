import { describe, it, expect } from "vitest";
import {
    parseLightForecast, parseWeatherLogo, lightCards, weekLines, failureOf, failureText, shortClock, dayWord, noteFor, DEFAULT_ATTRIBUTION,
    type LightDay, type LightForecast, type LightPlace,
} from "../lightForecast";

// 光と天気の知らせの「画面に出すもの」（iOS の `LightForecastText` と同じ決め方）

const NOW = new Date("2026-10-11T03:00:00.000Z"); // 東京 12:00
const c = (at: string, clock: string) => ({ at, clock });
const d = (date: string, extra: Partial<LightDay> = {}): LightDay => ({
    date, sunrise: null, sunset: null, eveningBlue: null, morning: null, evening: null, night: null, ...extra,
});
const place = (key: string, days: LightDay[]): LightPlace => ({ key, slug: key, name: key, timeZone: "Asia/Tokyo", forecast: true, days });
const fc = (places: LightPlace[]): LightForecast => ({ places, attribution: DEFAULT_ATTRIBUTION });

describe("札", () => {
    it("見込みの高い時間帯を選び、「いつ」の早い順に並べ、真鍮の縁は「高」のいちばん早い1枚だけ", () => {
        const cards = lightCards(fc([
            place("far-high", [d("2026-10-14", { sunrise: c("2026-10-13T20:44:00Z", "05:44"), morning: { weather: "clear", chance: "high" } })]),
            place("near-mid", [d("2026-10-12", { sunset: c("2026-10-12T08:21:00Z", "17:21"), evening: { weather: "partlyCloudy", chance: "mid" } })]),
            place("near-high", [d("2026-10-13", { sunrise: c("2026-10-12T20:43:00Z", "05:43"), morning: { weather: "clear", chance: "high" } })]),
        ]), NOW, "ja");
        expect(cards.map((x) => x.key)).toEqual(["near-mid", "near-high", "far-high"]);
        expect(cards.map((x) => x.isBest)).toEqual([false, true, false]);
        expect(cards[0]).toMatchObject({ when: "明日 · 日の入り 17:21", weather: "くもり時々晴れ", kind: "夕焼け 見込み中", tone: "evening" });
        expect(cards[1].kind).toBe("朝焼け 見込み高");
    });

    it("「高」が無い週は縁を付けない・低いときは「見込み低」だけ", () => {
        const cards = lightCards(fc([
            place("low", [d("2026-10-12", { sunrise: c("2026-10-11T20:42:00Z", "05:42"), morning: { weather: "rain", chance: "low" } })]),
        ]), NOW, "ja");
        expect(cards[0]).toMatchObject({ isBest: false, kind: "見込み低", tone: "low", weather: "雨" });
    });

    it("今日のもう過ぎた時間帯は選ばない（朝焼けを昼に勧めない）", () => {
        const cards = lightCards(fc([
            place("today", [d("2026-10-11", {
                sunrise: c("2026-10-10T20:41:00Z", "05:41"), morning: { weather: "clear", chance: "high" },
                sunset: c("2026-10-11T08:23:00Z", "17:23"), evening: { weather: "cloudy", chance: "mid" },
            })]),
        ]), NOW, "ja");
        expect(cards[0]).toMatchObject({ when: "今日 · 日の入り 17:23", kind: "夕焼け 見込み中", isBest: false });
    });

    it("予報の無い場所は光の時刻だけで後ろに回す", () => {
        const cards = lightCards(fc([
            place("nofc", [d("2026-10-12", { sunrise: c("2026-10-11T20:42:00Z", "05:42") })]),
            place("fc", [d("2026-10-15", { sunrise: c("2026-10-14T20:45:00Z", "05:45"), morning: { weather: "clear", chance: "mid" } })]),
        ]), NOW, "en");
        expect(cards.map((x) => x.key)).toEqual(["fc", "nofc"]);
        expect(cards[1]).toMatchObject({ weather: "No forecast", kind: "Sun times only", tone: "none", when: "Tomorrow · Sunrise 5:42" });
    });

    it("7日の行は日ごとに朝・夕・夜（予報の無い時間帯は「予報なし」）", () => {
        const lines = weekLines(place("p", [
            d("2026-10-12", { sunrise: c("2026-10-11T20:42:00Z", "05:42"), morning: { weather: "clear", chance: "high" }, sunset: c("2026-10-12T08:21:00Z", "17:21") }),
            d("2026-10-15", { sunrise: c("2026-10-14T20:45:00Z", "05:45") }),
        ]), NOW, "ja");
        expect(lines[0].title).toBe("明日");
        expect(lines[0].items).toEqual([
            { event: "日の出 5:42", outlook: "朝焼け 見込み高 · 晴れ", chance: "high" },
            { event: "日の入り 17:21", outlook: "夕焼け 予報なし", chance: null },
        ]);
        expect(lines[1].title).toBe("10月15日（木）");
    });
});

describe("応答を読む", () => {
    it("出典が無い・https でないときは Apple Weather の既定に倒す（出典は必ず出す）", () => {
        expect(parseLightForecast({ places: [] })!.attribution).toEqual(DEFAULT_ATTRIBUTION);
        expect(parseLightForecast({ places: [], attribution: { serviceName: "x", legalUrl: "javascript:alert(1)" } })!.attribution).toEqual(DEFAULT_ATTRIBUTION);
        expect(parseLightForecast({ places: [], attribution: { serviceName: "Apple Weather", legalUrl: "https://example.com/l" } })!.attribution.legalUrl).toBe("https://example.com/l");
    });

    it("形のおかしい場所・見込みは落とし、読める分は出す。本文がオブジェクトでなければ null", () => {
        const f = parseLightForecast({ places: [{ key: "a", name: "A", days: [{ date: "2026-10-12", morning: { weather: "sunny", chance: "high" } }] }, { name: "鍵なし" }, 3] })!;
        expect(f.places).toHaveLength(1);
        expect(f.places[0].days[0].morning).toBeNull();
        expect(parseLightForecast(null)).toBeNull();
    });
});

describe("言葉", () => {
    it("403 は Pro でない・503 は読めない・401 はログイン。Pro の文言は購入へ誘わない", () => {
        expect([403, 503, 401, 500].map(failureOf)).toEqual(["notPro", "unavailable", "signedOut", "other"]);
        for (const l of ["ja", "en"] as const) {
            const t = failureText("notPro", l);
            expect(`${t.title}${t.body}`).not.toMatch(/購入|アップグレード|買|Subscribe|Upgrade|Buy/);
        }
    });
    it("時刻と日の書き方", () => {
        expect(shortClock("05:42")).toBe("5:42");
        expect(shortClock("17:21")).toBe("17:21");
        expect(dayWord("2026-10-17", "2026-10-11", "ja")).toBe("土曜");
        expect(dayWord("2026-10-17", "2026-10-11", "en")).toBe("Sat");
    });
    it("英語ではサーバーの日本語の注記を出さない", () => {
        const f = { ...fc([]), note: "日本語の注記" };
        expect(noteFor(f, "ja")).toBe("日本語の注記");
        expect(noteFor(f, "en")).not.toContain("日本語");
    });
});

describe("Apple Weather のロゴ", () => {
    it("dark の 1x・2x・3x を Apple の配信元の絶対 URL にする", () => {
        expect(parseWeatherLogo({
            "logoDark@1x": "/assets/branding/en/a_1X.png", "logoDark@2x": "/assets/branding/en/a_2X.png", "logoDark@3x": "/assets/branding/en/a_3X.png",
        })).toEqual({
            x1: "https://weatherkit.apple.com/assets/branding/en/a_1X.png",
            x2: "https://weatherkit.apple.com/assets/branding/en/a_2X.png",
            x3: "https://weatherkit.apple.com/assets/branding/en/a_3X.png",
        });
    });
    it("/assets/ の外・別のホスト・欠けは null（文字の表記に倒す）", () => {
        const ok = { "logoDark@1x": "/assets/a.png", "logoDark@2x": "/assets/b.png", "logoDark@3x": "/assets/c.png" };
        expect(parseWeatherLogo({ ...ok, "logoDark@1x": "//evil.example/a.png" })).toBeNull();
        expect(parseWeatherLogo({ ...ok, "logoDark@2x": "/assets/../x.png" })).toBeNull();
        expect(parseWeatherLogo({ ...ok, "logoDark@3x": undefined })).toBeNull();
        expect(parseWeatherLogo(null)).toBeNull();
    });
});
