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
//   - 太陽がその高さを通らない日は、**理由を言い分ける**（「—」だけだと「無い」「データが無い」と読める・
//     9d7ba04e のレビュー: 北緯66.5度のサンタクロース村）:
//       白夜＝一日中沈まない／極夜＝一日中昇らない／終日＝一日中低く、昼のあいだずっとマジックアワー／
//       沈まない＝マジックアワーの終わり（−4°）まで沈まない
//   - **日付をまたぐ時刻には「翌」を付ける**（日の入り 00:10 が日の出 02:36 より前に見えないように）
//   - **天気・地形（山の影）は含まない**。画面にそう書く
//   - 年は決めた年（`LIGHT_REFERENCE_YEAR`）で計算する。年で変わるのは1分ほど（EU の夏時間の切り替えは
//     3月・10月の最終日曜で15日には重ならない）なので、ビルドの結果を日付で変えない

import { clockIn, sunAltitudeRange, sunTimes, timeZoneForCountry } from "./sunTimes";

/** 時刻が出ない欄の理由（画面が言葉と凡例にする） */
export type LightGap = "midnightSun" | "polarNight" | "allDay" | "noDusk";

export type LightCell = { text: string } | { gap: LightGap; from?: string };

export type LightRow = {
    /** 1〜12 */
    month: number;
    sunrise: LightCell;
    sunset: LightCell;
    /** 夕方のマジックアワー */
    eveningGolden: LightCell;
};

export type LightCalendar = {
    /** IANA の時刻帯（"Asia/Tokyo"） */
    timeZone: string;
    rows: LightRow[];
};

/** 代表日（各月の15日） */
export const LIGHT_DAY_OF_MONTH = 15;
/** 計算に使う年（上の注記）。表には書かない */
export const LIGHT_REFERENCE_YEAR = 2026;

const pad = (n: number) => String(n).padStart(2, "0");

/** 日の出・日の入りの高さ（上端が地平線） */
const HORIZON = -0.833;
const GOLDEN_TOP = 6;
const GOLDEN_BOTTOM = -4;

/** "HH:MM" どうしで、後ろの方が早ければ翌日（日付をまたいだ） */
const nextDay = (earlier: string, later: string) => (later < earlier ? `翌${later}` : later);

/**
 * その場所の1年ぶんの表。座標が無い・時刻帯が引けないなら null
 * @param country 台帳の `region.country`（日本の行は持たないことがある＝日本）
 */
export function lightCalendar(
    coords: { lat: number; lng: number } | undefined | null,
    country: string | undefined | null,
    year: number = LIGHT_REFERENCE_YEAR,
): LightCalendar | null {
    if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return null;
    const timeZone = timeZoneForCountry(country);
    if (!timeZone) return null;
    const rows: LightRow[] = [];
    for (let month = 1; month <= 12; month++) {
        const ymd = `${year}-${pad(month)}-${pad(LIGHT_DAY_OF_MONTH)}`;
        const t = sunTimes(ymd, coords);
        const alt = sunAltitudeRange(ymd, coords);
        const rise = t ? clockIn(timeZone, t.sunrise) : null;
        const set = t ? clockIn(timeZone, t.sunset) : null;
        const gStart = t ? clockIn(timeZone, t.eveningGolden.start) : null;
        const gEnd = t ? clockIn(timeZone, t.eveningGolden.end) : null;

        // 日の出・日の入りが無い日は、白夜か極夜
        const dayGap: LightGap | null = alt && !rise && !set
            ? (alt.min > HORIZON ? "midnightSun" : alt.max < HORIZON ? "polarNight" : null)
            : null;
        const sunrise: LightCell = rise ? { text: rise } : { gap: dayGap ?? "polarNight" };
        const sunset: LightCell = set ? { text: rise ? nextDay(rise, set) : set } : { gap: dayGap ?? "polarNight" };

        let eveningGolden: LightCell;
        if (gStart && gEnd) {
            eveningGolden = { text: `${gStart}–${nextDay(gStart, gEnd)}` };
        } else if (!gStart && alt && alt.max < GOLDEN_TOP && alt.max > GOLDEN_BOTTOM) {
            // 一日中 6° まで上がらない＝昼のあいだずっとマジックアワー
            eveningGolden = { gap: "allDay" };
        } else if (gStart && !gEnd) {
            // −4° まで沈まない（白夜のころ）
            eveningGolden = { gap: "noDusk", from: gStart };
        } else {
            eveningGolden = { gap: dayGap ?? "polarNight" };
        }
        rows.push({ month, sunrise, sunset, eveningGolden });
    }
    return { timeZone, rows };
}

/** 表に出す言葉（日本語・英語） */
export function lightCellText(cell: LightCell, isJa: boolean): string {
    if ("text" in cell) return isJa ? cell.text : cell.text.replace("翌", "+1 ");
    switch (cell.gap) {
        case "midnightSun": return isJa ? "白夜" : "No sunset";
        case "polarNight": return isJa ? "極夜" : "No sunrise";
        case "allDay": return isJa ? "終日" : "All day";
        case "noDusk": return isJa ? `${cell.from}–（沈まない）` : `${cell.from}– (no dusk)`;
    }
}

/** 表に出てくる言葉の凡例（出てくるものだけ） */
export function lightLegend(rows: LightRow[], isJa: boolean): string[] {
    const gaps = new Set<LightGap>();
    let crosses = false;
    for (const r of rows) {
        for (const c of [r.sunrise, r.sunset, r.eveningGolden]) {
            if ("gap" in c) gaps.add(c.gap);
            else if (c.text.includes("翌")) crosses = true;
        }
    }
    const out: string[] = [];
    if (gaps.has("midnightSun")) out.push(isJa ? "白夜＝一日中太陽が沈まない" : "No sunset: the sun stays up all day");
    if (gaps.has("polarNight")) out.push(isJa ? "極夜＝一日中太陽が昇らない" : "No sunrise: the sun stays down all day");
    if (gaps.has("allDay")) out.push(isJa ? "終日＝太陽が一日中低く、昼のあいだずっとマジックアワー" : "All day: the sun stays low, so golden light lasts all day");
    if (gaps.has("noDusk")) out.push(isJa ? "沈まない＝マジックアワーの終わりまで太陽が沈みきらない" : "No dusk: the sun never sinks far enough to end golden hour");
    if (crosses) out.push(isJa ? "翌＝日付をまたいだ翌日の時刻" : "+1: the next day");
    return out;
}
