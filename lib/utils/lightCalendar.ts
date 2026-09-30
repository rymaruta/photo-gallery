// lib/utils/lightCalendar.ts
//
// **撮影の光の月別の表**（スポットの画面・`SpotGuideClient` の「撮影の光」）。
//
// 各月の代表日（15日）について、日の出・日の入り・夕方のマジックアワーを**その土地の時計**で出す。
// ビルド時にサーバーで計算してページに書き込む＝通信しない・検索にも読まれる。
//
// ## なぜ要るか（2026-09-30・「見つけてもらう方法」②）
//
// スポットのページの多くは Wikipedia にもある情報で、Google から「量産された薄いページ」と
// 見られうる。**座標から計算した場所ごとに違う数字**は、ほかのガイドに無いこのサイトだけの中身。
// 「銀山温泉 夕焼け 時間」のような検索にも答えられる。
//
// ## 決まりごと
//
//   - 時刻帯が引けない国（`COUNTRY_TIME_ZONES` に無い）・座標の無い行は表を出さない（null）
//     ——利用者の端末の時計で言うと、旅先では読み違える
//   - 白夜・極夜で太陽がその高さを通らない日は、その欄を null（画面は「—」）。作り話の時刻を出さない
//   - **天気・地形（山の影）は含まない**。画面にそう書く
//   - 年はビルドした年（夏時間の切り替えがある国は年で1時間ずれる月がある）

import { clockIn, sunTimes, timeZoneForCountry } from "./sunTimes";

export type LightRow = {
    /** 1〜12 */
    month: number;
    sunrise: string | null;
    sunset: string | null;
    /** 夕方のマジックアワー "HH:MM–HH:MM"。どちらかの端が無ければ null */
    eveningGolden: string | null;
};

export type LightCalendar = {
    year: number;
    /** IANA の時刻帯（"Asia/Tokyo"） */
    timeZone: string;
    rows: LightRow[];
};

/** 代表日（各月の15日） */
export const LIGHT_DAY_OF_MONTH = 15;

const pad = (n: number) => String(n).padStart(2, "0");

function range(timeZone: string, start: Date | null, end: Date | null): string | null {
    const a = clockIn(timeZone, start);
    const b = clockIn(timeZone, end);
    return a && b ? `${a}–${b}` : null;
}

/**
 * その場所の1年ぶんの表。座標が無い・時刻帯が引けないなら null
 * @param country 台帳の `region.country`（日本の行は持たないことがある＝日本）
 */
export function lightCalendar(
    coords: { lat: number; lng: number } | undefined | null,
    country: string | undefined | null,
    year: number,
): LightCalendar | null {
    if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return null;
    const timeZone = timeZoneForCountry(country);
    if (!timeZone) return null;
    const rows: LightRow[] = [];
    for (let month = 1; month <= 12; month++) {
        const t = sunTimes(`${year}-${pad(month)}-${pad(LIGHT_DAY_OF_MONTH)}`, coords);
        rows.push({
            month,
            sunrise: t ? clockIn(timeZone, t.sunrise) : null,
            sunset: t ? clockIn(timeZone, t.sunset) : null,
            eveningGolden: t ? range(timeZone, t.eveningGolden.start, t.eveningGolden.end) : null,
        });
    }
    return { year, timeZone, rows };
}
