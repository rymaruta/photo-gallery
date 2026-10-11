// lib/utils/spotSky.ts
//
// **座標から計算できる撮影の事実**（2026-10-11・owner「検索で見つけてもらう」「写真が無くても役立つ撮影ガイド」）。
//
//   1. 日の出・日の入りの方角の振れ幅（6月21日ごろと12月21日ごろ）と、その短い要約文
//   2. 天の川（銀河中心）が見える月と時刻帯（天文薄明の外・地平線から 10° 以上）
//   3. 今後12か月の新月の日（その土地の暦）
//
// どれも**計算だけ**（作り話を入れない）。ビルド時にサーバーで計算してページに焼く＝検索に読まれる。
// 画面はここが返す値（文字と数）だけを受け取る。
//
// ## 式と出典
//
//   - 太陽: `sunTimes.ts`（NOAA の簡略式）をそのまま使う。方角は `sunTimes` の方位角、
//     太陽の高さは `sunAltitudeAt`（同じ南中・赤緯から時角で）
//   - 恒星時: Meeus『Astronomical Algorithms』第2版 式 12.4（グリニッジ平均恒星時）
//   - 銀河中心: J2000 の赤経 17h45m40s・赤緯 −29°00′28″（いて座A* 付近）。**歳差は入れない**
//     （2026 年で赤経が約 1.4 分ずれる程度。10 分刻みの計算には効かない）
//   - 新月: Meeus 第49章（平均の朔＋周期項 25 個＋惑星の補正 14 個）。力学時から UT へは ΔT ≈ 69 秒を引く
//     （2020 年代の実測値。誤差は分の単位で、日付には効かない）
//
// ## 決まりごと（2026-10-11 判断）
//
//   - 天の川は「太陽が −18° より下（天文薄明の外）**かつ**銀河中心が地平線から 10° 以上」の時間。
//     0° ちょうどでは大気で見えないので 10° にした（画面の注記に書く）。各月15日（月別の表と同じ代表日）、
//     南中から翌日の南中まで 10 分刻みで見て、続けて 30 分以上ある月だけ「見える月」にする
//   - 月明かり・天気・光害・山の影は含まない（画面にそう書く）
//   - 天の川と方角は決めた年（`LIGHT_REFERENCE_YEAR`）で計算する（ビルドの日付で変えない）。
//     **新月だけはビルドの日から先の分**——静的書き出しなので、ページを作り直すたびに更新される前提
//     （画面に「◯年◯月◯日時点」と書く）

import { LIGHT_DAY_OF_MONTH, LIGHT_REFERENCE_YEAR, type LightCell } from "./lightCalendar";
import { clockIn, solarNoon, spotTimeZone, sunAltitudeAt, sunAltitudeRange, sunTimes } from "./sunTimes";
import { compass } from "./spotLight";

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const JD_UNIX_EPOCH = 2440587.5;
const toJulian = (ms: number) => ms / DAY_MS + JD_UNIX_EPOCH;
const fromJulian = (jd: number) => new Date(Math.round((jd - JD_UNIX_EPOCH) * DAY_MS));
const pad = (n: number) => String(n).padStart(2, "0");
const norm360 = (d: number) => ((d % 360) + 360) % 360;

// ── 恒星時と星の高さ ─────────────────────────

/** 銀河中心（J2000）。赤経・赤緯は度 */
export const GALACTIC_CENTER = {
    ra: (17 + 45 / 60 + 40 / 3600) * 15,
    dec: -(29 + 0 / 60 + 28 / 3600),
} as const;

/** 天の川を「見える」とする銀河中心の高さ（度） */
export const MILKY_WAY_MIN_ALTITUDE = 10;
/** 天文薄明の外（太陽の高さ・度） */
export const ASTRONOMICAL_DARK = -18;
const STEP_MINUTES = 10;
/** 続けてこの分数以上ある月だけ「見える月」 */
export const MILKY_WAY_MIN_MINUTES = 30;

/** グリニッジ平均恒星時（度）。Meeus 式 12.4 */
export function greenwichSiderealDegrees(t: Date): number {
    const jd = toJulian(t.getTime());
    const T = (jd - 2451545.0) / 36525;
    return norm360(280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - (T * T * T) / 38710000);
}

/** 赤経・赤緯（度）の星の、その場所・その時刻の高さ（度）。経度は東が正 */
export function starAltitude(ra: number, dec: number, coords: { lat: number; lng: number }, t: Date): number {
    const H = (greenwichSiderealDegrees(t) + coords.lng - ra) * RAD;
    const phi = coords.lat * RAD, d = dec * RAD;
    const s = Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H);
    return Math.asin(Math.max(-1, Math.min(1, s))) / RAD;
}

/** その緯度で星がいちばん高く上がるときの高さ（度・南中高度）。地平線より下なら負 */
export function culminationAltitude(dec: number, lat: number): number {
    return 90 - Math.abs(lat - dec);
}

// ── 天の川（銀河中心）─────────────────────────

export type MilkyWayMonth = {
    /** 1〜12 */
    month: number;
    /** 見える時刻帯（その土地の時計・`lightCellText` で読む形。日付をまたげば「翌」） */
    window: LightCell;
    /** 見える長さ（分・10分刻み） */
    minutes: number;
};

export type MilkyWay = {
    /** この緯度で銀河中心がいちばん高く上がるときの高さ（度・整数） */
    maxAltitude: number;
    /** 見える月（30分以上）。無ければ空 */
    months: MilkyWayMonth[];
};

/**
 * 各月15日の夜に、天文薄明の外で銀河中心が 10° 以上にある時刻帯。
 * 南中（その日の昼）から翌日の南中まで 10 分刻みで見て、いちばん長く続く帯を取る
 */
export function milkyWay(coords: { lat: number; lng: number }, timeZone: string, year = LIGHT_REFERENCE_YEAR): MilkyWay | null {
    if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng) || Math.abs(coords.lat) > 90) return null;
    const maxAltitude = Math.round(culminationAltitude(GALACTIC_CENTER.dec, coords.lat));
    const months: MilkyWayMonth[] = [];
    // 南中しても 10° に届かない緯度は計算するまでもない
    if (culminationAltitude(GALACTIC_CENTER.dec, coords.lat) >= MILKY_WAY_MIN_ALTITUDE) {
        for (let month = 1; month <= 12; month++) {
            const ymd = `${year}-${pad(month)}-${pad(LIGHT_DAY_OF_MONTH)}`;
            const noon = solarNoon(ymd, coords.lng);
            if (!noon) return null;
            const steps = (24 * 60) / STEP_MINUTES;
            let best: { from: number; to: number } | null = null;
            let runFrom = -1;
            for (let i = 0; i <= steps + 1; i++) {
                const t = new Date(noon.getTime() + i * STEP_MINUTES * 60_000);
                const sun = i <= steps ? sunAltitudeAt(ymd, coords, t) : null;
                const ok = sun !== null && sun <= ASTRONOMICAL_DARK
                    && starAltitude(GALACTIC_CENTER.ra, GALACTIC_CENTER.dec, coords, t) >= MILKY_WAY_MIN_ALTITUDE;
                if (ok && runFrom < 0) runFrom = i;
                if (!ok && runFrom >= 0) {
                    if (!best || i - 1 - runFrom > best.to - best.from) best = { from: runFrom, to: i - 1 };
                    runFrom = -1;
                }
            }
            if (!best) continue;
            const minutes = (best.to - best.from) * STEP_MINUTES;
            if (minutes < MILKY_WAY_MIN_MINUTES) continue;
            const a = clockIn(timeZone, new Date(noon.getTime() + best.from * STEP_MINUTES * 60_000));
            const b = clockIn(timeZone, new Date(noon.getTime() + best.to * STEP_MINUTES * 60_000));
            if (!a || !b) return null;
            months.push({ month, window: { text: `${a}–${b < a ? `翌${b}` : b}` }, minutes });
        }
    }
    return { maxAltitude, months };
}

// ── 新月（Meeus 第49章）─────────────────────────

/** ΔT（力学時 − 世界時・日）。2020 年代は約 69 秒 */
const DELTA_T_DAYS = 69 / 86400;

/** 朔の番号 k（2000年1月6日の新月が 0）の、新月の儒略日（力学時）。Meeus 第49章 */
export function newMoonJDE(k: number): number {
    const T = k / 1236.85;
    const T2 = T * T, T3 = T2 * T, T4 = T3 * T;
    let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2 - 0.00000015 * T3 + 0.00000000073 * T4;
    const E = 1 - 0.002516 * T - 0.0000074 * T2;
    const M = (2.5534 + 29.1053567 * k - 0.0000014 * T2 - 0.00000011 * T3) * RAD;
    const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4) * RAD;
    const F = (160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4) * RAD;
    const Om = (124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3) * RAD;
    const sin = Math.sin;
    jde += -0.4072 * sin(Mp)
        + 0.17241 * E * sin(M)
        + 0.01608 * sin(2 * Mp)
        + 0.01039 * sin(2 * F)
        + 0.00739 * E * sin(Mp - M)
        - 0.00514 * E * sin(Mp + M)
        + 0.00208 * E * E * sin(2 * M)
        - 0.00111 * sin(Mp - 2 * F)
        - 0.00057 * sin(Mp + 2 * F)
        + 0.00056 * E * sin(2 * Mp + M)
        - 0.00042 * sin(3 * Mp)
        + 0.00042 * E * sin(M + 2 * F)
        + 0.00038 * E * sin(M - 2 * F)
        - 0.00024 * E * sin(2 * Mp - M)
        - 0.00017 * sin(Om)
        - 0.00007 * sin(Mp + 2 * M)
        + 0.00004 * sin(2 * Mp - 2 * F)
        + 0.00004 * sin(3 * M)
        + 0.00003 * sin(Mp + M - 2 * F)
        + 0.00003 * sin(2 * Mp + 2 * F)
        - 0.00003 * sin(Mp + M + 2 * F)
        + 0.00003 * sin(Mp - M + 2 * F)
        - 0.00002 * sin(Mp - M - 2 * F)
        - 0.00002 * sin(3 * Mp + M)
        + 0.00002 * sin(4 * Mp);
    // 惑星による補正（A1〜A14）
    const A: Array<[number, number, number]> = [
        [299.77, 0.107408, 0.000325], [251.88, 0.016321, 0.000165], [251.83, 26.651886, 0.000164],
        [349.42, 36.412478, 0.000126], [84.66, 18.206239, 0.00011], [141.74, 53.303771, 0.000062],
        [207.14, 2.453732, 0.00006], [154.84, 7.30686, 0.000056], [34.52, 27.261239, 0.000047],
        [207.19, 0.121824, 0.000042], [291.34, 1.844379, 0.00004], [161.72, 24.198154, 0.000037],
        [239.56, 25.513099, 0.000035], [331.55, 3.592518, 0.000023],
    ];
    A.forEach(([base, rate, coef], i) => {
        const arg = (base + rate * k - (i === 0 ? 0.009173 * T2 : 0)) * RAD;
        jde += coef * Math.sin(arg);
    });
    return jde;
}

/** `from` 以降 `days` 日のうちの新月の時刻（UT） */
export function newMoonsBetween(from: Date, days: number): Date[] {
    const year = new Date(from).getUTCFullYear() + (from.getTime() - Date.UTC(from.getUTCFullYear(), 0, 1)) / (365.25 * DAY_MS);
    const until = from.getTime() + days * DAY_MS;
    const out: Date[] = [];
    for (let k = Math.floor((year - 2000) * 12.3685) - 2; ; k++) {
        const t = fromJulian(newMoonJDE(k) - DELTA_T_DAYS);
        if (t.getTime() >= until) break;
        if (t.getTime() >= from.getTime()) out.push(t);
    }
    return out;
}

/** その時刻帯での暦日 "YYYY-MM-DD" */
function ymdIn(timeZone: string, t: Date): string | null {
    try {
        const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(t);
        const get = (k: string) => parts.find((p) => p.type === k)?.value;
        const y = get("year"), m = get("month"), d = get("day");
        return y && m && d ? `${y}-${m}-${d}` : null;
    } catch {
        return null;
    }
}

// ── まとめ ─────────────────────────

/** 1年でいちばん北寄り・南寄りの日の出・日の入り（6月21日ごろ・12月21日ごろ）。null は白夜・極夜で時刻が無い */
export type SolsticeDirections = {
    june: { sunrise: number | null; sunset: number | null; noSun: "midnightSun" | "polarNight" | null };
    december: { sunrise: number | null; sunset: number | null; noSun: "midnightSun" | "polarNight" | null };
};

export type SpotSky = {
    timeZone: string;
    solstices: SolsticeDirections;
    milkyWay: MilkyWay;
    /** 今後12か月の新月（その土地の暦の "YYYY-MM-DD"） */
    newMoons: string[];
    /** 新月を数え始めた日（ビルドの日・その土地の暦の "YYYY-MM-DD"） */
    asOf: string;
};

function solsticeOf(ymd: string, coords: { lat: number; lng: number }): SolsticeDirections["june"] {
    const t = sunTimes(ymd, coords);
    const alt = sunAltitudeRange(ymd, coords);
    const noSun = t?.sunriseAzimuth == null && alt ? (alt.min > -0.833 ? "midnightSun" : "polarNight") : null;
    return { sunrise: t?.sunriseAzimuth ?? null, sunset: t?.sunsetAzimuth ?? null, noSun };
}

/**
 * スポットの星空と方角の事実一式。座標が無い・時刻帯が引けない行は null（節を出さない・月別の表と同じ）。
 * @param now 新月を数え始める時刻（ビルドの時刻。試験では固定する）
 */
export function spotSky(
    coords: { lat: number; lng: number } | undefined | null,
    country: string | undefined | null,
    spotZone?: string | null,
    now: Date = new Date(),
): SpotSky | null {
    if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng) || Math.abs(coords.lat) > 90) return null;
    const timeZone = spotTimeZone(spotZone, country);
    if (!timeZone) return null;
    const mw = milkyWay(coords, timeZone);
    const asOf = ymdIn(timeZone, now);
    if (!mw || !asOf) return null;
    const newMoons = newMoonsBetween(now, 365).map((t) => ymdIn(timeZone, t)).filter((d): d is string => d !== null && d >= asOf);
    return {
        timeZone,
        solstices: {
            june: solsticeOf(`${LIGHT_REFERENCE_YEAR}-06-21`, coords),
            december: solsticeOf(`${LIGHT_REFERENCE_YEAR}-12-21`, coords),
        },
        milkyWay: mw,
        newMoons,
        asOf,
    };
}

// ── 文 ─────────────────────────

const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * 月の集まりを続いた幅で言う（12月→1月もつながる）。「4〜9月」「11〜2月」「一年中」。英語は "Apr–Sep"
 */
export function monthRanges(months: readonly number[], isJa = true): string {
    const set = new Set(months.filter((m) => m >= 1 && m <= 12));
    if (set.size === 0) return "";
    if (set.size === 12) return isJa ? "一年中" : "all year";
    // 抜けている月の次から数え始める（輪の切れ目）
    let start = 1;
    while (set.has(start)) start = (start % 12) + 1;
    const runs: Array<[number, number]> = [];
    for (let i = 0, m = start; i < 12; i++, m = (m % 12) + 1) {
        if (!set.has(m)) continue;
        const prev = m === 1 ? 12 : m - 1;
        if (runs.length > 0 && set.has(prev) && runs[runs.length - 1][1] === prev) runs[runs.length - 1][1] = m;
        else runs.push([m, m]);
    }
    const one = (a: number, b: number) => isJa
        ? (a === b ? `${a}月` : `${a}〜${b}月`)
        : (a === b ? MONTH_EN[a - 1] : `${MONTH_EN[a - 1]}–${MONTH_EN[b - 1]}`);
    return runs.map(([a, b]) => one(a, b)).join(isJa ? "・" : ", ");
}

const dir = (deg: number, isJa: boolean) => `${compass(deg, isJa)} ${Math.round(deg) % 360}°`;

/** 見える時間がいちばん長い月（同じ長さなら早い月） */
function peakMonth(mw: MilkyWay): MilkyWayMonth | null {
    return mw.months.reduce<MilkyWayMonth | null>((best, m) => (!best || m.minutes > best.minutes ? m : best), null);
}

const windowText = (c: LightCell, isJa: boolean) =>
    "text" in c ? (isJa ? c.text : c.text.replace(/翌(\d{2}:\d{2})/, "$1 (+1)")) : "";

/**
 * 「撮影の光」の節の頭に置く、方角の振れ幅の文（日の出と日の入り）。
 * 例「日の出・日の入りの方角は季節で動く。6月21日ごろは日の出が東北東 60°・日の入りが西北西 300°（1年でいちばん北寄り）、
 * 12月21日ごろは日の出が東南東 118°・日の入りが西南西 242°（いちばん南寄り）。」
 */
export function directionSummary(sky: SpotSky, isJa = true): string {
    const part = (s: SolsticeDirections["june"], when: string, extreme: string) => {
        if (s.sunrise !== null && s.sunset !== null) {
            return isJa
                ? `${when}は日の出が${dir(s.sunrise, true)}・日の入りが${dir(s.sunset, true)}（${extreme}）`
                : `around ${when} the sun rises at ${dir(s.sunrise, false)} and sets at ${dir(s.sunset, false)} (${extreme})`;
        }
        if (s.noSun === "midnightSun") return isJa ? `${when}は白夜で日が沈まない` : `around ${when} the sun does not set (midnight sun)`;
        if (s.noSun === "polarNight") return isJa ? `${when}は極夜で日が昇らない` : `around ${when} the sun does not rise (polar night)`;
        return "";
    };
    const j = part(sky.solstices.june, isJa ? "6月21日ごろ" : "21 June", isJa ? "1年でいちばん北寄り" : "furthest north");
    const d = part(sky.solstices.december, isJa ? "12月21日ごろ" : "21 December", isJa ? "いちばん南寄り" : "furthest south");
    const body = [j, d].filter(Boolean);
    if (body.length === 0) return "";
    if (isJa) return `日の出・日の入りの方角は季節で動く。${body.join("、")}。`;
    const s = body.join("; ");
    return `Sunrise and sunset move with the seasons: ${s}.`;
}

/** 天の川の文。見える月が無ければ、銀河中心がどこまでしか上がらないかを言う */
export function milkyWaySummary(sky: SpotSky, isJa = true, withTime = true): string {
    const mw = sky.milkyWay;
    if (mw.months.length === 0) {
        if (mw.maxAltitude < 0) {
            return isJa ? "この緯度では天の川の中心（銀河中心）は地平線より上に出ない。" : "At this latitude the Milky Way core never rises above the horizon.";
        }
        return isJa
            ? `この緯度では天の川の中心（銀河中心）は地平線から最大 ${mw.maxAltitude}° までしか上がらず、暗い時間に ${MILKY_WAY_MIN_ALTITUDE}° を超える月はない。`
            : `At this latitude the Milky Way core rises no higher than ${mw.maxAltitude}°, and never clears ${MILKY_WAY_MIN_ALTITUDE}° in full darkness.`;
    }
    const range = monthRanges(mw.months.map((m) => m.month), isJa);
    const peak = peakMonth(mw);
    if (!withTime || !peak) {
        return isJa ? `天の川の中心は${range}の夜。` : `Milky Way core: ${range}, at night.`;
    }
    const w = windowText(peak.window, isJa);
    return isJa
        ? `天の川の中心は${range}の夜に見える高さに来る（いちばん長い${peak.month}月は ${w}）。`
        : `The Milky Way core is up in darkness in ${range} (longest in ${MONTH_EN[peak.month - 1]}: ${w}).`;
}

/** 日の入りの振れ幅を短く（検索の説明・撮影ガイドの頭）。「日の入りは6月が西北西寄り、12月が西南西寄り。」 */
function sunsetShort(sky: SpotSky, isJa: boolean, withDegrees: boolean): string {
    const j = sky.solstices.june.sunset, d = sky.solstices.december.sunset;
    if (j === null || d === null) {
        // 白夜・極夜で時刻が無い（北極圏など）。方角の代わりにその事実を言う
        const words: string[] = [];
        if (sky.solstices.june.noSun === "midnightSun") words.push(isJa ? "6月21日ごろは白夜で日が沈まない" : "the sun does not set around 21 June");
        if (sky.solstices.december.noSun === "polarNight") words.push(isJa ? "12月21日ごろは極夜で日が昇らない" : "it does not rise around 21 December");
        if (words.length === 0) return "";
        return isJa ? `${words.join("、")}。` : `${words.join(", and ").replace(/^./, (c) => c.toUpperCase())}.`;
    }
    const say = (deg: number) => withDegrees ? (isJa ? `${compass(deg, true)}（${Math.round(deg) % 360}°）` : dir(deg, false)) : compass(deg, isJa);
    return isJa
        ? `日の入りは6月が${say(j)}${withDegrees ? "" : "寄り"}、12月が${say(d)}${withDegrees ? "" : "寄り"}。`
        : `Sunset is ${withDegrees ? "at " : "toward "}${say(j)} in June and ${say(d)} in December.`;
}

/**
 * 撮影ガイドの節の頭に置く1〜2文（季節・時間帯の案内が無いページの主役）。
 * 例「日の入りは6月が西北西（300°）、12月が西南西（242°）。天の川の中心は4〜9月の夜に見える高さに来る（いちばん長い6月は 22:40–翌02:50）。」
 */
export function skyLead(sky: SpotSky, isJa = true): string {
    return [sunsetShort(sky, isJa, true), milkyWaySummary(sky, isJa, true)].filter(Boolean).join(isJa ? "" : " ");
}

/**
 * **検索の説明（meta description）の後半に足す要約**（日本語・短く）。
 * 例「日の入りは6月が西北西寄り、12月が西南西寄り。天の川の中心は4〜9月の夜。」。
 * 計算できない行は ""（説明を変えない）。組み立て側は末尾に足すだけ（`appendSkySummary`）
 */
export function skyDescription(sky: SpotSky | null): string {
    if (!sky) return "";
    const mw = sky.milkyWay.months.length > 0 ? milkyWaySummary(sky, true, false) : "";
    return [sunsetShort(sky, true, false), mw].filter(Boolean).join("");
}

/** 説明文の末尾に要約を足す（句点で区切る）。要約が空なら元のまま */
export function appendSkySummary(description: string, summary: string): string {
    if (!summary) return description;
    const base = description.trimEnd();
    if (!base) return summary;
    return /[。．.!?！？]$/.test(base) ? `${base}${summary}` : `${base}。${summary}`;
}

/** スポットから説明の後半を作る（`generateMetadata` 用。方角と天の川は決めた年で計算するので、ビルドの日付で変わらない） */
export function spotSkyDescription(spot: { coords?: { lat: number; lng: number } | null; region?: { country?: string } | null; timeZone?: string | null }): string {
    return skyDescription(spotSky(spot.coords, spot.region?.country, spot.timeZone));
}

/** 新月の日付の言い方（年が変わる最初の日だけ年を付ける）。「2026年10月11日」「11月9日」… 英語は "11 Oct 2026" */
export function newMoonLabels(dates: readonly string[], isJa = true): string[] {
    let year = "";
    return dates.map((d) => {
        const [y, m, day] = d.split("-");
        const withYear = y !== year;
        year = y;
        return isJa
            ? `${withYear ? `${y}年` : ""}${Number(m)}月${Number(day)}日`
            : `${Number(day)} ${MONTH_EN[Number(m) - 1]}${withYear ? ` ${y}` : ""}`;
    });
}
