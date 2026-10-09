import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseWeather, type WxHour } from "../weatherKit";
import {
    alertText, dayLight, glowChance, nightChance, pickAlert, weatherOf, weekLight, windowStats,
} from "../lightOutlook";
import { lightSpotOf } from "../lightLedger";
import { sunTimes } from "../sunTimes";

/**
 * 光の見込み（純関数）。WeatherKit の**固定の応答**（`fixtures/weatherkit-tokyo.json`）で見張る。
 *
 * 固定の応答の中身（東京・2026-10-09 20:00 JST から60時間）:
 *   - 10/10 の朝（3〜7時）: 下層の雲 10%・中層 40%・降水 5%  → 朝焼け「高」の形
 *   - 10/10 の夕方（15〜19時）: 雨（降水 70%・Rain）
 *   - それ以外: くもり（雲量 90%・下層 80%）
 */
const FIXTURE = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "weatherkit-tokyo.json"), "utf8"));
const NOW = new Date("2026-10-09T11:00:00Z");   // 20:00 JST
const WX = parseWeather(FIXTURE, NOW.getTime());
/**
 * **いまの本物の WeatherKit の形**: 層ごとの雲量（`cloudCover*AltPct`）が入っていない
 * （2026-10-09 に東京駅・本番の鍵で確かめた）。同じ固定の応答から層の項目だけを抜く
 */
const NO_LAYER = (() => {
    const j = structuredClone(FIXTURE);
    for (const h of j.forecastHourly.hours) {
        delete h.cloudCoverLowAltPct; delete h.cloudCoverMidAltPct; delete h.cloudCoverHighAltPct;
    }
    return j;
})();
const WX_NO_LAYER = parseWeather(NO_LAYER, NOW.getTime());
const SPOT = lightSpotOf("SPOT-hamarikyu")!;

const H = 3_600_000;
const hour = (t: number, o: Partial<WxHour> = {}): WxHour => ({ t, cloud: 0.5, rain: 0, code: "PartlyCloudy", ...o });
/** t0 から n 時間、同じ空 */
const flat = (t0: number, n: number, o: Partial<WxHour>) => Array.from({ length: n }, (_, i) => hour(t0 + i * H, o));

describe("窓の平均（windowStats）", () => {
    it("窓を覆う予報が無ければ null（無いものから見込みを作らない）", () => {
        const hours = flat(10 * H, 3, {});
        expect(windowStats(hours, 0, H)).toBeNull();          // 範囲の外
        expect(windowStats(hours, 9.5 * H, 11 * H)).toBeNull(); // 頭が欠けている
        expect(windowStats(hours, 12 * H, 13.5 * H)).toBeNull(); // 尻が欠けている
        expect(windowStats(hours, 10.5 * H, 12 * H)).not.toBeNull();
    });

    it("降水確率は最大・雲は平均。層が1つでも欠けると層は出さない", () => {
        const s = windowStats([hour(0, { cloud: 0.2, rain: 0.1, low: 0.1, mid: 0.3 }), hour(H, { cloud: 0.4, rain: 0.3, low: 0.3, high: 0.5 })], 0, 2 * H)!;
        expect(s.cloud).toBeCloseTo(0.3);
        expect(s.rain).toBe(0.3);
        expect(s.low).toBeCloseTo(0.2);
        expect(s.midHigh).toBeCloseTo(0.4);
        const noLayer = windowStats([hour(0, { low: 0.1, mid: 0.3 }), hour(H)], 0, 2 * H)!;
        expect(noLayer.low).toBeUndefined();
    });
});

describe("天気の言葉と見込み（目安の式）", () => {
    const s = (o: Partial<{ cloud: number; low: number; midHigh: number; rain: number; wet: boolean; hazy: boolean }>) =>
        ({ cloud: 0.4, rain: 0, wet: false, ...o });

    it("天気: 降る → 雨／雲 30% 未満 晴れ／70% 未満 くもり時々晴れ／それ以上 くもり", () => {
        expect(weatherOf(s({ wet: true, cloud: 0.1 }))).toBe("rain");
        expect(weatherOf(s({ rain: 0.5, cloud: 0.1 }))).toBe("rain");
        expect(weatherOf(s({ cloud: 0.29 }))).toBe("clear");
        expect(weatherOf(s({ cloud: 0.5 }))).toBe("partlyCloudy");
        expect(weatherOf(s({ cloud: 0.7 }))).toBe("cloudy");
    });

    it("焼け「高」: 降水 <20%・下層 <30%・中上層 20〜70%", () => {
        expect(glowChance(s({ low: 0.1, midHigh: 0.4, rain: 0.1 }))).toBe("high");
        // 中上層の雲が無い（快晴）は色が淡い → 中
        expect(glowChance(s({ cloud: 0.05, low: 0.05, midHigh: 0.05 }))).toBe("mid");
        // 下層の雲が地平線を塞ぐ → 中どまり／多ければ低
        expect(glowChance(s({ low: 0.4, midHigh: 0.4 }))).toBe("mid");
        expect(glowChance(s({ low: 0.7, midHigh: 0.4 }))).toBe("low");
        // 降りそう
        expect(glowChance(s({ low: 0.1, midHigh: 0.4, rain: 0.3 }))).toBe("mid");
        expect(glowChance(s({ low: 0.1, midHigh: 0.4, rain: 0.6 }))).toBe("low");
    });

    // 🔴 いまの WeatherKit は層ごとの雲量を返さない。「中」止まりだと知らせが1通も届かない
    it("層ごとの雲量が無いとき: 全体の雲量 20〜60%・降水 <20%・霞んでいない なら「高」", () => {
        expect(glowChance(s({ cloud: 0.4, rain: 0.1 }))).toBe("high");
        expect(glowChance(s({ cloud: 0.2, rain: 0 }))).toBe("high");
        expect(glowChance(s({ cloud: 0.6, rain: 0.19 }))).toBe("high");
        // 晴れすぎ（照らされる雲が無い）→ 中
        expect(glowChance(s({ cloud: 0.19, rain: 0 }))).toBe("mid");
        // 雲がやや多い・降りそう → 中
        expect(glowChance(s({ cloud: 0.7, rain: 0 }))).toBe("mid");
        expect(glowChance(s({ cloud: 0.4, rain: 0.2 }))).toBe("mid");
        // 霞んでいる → 中
        expect(glowChance(s({ cloud: 0.4, rain: 0, hazy: true }))).toBe("mid");
        // 多すぎ・降る → 低
        expect(glowChance(s({ cloud: 0.8, rain: 0 }))).toBe("low");
        expect(glowChance(s({ cloud: 0.4, rain: 0.4 }))).toBe("low");
        expect(glowChance(s({ cloud: 0.4, rain: 0, wet: true }))).toBe("low");
    });

    it("霞み: 見通し 10km 未満・湿度 90% 以上・霧やもやの conditionCode（応答に無い項目は見ない）", () => {
        const at = (o: Partial<WxHour>) => windowStats([hour(0, { cloud: 0.4, ...o }), hour(H, { cloud: 0.4, ...o })], 0, 2 * H)!;
        expect(at({}).hazy).toBeUndefined();
        expect(at({ vis: 24_000, hum: 0.7 }).hazy).toBeUndefined();
        expect(at({ vis: 8_000 }).hazy).toBe(true);
        expect(at({ hum: 0.92 }).hazy).toBe(true);
        expect(at({ code: "Haze" }).hazy).toBe(true);
        expect(at({ code: "Foggy" }).hazy).toBe(true);
        expect(glowChance(at({ hum: 0.95 }))).toBe("mid");
    });

    it("夜景: 雲 <30%・降水 <20% で高、雲 <70%・降水 <40% で中", () => {
        expect(nightChance(s({ cloud: 0.1 }))).toBe("high");
        expect(nightChance(s({ cloud: 0.5 }))).toBe("mid");
        expect(nightChance(s({ cloud: 0.8 }))).toBe("low");
        expect(nightChance(s({ cloud: 0.1, wet: true }))).toBe("low");
    });
});

describe("固定の応答から1日の光を作る", () => {
    it("応答を読めている（走査が空振りしていない）", () => {
        expect(WX.hours.length).toBe(60);
        expect(WX.hours[0].low).toBe(0.8);
        expect(SPOT).toMatchObject({ slug: "hamarikyu", name: "浜離宮恩賜庭園", timeZone: "Asia/Tokyo" });
    });

    it("10/10: 朝焼け 高（くもり時々晴れ）・夕焼け 低（雨）・夜景 低", () => {
        const d = dayLight(SPOT, "2026-10-10", WX)!;
        expect(d.morning).toEqual({ weather: "partlyCloudy", chance: "high" });
        expect(d.evening).toEqual({ weather: "rain", chance: "low" });
        expect(d.night?.chance).toBe("low");
        // 時刻は**スポットの現地の時計**（東京の10月の日の出は5時台・日の入りは17時台）
        expect(d.sunrise?.clock).toMatch(/^05:\d\d$/);
        expect(d.sunset?.clock).toMatch(/^17:\d\d$/);
        expect(d.sunrise?.at).toBe(sunTimes("2026-10-10", SPOT)!.sunrise!.toISOString());
        // ブルーアワーは日の出の前・日の入りの後
        expect(d.morningBlue.start!.at < d.sunrise!.at).toBe(true);
        expect(d.eveningBlue.start!.at > d.sunset!.at).toBe(true);
    });

    // 🔴 本物の応答の形（層ごとの雲量なし）でも「高」が出ること
    it("層ごとの雲量が無い応答でも、10/10 の朝焼けは「高」・夕焼けは「低」", () => {
        expect(WX_NO_LAYER.hours.every((h) => h.low === undefined && h.mid === undefined)).toBe(true);
        expect(WX_NO_LAYER.hours[0]).toMatchObject({ vis: 24_000, hum: 0.7 });
        const d = dayLight(SPOT, "2026-10-10", WX_NO_LAYER)!;
        expect(d.morning).toEqual({ weather: "partlyCloudy", chance: "high" });
        expect(d.evening).toEqual({ weather: "rain", chance: "low" });
        const pick = pickAlert([{ spot: SPOT, wx: WX_NO_LAYER }], NOW);
        expect(pick).toMatchObject({ kind: "sunrise", date: "2026-10-10" });
    });

    it("一覧は今日（現地の暦）から7日。予報の届かない日は時刻だけ（見込みは null）", () => {
        const week = weekLight(SPOT, WX, NOW);
        expect(week.map((d) => d.date)).toEqual([
            "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15",
        ]);
        // 今日の朝はもう予報の外（20:00 から先しか無い）
        expect(week[0].morning).toBeNull();
        expect(week[0].sunrise).not.toBeNull();
        // 3日目以降は60時間の外
        expect(week[4].morning).toBeNull();
        expect(week[4].evening).toBeNull();
        expect(week[4].sunset).not.toBeNull();
        // 予報が無くても光の時刻は出す
        expect(weekLight(SPOT, null, NOW)).toHaveLength(7);
    });

    it("現地の暦で「今日」を決める（パリは東京より7時間遅い）", () => {
        const paris = lightSpotOf("SPOT-amiens-cathedral")!;
        // 2026-10-09T23:30Z = パリ 10/10 01:30・東京 10/10 08:30
        expect(weekLight(paris, null, new Date("2026-10-09T21:30:00Z"))[0].date).toBe("2026-10-09");
        expect(weekLight(paris, null, new Date("2026-10-09T23:30:00Z"))[0].date).toBe("2026-10-10");
    });
});

describe("前の晩の知らせ（pickAlert・alertText）", () => {
    it("明日の朝焼け「高」を選び、日の出と着いていたい時刻を出す", () => {
        const pick = pickAlert([{ spot: SPOT, wx: WX }], NOW)!;
        expect(pick).toMatchObject({ kind: "sunrise", date: "2026-10-10", weather: "partlyCloudy" });
        expect(pick.eventClock).toMatch(/^05:\d\d$/);
        // 着いていたい時刻 = 朝のブルーアワーの始まり（日の出より前）
        expect(pick.readyClock! < pick.eventClock).toBe(true);
    });

    // 20:00 JST = 11:00 UTC は、南北アメリカでは同じ日の未明〜朝（ニューヨーク 7:00・ホノルル 1:00）。
    // 時刻はそのまま（利用者は日本・2026-10-09 owner）。「明日」は現地の暦で、壊れないことだけ見る
    it("南北アメリカのスポット（現地は未明〜朝）でも、現地の明日を選び、予報の範囲内・これから先の時刻になる", () => {
        const good = { hours: flat(NOW.getTime() - (NOW.getTime() % H), 8 * 24, { cloud: 0.4, low: 0.1, mid: 0.4, rain: 0, code: "PartlyCloudy" }), fetchedAt: 0 };
        const last = good.hours[good.hours.length - 1].t;
        for (const [slug, tz] of [
            ["statue-of-liberty", "America/New_York"], ["golden-gate-bridge", "America/Los_Angeles"],
            ["diamond-head", "Pacific/Honolulu"],
        ] as const) {
            const spot = lightSpotOf(`SPOT-${slug}`)!;
            expect(spot.timeZone).toBe(tz);
            const pick = pickAlert([{ spot, wx: good }], NOW)!;
            expect(pick).not.toBeNull();
            // 現地の今日は 10/09（日本の暦の 10/09 と同じ）→ 明日は 10/10
            expect(pick.date).toBe("2026-10-10");
            const st = sunTimes(pick.date, { lat: spot.lat, lng: spot.lng })!;
            const t = (pick.kind === "sunrise" ? st.sunrise : st.sunset)!.getTime();
            expect(t).toBeGreaterThan(NOW.getTime());
            expect(t).toBeLessThan(last);
            const text = alertText(pick, "ja");
            expect(text.title.length).toBeGreaterThan(0);
            expect(text.body).toMatch(/\d:\d\d/);
            expect(weekLight(spot, good, NOW)[0].date).toBe("2026-10-09");
        }
    });

    it("「高」が無ければ送らない（null）", () => {
        const gray = { hours: flat(NOW.getTime(), 60, { cloud: 0.9, low: 0.8, mid: 0.5, rain: 0.1, code: "Cloudy" }), fetchedAt: 0 };
        expect(pickAlert([{ spot: SPOT, wx: gray }], NOW)).toBeNull();
        expect(pickAlert([{ spot: SPOT, wx: null }], NOW)).toBeNull();
        expect(pickAlert([], NOW)).toBeNull();
    });

    it("複数あれば一番よいもの（下層の雲＋降水確率が小さい方）を1つ", () => {
        const better = { hours: WX.hours.map((h) => ({ ...h, low: Math.min(h.low ?? 0, 0.02), rain: Math.min(h.rain, 0.01) })), fetchedAt: 0 };
        const other = lightSpotOf("SPOT-chidorigafuchi")!;
        expect(pickAlert([{ spot: SPOT, wx: WX }, { spot: other, wx: better }], NOW)!.spot.slug).toBe("chidorigafuchi");
        // 同点なら先（＝「行きたい」に新しく入れた方）
        expect(pickAlert([{ spot: SPOT, wx: WX }, { spot: other, wx: WX }], NOW)!.spot.slug).toBe("hamarikyu");
    });

    it("文面（日本語）: 板の形。晴れでないときは「晴れそう」と言わない", () => {
        const pick = pickAlert([{ spot: SPOT, wx: WX }], NOW)!;
        const t = alertText(pick);
        // くもり時々晴れ → 「朝焼けになりそうです」
        expect(t.title).toBe("明日の朝、浜離宮恩賜庭園 が朝焼けになりそうです");
        // 時刻は先頭の0を落とす（板の「5:42」）
        expect(t.body).toMatch(/^日の出 5:\d\d・朝焼けの見込み 高い。\d:\d\d に着いていれば間に合います。$/);
        expect(alertText({ ...pick, weather: "clear" }).title).toBe("明日の朝、浜離宮恩賜庭園 が晴れそうです");
        expect(alertText({ ...pick, kind: "sunset", eventClock: "17:21", readyClock: "16:40", weather: "clear" }))
            .toEqual({ title: "明日の夕方、浜離宮恩賜庭園 が晴れそうです", body: "日の入り 17:21・夕焼けの見込み 高い。16:40 に着いていれば間に合います。" });
        // 着いていたい時刻が出せない日は、その一文を言わない
        expect(alertText({ ...pick, readyClock: null }).body).toMatch(/高い。$/);
    });

    it("文面（英語）: 英語の名前を使う", () => {
        const pick = pickAlert([{ spot: SPOT, wx: WX }], NOW)!;
        const t = alertText({ ...pick, weather: "clear" }, "en");
        expect(t.title).toBe("Tomorrow morning: clear skies likely at Hamarikyu Gardens");
        expect(t.body).toMatch(/^Sunrise 5:\d\d · Chance of morning glow: high\. Be there by \d:\d\d\.$/);
    });
});
