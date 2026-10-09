/**
 * **光の見込み**（純関数だけ。読み書き・通信は `lightForecast.ts` と `weatherKit.ts`）。
 *
 * 時間ごとの雲量・降水確率（WeatherKit）と、日の出・日の入りの時刻（`sunTimes.ts`・アプリと
 * 同じ式）から、その日の
 *
 *   - 朝焼け（日の出の前後）の見込み  高 / 中 / 低
 *   - 夕焼け（日の入りの前後）の見込み 高 / 中 / 低
 *   - 夜景（夕方のブルーアワーから2時間）の見込み 高 / 中 / 低
 *   - それぞれの時間の天気            晴れ / くもり時々晴れ / くもり / 雨
 *
 * を決める。
 *
 * ## 目安の式（控えめに倒す）
 *
 * 朝焼け・夕焼けは「地平線の下から差す低い光が、**中・上層の雲の底**を照らす」ときに色が出る。
 * 写真家の経験則と、焼け予報（SunsetWx など）が共通して言うのは次の3つ:
 *
 *   1. **下層の雲が地平線を塞ぐと光が届かない**（いちばん大きい減点）
 *   2. **中・上層の雲が 3〜7 割ほどあると、照らされる「幕」になって色が出る**
 *      （雲が全く無いと、空の色だけで淡い）
 *   3. **降っている・降りそうなら望めない**
 *
 * ここではそれを、窓（日の出は −60分〜+30分・日の入りは −30分〜+60分。焼けるのは
 * 日の出の前・日の入りの後が中心）の平均で見る:
 *
 *   - 高: 降水確率の最大 < 20%・下層の雲 < 30%・中上層の雲 20〜70%
 *   - 中: 降水確率の最大 < 40%・下層の雲 < 60%
 *   - 低: それ以外
 *
 * ### 層ごとの雲量が無いとき（いまの WeatherKit はこちら）
 *
 * 🔴 **最初は「層が無ければ『中』を上限にする」にしていた。** 2026-10-09 に本物の応答
 * （東京駅・本番の鍵）を読んだら、`forecastHourly` に `cloudCoverLowAltPct` / `MidAltPct` /
 * `HighAltPct` は**1つも入っていなかった**——つまり見込みが「中」止まりで、**知らせが1通も届かない**
 * 作りになっていた。全体の雲量（`cloudCover`）・降水確率・見通し・湿度・`conditionCode` で決める:
 *
 *   - 低: 降る（雨・雪…）・降水確率の最大 ≥ 40%・全体の雲量 ≥ 80%
 *         （8割を超えると、どの高さの雲でも地平線側が塞がっていることが多い）
 *   - 高: 降水確率の最大 < 20%・全体の雲量 20〜60%・霞んでいない
 *         （「ほどよく雲がある」。上の経験則の 3〜7 割を、層が分からないぶん上を 6 割に縮めた
 *          ——全体の雲量が多いほど、そのうち下層の雲が地平線を塞いでいる見込みが上がるため）
 *   - 中: それ以外。**晴れすぎ（雲量 20% 未満）も中**（照らされる雲が無く、色は空だけで淡い）
 *
 * 「霞んでいない」は: 見通し ≥ 10km（気象で「もや」と呼ぶのは 10km 未満から）・
 * 湿度 < 90%（湿度が高いと地平線近くが白く霞んで色が抜けやすい）・`conditionCode` が
 * 霧・もや・煙・砂塵（`Foggy`・`Haze`・`Smoky`・`BlowingDust`）でない。**応答に無い項目は見ない**
 * （無いことを理由に下げない）。霞んでいれば「高」を「中」に下げる。
 *
 * 夜景は空の色（ブルーアワー）と見通しなので、雲が少なく降らないほど良い:
 *
 *   - 高: 降水確率の最大 < 20%・雲量 < 30%
 *   - 中: 降水確率の最大 < 40%・雲量 < 70%
 *   - 低: それ以外
 *
 * 天気の言葉は窓の平均の雲量で: 30% 未満 晴れ・70% 未満 くもり時々晴れ・それ以上 くもり。
 * 降水確率の最大が 50% 以上か、`conditionCode` が降るもの（雨・雪・雷…）なら 雨。
 *
 * **見込みは目安で、外れることがある**——画面と通知はそう書く（デザインの板 LightAlert の注記）。
 */
import type { WxForecast, WxHour } from "./weatherKit";
import { addDays, clockIn, sunTimes, todayIn, type SunEvent } from "./sunTimes";
import type { LightSpot } from "./lightLedger";

export type Chance = "high" | "mid" | "low";
export type Weather = "clear" | "partlyCloudy" | "cloudy" | "rain";

/** 1つの時間帯の見込み */
export type Outlook = { weather: Weather; chance: Chance };

/** 時刻（その土地の時計 "HH:MM" と、瞬間 ISO） */
export type Clock = { at: string; clock: string };

export type DayLight = {
    /** その土地の暦日 "YYYY-MM-DD" */
    date: string;
    sunrise: Clock | null;
    sunset: Clock | null;
    morningBlue: { start: Clock | null; end: Clock | null };
    eveningBlue: { start: Clock | null; end: Clock | null };
    /** 朝焼け。予報の届かない日・日が昇らない日は null */
    morning: Outlook | null;
    /** 夕焼け */
    evening: Outlook | null;
    /** 夜景（夕方のブルーアワーから2時間） */
    night: Outlook | null;
};

const MIN = 60_000;
const HOUR = 60 * MIN;

/** 霞む `conditionCode`（霧・もや・煙・砂塵） */
const HAZY = /fog|haze|smok|dust/i;
/** 見通しがこれ未満なら霞んでいる（メートル。気象の「もや」は 10km 未満） */
export const HAZY_VISIBILITY_M = 10_000;
/** 湿度がこれ以上なら霞みやすい */
export const HAZY_HUMIDITY = 0.9;

/** 降るものの `conditionCode`（WeatherKit の一覧から。雪も「降る」に入れる） */
const WET = /rain|drizzle|shower|thunder|snow|sleet|flurr|hail|blizzard|hurricane|tropicalstorm|wintrymix/i;

type WindowStats = {
    cloud: number;
    /** 下層の雲。応答に無ければ undefined */
    low?: number;
    /** 中・上層の雲（多い方）。応答に無ければ undefined */
    midHigh?: number;
    /** 降水確率の最大 */
    rain: number;
    wet: boolean;
    /** 霞んでいるか（見通し・湿度・`conditionCode`。応答に無い項目は見ない） */
    hazy?: boolean;
};

/**
 * 窓 [from, to) に掛かる時間の平均。**窓を覆う予報が無ければ null**
 * （予報の範囲の外・時間が抜けている）——無いものから見込みを作らない。
 */
export function windowStats(hours: readonly WxHour[], from: number, to: number): WindowStats | null {
    const hit = hours.filter((h) => h.t < to && h.t + HOUR > from);
    if (hit.length === 0) return null;
    // 窓の両端が予報の中に入っていること（端だけ掛かった1時間で決めない）
    const first = hit[0].t, last = hit[hit.length - 1].t + HOUR;
    if (first > from || last < to) return null;
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const layered = hit.every((h) => h.low !== undefined && (h.mid !== undefined || h.high !== undefined));
    const vis = hit.map((h) => h.vis).filter((v): v is number => v !== undefined);
    const hum = hit.map((h) => h.hum).filter((v): v is number => v !== undefined);
    const hazy = hit.some((h) => HAZY.test(h.code))
        || (vis.length > 0 && Math.min(...vis) < HAZY_VISIBILITY_M)
        || (hum.length > 0 && avg(hum) >= HAZY_HUMIDITY);
    return {
        cloud: avg(hit.map((h) => h.cloud)),
        ...(layered ? {
            low: avg(hit.map((h) => h.low ?? 0)),
            midHigh: avg(hit.map((h) => Math.max(h.mid ?? 0, h.high ?? 0))),
        } : {}),
        rain: Math.max(...hit.map((h) => h.rain)),
        wet: hit.some((h) => WET.test(h.code)),
        ...(hazy ? { hazy } : {}),
    };
}

export function weatherOf(s: WindowStats): Weather {
    if (s.wet || s.rain >= 0.5) return "rain";
    if (s.cloud < 0.3) return "clear";
    if (s.cloud < 0.7) return "partlyCloudy";
    return "cloudy";
}

/** 朝焼け・夕焼けの見込み（上の「目安の式」） */
export function glowChance(s: WindowStats): Chance {
    if (weatherOf(s) === "rain") return "low";
    if (s.low !== undefined && s.midHigh !== undefined) {
        if (s.rain < 0.2 && s.low < 0.3 && s.midHigh >= 0.2 && s.midHigh <= 0.7) return "high";
        if (s.rain < 0.4 && s.low < 0.6) return "mid";
        return "low";
    }
    // 層が分からない: 全体の雲量で見る（上の「層ごとの雲量が無いとき」）
    if (s.rain >= 0.4 || s.cloud >= 0.8) return "low";
    if (s.rain < 0.2 && s.cloud >= 0.2 && s.cloud <= 0.6 && !s.hazy) return "high";
    return "mid";
}

/** 夜景の見込み（上の「目安の式」） */
export function nightChance(s: WindowStats): Chance {
    if (weatherOf(s) === "rain") return "low";
    if (s.rain < 0.2 && s.cloud < 0.3) return "high";
    if (s.rain < 0.4 && s.cloud < 0.7) return "mid";
    return "low";
}

const outlook = (s: WindowStats | null, chanceOf: (s: WindowStats) => Chance): Outlook | null =>
    s ? { weather: weatherOf(s), chance: chanceOf(s) } : null;

function clockOf(timeZone: string, t: SunEvent): Clock | null {
    const clock = clockIn(timeZone, t);
    return t && clock ? { at: t.toISOString(), clock } : null;
}

/** 日の出の窓（−60分〜+30分）・日の入りの窓（−30分〜+60分）・夜景の窓（ブルーアワーの始まりから2時間） */
export const SUNRISE_WINDOW = { before: 60 * MIN, after: 30 * MIN };
export const SUNSET_WINDOW = { before: 30 * MIN, after: 60 * MIN };
export const NIGHT_WINDOW = 2 * HOUR;

/** その場所・その日の光（時刻は常に出す。見込みは予報が届くときだけ） */
export function dayLight(spot: Pick<LightSpot, "lat" | "lng" | "timeZone">, date: string, wx: WxForecast | null): DayLight | null {
    const st = sunTimes(date, { lat: spot.lat, lng: spot.lng });
    if (!st) return null;
    const hours = wx?.hours ?? [];
    const tz = spot.timeZone;
    const rise = st.sunrise?.getTime(), set = st.sunset?.getTime(), blue = st.eveningBlue.start?.getTime();
    return {
        date,
        sunrise: clockOf(tz, st.sunrise),
        sunset: clockOf(tz, st.sunset),
        morningBlue: { start: clockOf(tz, st.morningBlue.start), end: clockOf(tz, st.morningBlue.end) },
        eveningBlue: { start: clockOf(tz, st.eveningBlue.start), end: clockOf(tz, st.eveningBlue.end) },
        morning: rise === undefined ? null
            : outlook(windowStats(hours, rise - SUNRISE_WINDOW.before, rise + SUNRISE_WINDOW.after), glowChance),
        evening: set === undefined ? null
            : outlook(windowStats(hours, set - SUNSET_WINDOW.before, set + SUNSET_WINDOW.after), glowChance),
        night: blue === undefined ? null
            : outlook(windowStats(hours, blue, blue + NIGHT_WINDOW), nightChance),
    };
}

/** 今日（その土地の暦）から n 日ぶん */
export function weekLight(spot: Pick<LightSpot, "lat" | "lng" | "timeZone">, wx: WxForecast | null, now: Date, days = 7): DayLight[] {
    const today = todayIn(spot.timeZone, now);
    if (!today) return [];
    const out: DayLight[] = [];
    for (let i = 0; i < days; i++) {
        const d = dayLight(spot, addDays(today, i), wx);
        if (d) out.push(d);
    }
    return out;
}

// ─── 前の晩の知らせ ───────────────────────────────────────

export type AlertPick = {
    spot: LightSpot;
    /** 朝焼け（日の出）か夕焼け（日の入り）か */
    kind: "sunrise" | "sunset";
    date: string;
    weather: Weather;
    /** 日の出・日の入りの時刻（その土地の時計） */
    eventClock: string;
    /** 着いていたい時刻（朝: ブルーアワーの始まり／夕: ゴールデンアワーの始まり）。出せなければ null */
    readyClock: string | null;
    /** 小さいほど良い（降水確率の最大＋下層の雲） */
    score: number;
};

/**
 * 明日（その土地の暦）の朝・夕で「見込み 高」のものを1つ選ぶ。**無ければ null。**
 *
 * 選び方: 下層の雲と降水確率の和が小さいもの → 同じなら朝 → 同じなら「行きたい」に新しく入れた方
 * （`spots` は新しい順で渡す）。
 */
export function pickAlert(
    candidates: readonly { spot: LightSpot; wx: WxForecast | null }[],
    now: Date,
): AlertPick | null {
    let best: AlertPick | null = null;
    for (const { spot, wx } of candidates) {
        if (!wx) continue;
        const today = todayIn(spot.timeZone, now);
        if (!today) continue;
        const date = addDays(today, 1);
        const st = sunTimes(date, { lat: spot.lat, lng: spot.lng });
        if (!st) continue;
        const sides: { kind: AlertPick["kind"]; event: SunEvent; ready: SunEvent; win: { before: number; after: number } }[] = [
            { kind: "sunrise", event: st.sunrise, ready: st.morningBlue.start, win: SUNRISE_WINDOW },
            { kind: "sunset", event: st.sunset, ready: st.eveningGolden.start, win: SUNSET_WINDOW },
        ];
        for (const side of sides) {
            if (!side.event) continue;
            const t = side.event.getTime();
            const s = windowStats(wx.hours, t - side.win.before, t + side.win.after);
            if (!s || glowChance(s) !== "high") continue;
            const eventClock = clockIn(spot.timeZone, side.event);
            if (!eventClock) continue;
            const score = s.rain + (s.low ?? s.cloud);
            // 厳密に良いときだけ入れ替える（同点なら先に来た＝朝・新しい方が残る）
            if (!best || score < best.score) {
                best = {
                    spot, kind: side.kind, date, weather: weatherOf(s), eventClock,
                    readyClock: clockIn(spot.timeZone, side.ready), score,
                };
            }
        }
    }
    return best;
}

/** "05:42" → "5:42"（板の書き方） */
const short = (clock: string) => clock.replace(/^0(\d):/, "$1:");

/**
 * 知らせの文面。**日本語と英語の両方を作れる**（いま送るのは日本語だけ。`lightForecast.ts` の注記）。
 *
 * 板（LightAlert）の文面:
 *   「明日の朝、[撮影地の名前] が晴れそうです」
 *   「日の出 [5:42]・朝焼けの見込み [高い]。[4:50] に出れば間に合います。」
 *
 * **「に出れば」は「に着いていれば」に替えた。** サーバーは利用者がどこから出るかを知らないので、
 * 出る時刻は言えない。言えるのは「その時刻に現地に居れば間に合う」まで（朝はブルーアワーの始まり、
 * 夕はゴールデンアワーの始まり）。
 * **晴れでないとき（くもり時々晴れ）に「晴れそうです」と言わない**——そのときは「焼けそうです」。
 */
export function alertText(p: AlertPick, lang: "ja" | "en" = "ja"): { title: string; body: string } {
    const morning = p.kind === "sunrise";
    const clear = p.weather === "clear";
    if (lang === "en") {
        const name = p.spot.nameEn || p.spot.name;
        const when = morning ? "Tomorrow morning" : "Tomorrow evening";
        const title = clear ? `${when}: clear skies likely at ${name}` : `${when}: a colorful sky likely at ${name}`;
        const head = `${morning ? "Sunrise" : "Sunset"} ${short(p.eventClock)} · Chance of ${morning ? "morning" : "evening"} glow: high.`;
        return { title, body: p.readyClock ? `${head} Be there by ${short(p.readyClock)}.` : head };
    }
    const when = morning ? "明日の朝" : "明日の夕方";
    const title = clear ? `${when}、${p.spot.name} が晴れそうです` : `${when}、${p.spot.name} が${morning ? "朝焼け" : "夕焼け"}になりそうです`;
    const head = `${morning ? "日の出" : "日の入り"} ${short(p.eventClock)}・${morning ? "朝焼け" : "夕焼け"}の見込み 高い。`;
    return { title, body: p.readyClock ? `${head}${short(p.readyClock)} に着いていれば間に合います。` : head };
}
