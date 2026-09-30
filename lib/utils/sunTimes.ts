// lib/utils/sunTimes.ts
//
// **その場所・その日の光の時刻**（日の出・日の入り・マジックアワー・ブルーアワー）。
// 通信しない（座標と日付から計算する）。アプリ（`SunTimes.swift`）と同じ式・同じ試験の値。
//
// ## 何に使うか（owner・2026-09-30）
//
// 「行きたい場所の今日の撮影条件」を、**旅行プランの前日から最終日まで**、その日と翌日に
// 予定した撮影スポットについて出す（毎日全員に出すのではなく、行く人にだけ）。
// スポットの画面にも「今日の光」として出す。
//
// ## 式
//
// 日の出の方程式（NOAA の簡略式・Wikipedia "Sunrise equation"）。誤差はおおむね1〜2分で、
// **座標は約1km に丸めてある**（台帳）ので、これ以上細かい精度は意味を持たない。
// 表示は分まで。「約」は付けない（天文の時刻として定義どおりの値なので）。
//
//   - 日の出・日の入り     太陽の上端が地平線（高度 −0.833°・大気差と視半径）
//   - マジックアワー       高度 +6°〜−4°（写真の世界でゴールデンアワーと呼ぶ範囲）
//   - ブルーアワー         高度 −4°〜−6°
//
// 白夜・極夜で太陽がその高度を通らない日は `null`（作り話の時刻を出さない）。

export type SunEvent = Date | null;

export type SunTimes = {
    /** 日の出（上端が地平線） */
    sunrise: SunEvent;
    /** 日の入り */
    sunset: SunEvent;
    /** 朝のブルーアワー（−6°→−4°） */
    morningBlue: { start: SunEvent; end: SunEvent };
    /** 朝のマジックアワー（−4°→+6°） */
    morningGolden: { start: SunEvent; end: SunEvent };
    /** 夕方のマジックアワー（+6°→−4°） */
    eveningGolden: { start: SunEvent; end: SunEvent };
    /** 夕方のブルーアワー（−4°→−6°） */
    eveningBlue: { start: SunEvent; end: SunEvent };
};

const RAD = Math.PI / 180;
const J2000 = 2451545.0;
const DAY_MS = 86_400_000;
/** 1970-01-01T00:00Z の儒略日 */
const JD_UNIX_EPOCH = 2440587.5;

const toJulian = (ms: number) => ms / DAY_MS + JD_UNIX_EPOCH;
const fromJulian = (jd: number) => new Date(Math.round((jd - JD_UNIX_EPOCH) * DAY_MS));

/**
 * その**暦日**（`ymd` は "YYYY-MM-DD"・その場所の暦）の、太陽の南中と赤緯。
 * 日付の12:00 UTC を土台に経度で補正する——南中はその土地の正午付近に来るので、
 * 経度 −180〜+180 のどこでも「その暦日の昼」の南中になる
 */
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

/** 太陽がその高度（度）を通る、南中から何日ぶん前後か。通らなければ null */
function hourAngleDays(altitude: number, lat: number, decl: number): number | null {
    const phi = lat * RAD;
    const cosW = (Math.sin(altitude * RAD) - Math.sin(phi) * Math.sin(decl)) / (Math.cos(phi) * Math.cos(decl));
    if (!Number.isFinite(cosW) || cosW < -1 || cosW > 1) return null;
    return Math.acos(cosW) / (2 * Math.PI);
}

/**
 * その暦日の太陽の高さの幅（度）: 南中の高さ（いちばん高い）と、その反対側（いちばん低い）。
 * 時刻が出ない理由を言い分けるのに使う（白夜＝いちばん低くても沈まない・極夜＝いちばん高くても昇らない）
 */
export function sunAltitudeRange(ymd: string, coords: { lat: number; lng: number }): { max: number; min: number } | null {
    if (!Number.isFinite(coords.lat) || Math.abs(coords.lat) > 90) return null;
    const day = solarDay(ymd, coords.lng);
    if (!day) return null;
    const decl = day.decl / RAD;
    return { max: 90 - Math.abs(coords.lat - decl), min: Math.abs(coords.lat + decl) - 90 };
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

/**
 * 国（台帳の `region.country`・日本語表記）→ 時刻帯。**台帳に出る国だけ**。
 * 無い国は `null`——時刻をその土地の時計で言えないので、時刻を出さない
 * （利用者の端末の時計で言うと、旅先では読み違える）。日本の行は国を持たないことがある（無ければ日本）
 */
export const COUNTRY_TIME_ZONES: Readonly<Record<string, string>> = {
    日本: "Asia/Tokyo",
    フランス: "Europe/Paris",
    スペイン: "Europe/Madrid",
    フィンランド: "Europe/Helsinki",
    イタリア: "Europe/Rome",
    ドイツ: "Europe/Berlin",
    チェコ: "Europe/Prague",
    スイス: "Europe/Zurich",
    ギリシャ: "Europe/Athens",
    イギリス: "Europe/London",
    オランダ: "Europe/Amsterdam",
    ポルトガル: "Europe/Lisbon",
    クロアチア: "Europe/Zagreb",
    バチカン市国: "Europe/Vatican",
    オーストリア: "Europe/Vienna",
};

export function timeZoneForCountry(country: string | undefined | null): string | null {
    return COUNTRY_TIME_ZONES[(country ?? "").trim() || "日本"] ?? null;
}

/** その時刻帯での "HH:MM"（24時間）。null は「—」ではなく null のまま返す（画面が行ごと出さない） */
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
