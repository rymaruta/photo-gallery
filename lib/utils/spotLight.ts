// lib/utils/spotLight.ts
//
// 撮影地ページの「**光の時刻**」の節（2026-10-03）。写真が無い場所でも役に立つ、
// その日の日の出・日の入りの時刻と方角、ゴールデンアワー・ブルーアワーの時間帯。
// **アプリの `SpotLight.swift` と同じ決まり・同じ文**（言い分け・並び・注記）。
//
// 計算はブラウザの中だけ（`sunTimes.ts`・NOAA の簡略式）。通信しない。
//
// ## 決まりごと
//
//   - 時刻は**その土地の時計**。時刻帯は台帳の行の `timeZone`（IANA 名・2026-10-07）があればそれ、
//     無ければ国から引く（`spotTimeZone`・日本は Asia/Tokyo）。
//     **どちらでも決まらない行は節を出さない**（月別の表・旅行プランの札と同じ。端末の時計で言うと旅先で読み違える）
//   - 日の出・日の入りの方角は「東北東 67°」（16方位＋北から時計回りの度）
//   - ゴールデンアワーは太陽の高さ +6°〜−4°、ブルーアワーは −4°〜−6°
//   - 段の中は時刻の順: 朝はブルーアワー → 日の出 → ゴールデンアワー、夕はゴールデンアワー → 日の入り → ブルーアワー
//   - 白夜・極夜で時刻が無い日は、**作り話の時刻を出さず**「白夜（沈まない）」「極夜（昇らない）」と言う
//   - 台帳の `timeOfDayGuide` のうち、夜明け・朝は「朝」の段、夕方の斜光・日没後は「夕」の段に並べる
//     （日中・夜は撮影ガイドの時間帯に残す）。節を出さないときは全部を撮影ガイドに残す

import { clockIn, spotTimeZone, sunAltitudeRange, sunTimes, todayIn, type SunEvent, type SunTimes } from "./sunTimes";

type Span = { start: SunEvent; end: SunEvent };

/** 1行: 札（日の出・ゴールデンアワー…）・値（時刻か言い分け）・添え（方角） */
export type LightRowItem = { label: string; value: string; detail?: string };

/** 朝・夕の段 */
export type LightBlock = { title: string; isMorning: boolean; rows: LightRowItem[] };

/** 節に出すもの一式 */
export type LightSheet = {
    timeZone: string;
    /** その土地の今日 */
    todayYMD: string;
    /** 見ている日 */
    ymd: string;
    /** 1つ以上 */
    blocks: LightBlock[];
};

/** 日付を送れる幅（今日から前後この日数まで） */
export const LIGHT_MAX_OFFSET = 366;

const HORIZON = -0.833;
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 座標と国（と台帳の `timeZone`）から、節を出す場所か（日付に依らない＝サーバーと水和の最初の描画で同じ答え）。
 * 時刻帯は `timeZone` が先、無ければ国の表（`spotTimeZone`）
 */
export function lightZone(
    coords: { lat: number; lng: number } | undefined | null,
    country: string | undefined | null,
    timeZone?: string | null,
): string | null {
    if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng) || Math.abs(coords.lat) > 90) return null;
    return spotTimeZone(timeZone, country);
}

/** "YYYY-MM-DD" に日数を足す（暦の上で。時刻帯に依らない） */
export function addDays(ymd: string, days: number): string | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m) return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** その時刻帯での「今日から `offset` 日」の暦日 */
export function ymdAt(offset: number, now: Date, timeZone: string): string | null {
    const today = todayIn(timeZone, now);
    return today ? addDays(today, offset) : null;
}

/** 節の中身（`spotZone` は台帳の行の `timeZone`）。**時刻帯が引けない国・座標が読めない・段が1つも作れない日は null**（節ごと出さない） */
export function lightSheet(
    country: string | undefined | null,
    coords: { lat: number; lng: number },
    offset: number,
    now: Date,
    isJa: boolean,
    spotZone?: string | null,
): LightSheet | null {
    const timeZone = lightZone(coords, country, spotZone);
    if (!timeZone) return null;
    const today = ymdAt(0, now, timeZone);
    const day = ymdAt(Math.min(Math.max(offset, -LIGHT_MAX_OFFSET), LIGHT_MAX_OFFSET), now, timeZone);
    if (!today || !day) return null;
    const blocks = lightBlocksFor(day, coords, timeZone, isJa);
    if (blocks.length === 0) return null;
    return { timeZone, todayYMD: today, ymd: day, blocks };
}

const WEEK_JA = ["日", "月", "火", "水", "木", "金", "土"];
const WEEK_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 日付の札: 「10月3日（土） · 今日」。年が今日と違えば年から（「2027年1月5日（火）」） */
export function lightDateLabel(ymd: string, offset: number, todayYMD: string, isJa: boolean): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m) return ymd;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const w = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    const sameYear = todayYMD.slice(0, 4) === m[1];
    let label = sameYear
        ? (isJa ? `${mo}月${d}日（${WEEK_JA[w]}）` : `${WEEK_EN[w]}, ${MONTH_EN[mo - 1]} ${d}`)
        : (isJa ? `${y}年${mo}月${d}日（${WEEK_JA[w]}）` : `${WEEK_EN[w]}, ${MONTH_EN[mo - 1]} ${d}, ${y}`);
    if (offset === 0) label += isJa ? " · 今日" : " · Today";
    else if (offset === 1) label += isJa ? " · 明日" : " · Tomorrow";
    else if (offset === -1) label += isJa ? " · 昨日" : " · Yesterday";
    return label;
}

const COMPASS_JA = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東",
    "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];
const COMPASS_EN = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

/** 16方位（北から時計回り） */
export function compass(degrees: number, isJa = true): string {
    const normalized = ((degrees % 360) + 360) % 360;
    const i = Math.round(normalized / 22.5) % 16;
    return (isJa ? COMPASS_JA : COMPASS_EN)[i];
}

/** 「東北東 67°」。度は整数に丸める（台帳の座標は約1km に丸めてあり、小数は意味を持たない） */
export function direction(degrees: number | null | undefined, isJa = true): string | undefined {
    if (degrees === null || degrees === undefined || !Number.isFinite(degrees)) return undefined;
    return `${compass(degrees, isJa)} ${Math.round(degrees) % 360}°`;
}

/** "HH:MM" どうしで、後ろの方が早ければ翌日 */
const nextDay = (earlier: string, later: string, isJa: boolean) =>
    later < earlier ? (isJa ? `翌${later}` : `${later} (+1)`) : later;

/**
 * 時間帯 "HH:MM–HH:MM"。片方の端しか無ければ、時刻を作らず言葉で開いたままにする
 * （「HH:MM–（翌朝まで）」「（前夜から）–HH:MM」）。どちらも無ければ null
 */
export function spanText(span: Span, timeZone: string, isJa = true): string | null {
    const a = clockIn(timeZone, span.start);
    const b = clockIn(timeZone, span.end);
    if (a && b) return `${a}–${nextDay(a, b, isJa)}`;
    if (a) return isJa ? `${a}–（翌朝まで）` : `${a}– (until morning)`;
    if (b) return isJa ? `（前夜から）–${b}` : `(from the night before) –${b}`;
    return null;
}

/** 太陽が一日中その帯の上端まで上がらない日の、朝の始まりから夕の終わりまでの1本 */
function joinedAcrossNoon(morning: Span, evening: Span): Span | null {
    if (morning.start && !morning.end && !evening.start && evening.end) return { start: morning.start, end: evening.end };
    return null;
}

/** 日が昇らない／沈まない日の言い分け */
function noSunWord(altitude: { max: number; min: number } | null, isJa: boolean): string | null {
    if (!altitude) return null;
    if (altitude.min > HORIZON) return isJa ? "白夜（沈まない）" : "Midnight sun (no sunset)";
    if (altitude.max <= HORIZON) return isJa ? "極夜（昇らない）" : "Polar night (no sunrise)";
    return null;
}

/**
 * その日の朝・夕の段。行が1つも無い段は落とす
 *
 *  - 極夜（日が昇らない）の日はゴールデンアワーを出さない
 *  - 昼のあいだ太陽が 6° まで上がらない日は、ゴールデンアワーが朝から夕まで1本（「一日中」と添える）。
 *    ブルーアワーも −4° まで上がらない日は同じく1本にする
 */
export function lightBlocks(
    times: SunTimes,
    altitude: { max: number; min: number } | null,
    timeZone: string,
    isJa = true,
): LightBlock[] {
    const golden = isJa ? "ゴールデンアワー" : "Golden hour";
    const blue = isJa ? "ブルーアワー" : "Blue hour";
    const noSun = noSunWord(altitude, isJa);
    const polarNight = altitude ? altitude.max <= HORIZON : false;
    const goldenJoined = polarNight ? null : joinedAcrossNoon(times.morningGolden, times.eveningGolden);
    const blueJoined = joinedAcrossNoon(times.morningBlue, times.eveningBlue);
    const sunriseLabel = isJa ? "日の出" : "Sunrise";
    const sunsetLabel = isJa ? "日の入り" : "Sunset";

    // 朝は時刻の順: ブルーアワー → 日の出 → ゴールデンアワー
    const morning: LightRowItem[] = [];
    const mb = spanText(blueJoined ?? times.morningBlue, timeZone, isJa);
    if (mb) morning.push({ label: blue, value: mb });
    const rise = clockIn(timeZone, times.sunrise);
    if (rise) {
        const detail = direction(times.sunriseAzimuth, isJa);
        morning.push(detail ? { label: sunriseLabel, value: rise, detail } : { label: sunriseLabel, value: rise });
    } else if (noSun) {
        morning.push({ label: sunriseLabel, value: noSun });
    }
    if (goldenJoined) {
        const s = spanText(goldenJoined, timeZone, isJa);
        if (s) morning.push({ label: golden, value: s + (isJa ? "（一日中・太陽が 6° より上がらない）" : " (all day · sun stays below 6°)") });
    } else if (!polarNight) {
        const s = spanText(times.morningGolden, timeZone, isJa);
        if (s) morning.push({ label: golden, value: s });
    }

    // 夕も時刻の順: ゴールデンアワー → 日の入り → ブルーアワー
    const evening: LightRowItem[] = [];
    if (!goldenJoined && !polarNight) {
        const s = spanText(times.eveningGolden, timeZone, isJa);
        if (s) evening.push({ label: golden, value: s });
    }
    const set = clockIn(timeZone, times.sunset);
    if (set) {
        const value = rise ? nextDay(rise, set, isJa) : set;
        const detail = direction(times.sunsetAzimuth, isJa);
        evening.push(detail ? { label: sunsetLabel, value, detail } : { label: sunsetLabel, value });
    } else if (noSun) {
        evening.push({ label: sunsetLabel, value: noSun });
    }
    if (!blueJoined) {
        const s = spanText(times.eveningBlue, timeZone, isJa);
        if (s) evening.push({ label: blue, value: s });
    }

    return [
        { title: isJa ? "朝" : "Morning", isMorning: true, rows: morning },
        { title: isJa ? "夕" : "Evening", isMorning: false, rows: evening },
    ].filter((b) => b.rows.length > 0);
}

/** 座標と暦日から、その日の段（日付が読めない・緯度が範囲外なら空） */
export function lightBlocksFor(ymd: string, coords: { lat: number; lng: number }, timeZone: string, isJa = true): LightBlock[] {
    const times = sunTimes(ymd, coords);
    if (!times) return [];
    return lightBlocks(times, sunAltitudeRange(ymd, coords), timeZone, isJa);
}

// ── 台帳の時間帯の文 ─────────────────────────

/** 撮影ガイドの時間帯の並び（アプリの `SpotBodyText.timeOrder` と同じ） */
export const TIME_ORDER = ["dawn", "morning", "day", "goldenHour", "dusk", "night"] as const;
/** 朝の段に並べる時間帯（夜明け・朝） */
export const MORNING_TIMES: readonly string[] = ["dawn", "morning"];
/** 夕の段に並べる時間帯（夕方の斜光・日没後） */
export const EVENING_TIMES: readonly string[] = ["goldenHour", "dusk"];

type TimeOfDay = { time: string; text: string };

/** 決まった順に並べる（同じ時間帯どうしは元の順）。知らない時間帯は後ろ */
function ordered<T extends TimeOfDay>(list: readonly T[]): T[] {
    const rank = (t: string) => {
        const i = (TIME_ORDER as readonly string[]).indexOf(t);
        return i < 0 ? TIME_ORDER.length : i;
    };
    return list.map((v, i) => ({ v, i })).sort((a, b) => rank(a.v.time) - rank(b.v.time) || a.i - b.i).map((x) => x.v);
}

/** 台帳の `timeOfDayGuide` を朝・夕に分ける */
export function splitGuides<T extends TimeOfDay>(list: readonly T[]): { morning: T[]; evening: T[] } {
    const o = ordered(list);
    return { morning: o.filter((t) => MORNING_TIMES.includes(t.time)), evening: o.filter((t) => EVENING_TIMES.includes(t.time)) };
}

/**
 * 撮影ガイドの「時間帯」に出す文。光の時刻の節を出すときは、そちらに並べたぶんを除いた残り（日中・夜）。
 * 節を出さないときは全部（並びは台帳のまま＝これまでの画面を変えない）
 */
export function guideTimes<T extends TimeOfDay>(list: readonly T[], lightShown: boolean): T[] {
    if (!lightShown) return [...list];
    return list.filter((t) => !MORNING_TIMES.includes(t.time) && !EVENING_TIMES.includes(t.time));
}

/** 節の下の注記（アプリの `SpotLight.note` と同じ文） */
export function lightNote(timeZone: string, isJa = true): string {
    const clock = timeZone === "Asia/Tokyo"
        ? (isJa ? "時刻は日本時間。" : "Times in Japan Standard Time.")
        : (isJa ? `時刻は現地時間（${timeZone}）。` : `Times in local time (${timeZone}).`);
    return clock + (isJa
        ? "端末で計算した値です。ゴールデンアワーは太陽の高さが 6° から −4°、ブルーアワーは −4° から −6° の間。方角は北から時計回り。天気や山・建物の影は含みません。"
        : " Calculated on this device. Golden hour is when the sun is between 6° and −4°, blue hour between −4° and −6°. Directions are measured clockwise from north. Weather and shadows from terrain or buildings are not included.");
}
