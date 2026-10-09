/**
 * **その場所・その日の光の時刻**（日の出・日の入り・ゴールデンアワー・ブルーアワー）。
 *
 * `lib/utils/sunTimes.ts` の**写し**。api-user は `src/` の外を読まない
 * （`tsconfig.json` の `rootDir`）ので、`badges.ts` の `sunriseSunset` と同じく
 * 式をここに持つ。**式は1文字も変えない**——`scripts/__tests__/lightParity.test.ts` が
 * 全部の時刻をミリ秒まで突き合わせる。
 *
 * 式は NOAA の簡略式（Wikipedia "Sunrise equation"）。誤差はおおむね1〜2分。
 *
 *   - 日の出・日の入り     太陽の上端が地平線（高度 −0.833°）
 *   - ゴールデンアワー     高度 +6°〜−4°
 *   - ブルーアワー         高度 −4°〜−6°
 *
 * 白夜・極夜で太陽がその高度を通らない日は `null`（作り話の時刻を出さない）。
 */

export type SunEvent = Date | null;

export type SunTimes = {
    sunrise: SunEvent;
    sunset: SunEvent;
    morningBlue: { start: SunEvent; end: SunEvent };
    morningGolden: { start: SunEvent; end: SunEvent };
    eveningGolden: { start: SunEvent; end: SunEvent };
    eveningBlue: { start: SunEvent; end: SunEvent };
};

const RAD = Math.PI / 180;
const J2000 = 2451545.0;
const DAY_MS = 86_400_000;
const JD_UNIX_EPOCH = 2440587.5;

const toJulian = (ms: number) => ms / DAY_MS + JD_UNIX_EPOCH;
const fromJulian = (jd: number) => new Date(Math.round((jd - JD_UNIX_EPOCH) * DAY_MS));

function solarDay(ymd: string, lng: number): { transit: number; decl: number } | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m || !Number.isFinite(lng)) return null;
    const noonUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
    const n = Math.round(toJulian(noonUtc) - J2000) + 0.0008;
    const jStar = n - lng / 360;
    const M = (357.5291 + 0.98560028 * jStar) % 360;
    const Mr = M * RAD;
    const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
    const lambda = ((M + C + 180 + 102.9372) % 360) * RAD;
    const transit = J2000 + jStar + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * lambda);
    const decl = Math.asin(Math.sin(lambda) * Math.sin(23.4397 * RAD));
    return { transit, decl };
}

function hourAngleDays(altitude: number, lat: number, decl: number): number | null {
    const phi = lat * RAD;
    const cosW = (Math.sin(altitude * RAD) - Math.sin(phi) * Math.sin(decl)) / (Math.cos(phi) * Math.cos(decl));
    if (!Number.isFinite(cosW) || cosW < -1 || cosW > 1) return null;
    return Math.acos(cosW) / (2 * Math.PI);
}

export function sunTimes(ymd: string, coords: { lat: number; lng: number }): SunTimes | null {
    if (!Number.isFinite(coords.lat) || Math.abs(coords.lat) > 90) return null;
    const day = solarDay(ymd, coords.lng);
    if (!day) return null;
    const at = (altitude: number, side: -1 | 1): SunEvent => {
        const w = hourAngleDays(altitude, coords.lat, day.decl);
        return w === null ? null : fromJulian(day.transit + side * w);
    };
    return {
        sunrise: at(-0.833, -1),
        sunset: at(-0.833, 1),
        morningBlue: { start: at(-6, -1), end: at(-4, -1) },
        morningGolden: { start: at(-4, -1), end: at(6, -1) },
        eveningGolden: { start: at(6, 1), end: at(-4, 1) },
        eveningBlue: { start: at(-4, 1), end: at(-6, 1) },
    };
}

/** その時刻帯での "HH:MM"（24時間）。読めなければ null */
export function clockIn(timeZone: string, t: SunEvent): string | null {
    if (!t) return null;
    try {
        return new Intl.DateTimeFormat("ja-JP", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(t);
    } catch {
        return null;
    }
}

/** その時刻帯での今日（"YYYY-MM-DD"） */
export function todayIn(timeZone: string, now: Date = new Date()): string | null {
    try {
        const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
        const get = (t: string) => parts.find((p) => p.type === t)?.value;
        const y = get("year"), mo = get("month"), d = get("day");
        return y && mo && d ? `${y}-${mo}-${d}` : null;
    } catch {
        return null;
    }
}

/** 暦日に n 日足す（"YYYY-MM-DD"。時刻帯に依らない暦の計算） */
export function addDays(ymd: string, n: number): string {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
