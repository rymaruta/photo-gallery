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
//       沈まない＝白夜でマジックアワーが終わらない／明け方まで＝沈むが −4° まで下がらず明け方までつながる
//     （7月は日の入りの時刻がある。そこに「沈まない」と並べると矛盾する・4276c25e のレビュー）
//   - **日付をまたぐ時刻には「翌」を付ける**（日の入り 00:10 が日の出 02:36 より前に見えないように）
//   - **天気・地形（山の影）は含まない**。画面にそう書く
//   - 年は決めた年（`LIGHT_REFERENCE_YEAR`）で計算する。年で変わるのは1分ほど（EU の夏時間の切り替えは
//     3月・10月の最終日曜で15日には重ならない）なので、ビルドの結果を日付で変えない

import { clockIn, sunAltitudeRange, sunTimes, timeZoneForCountry } from "./sunTimes";

/** 時刻が出ない欄の理由（画面が言葉と凡例にする） */
export type LightGap = "midnightSun" | "polarNight" | "allDay" | "noDusk" | "untilDawn";

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

/** "HH:MM" どうしで、後ろの方が早ければ翌日（日付をまたいだ） */
const nextDay = (earlier: string, later: string) => (later < earlier ? `翌${later}` : later);

/** 1日ぶんの欄（日の出・日の入り・夕方のマジックアワー） */
export type DayLight = Omit<LightRow, "month">;

/**
 * その場所・その暦日の欄。**表と旅行プランの当日モードが同じ言い分けを使う**（`tripLight.ts`）。
 * 計算できない（緯度が範囲外など）なら null——理由の分からない「極夜」を作らない
 */
export function dayLightCells(ymd: string, coords: { lat: number; lng: number }, timeZone: string): DayLight | null {
    const t = sunTimes(ymd, coords);
    const alt = sunAltitudeRange(ymd, coords);
    if (!t || !alt) return null;
    const rise = clockIn(timeZone, t.sunrise);
    const set = clockIn(timeZone, t.sunset);
    const gStart = clockIn(timeZone, t.eveningGolden.start);
    const gEnd = clockIn(timeZone, t.eveningGolden.end);

    // 日の出・日の入りが無い日は、白夜か極夜（同じ赤緯・同じ式なので必ずどちらか）
    const dayGap: LightGap = alt.min > HORIZON ? "midnightSun" : "polarNight";
    const sunrise: LightCell = rise ? { text: rise } : { gap: dayGap };
    const sunset: LightCell = set ? { text: rise ? nextDay(rise, set) : set } : { gap: dayGap };

    let eveningGolden: LightCell;
    if (gStart && gEnd) {
        eveningGolden = { text: `${gStart}–${nextDay(gStart, gEnd)}` };
    } else if (!gStart && alt.max < GOLDEN_TOP && alt.max > HORIZON) {
        // 昇るが一日中 6° まで上がらない＝昼のあいだずっとマジックアワー
        // （昇らない日＝極夜は「終日」と言わない。凡例の「昼のあいだ」と矛盾する）
        eveningGolden = { gap: "allDay" };
    } else if (gStart && !gEnd) {
        // −4° まで下がらない。沈まない（白夜）か、沈むが明け方までつながるか
        eveningGolden = { gap: alt.min > HORIZON ? "noDusk" : "untilDawn", from: gStart };
    } else {
        eveningGolden = { gap: dayGap };
    }
    return { sunrise, sunset, eveningGolden };
}

/**
 * その場所の1年ぶんの表。座標が無い・時刻帯が引けないなら null
 * @param country 台帳の `region.country`（日本の行は持たないことがある＝日本）
 */
export function lightCalendar(
    coords: { lat: number; lng: number } | undefined | null,
    country: string | undefined | null,
): LightCalendar | null {
    if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return null;
    const timeZone = timeZoneForCountry(country);
    if (!timeZone) return null;
    const rows: LightRow[] = [];
    for (let month = 1; month <= 12; month++) {
        const cells = dayLightCells(`${LIGHT_REFERENCE_YEAR}-${pad(month)}-${pad(LIGHT_DAY_OF_MONTH)}`, coords, timeZone);
        if (!cells) return null;
        rows.push({ month, ...cells });
    }
    return { timeZone, rows };
}

/** 表に出す言葉（日本語・英語） */
export function lightCellText(cell: LightCell, isJa: boolean): string {
    if ("text" in cell) {
        if (isJa || !cell.text.includes("翌")) return cell.text;
        // 英語は「00:18 (+1)」（ダッシュと + を続けない）
        return `${cell.text.replace("翌", "")} (+1)`;
    }
    switch (cell.gap) {
        // 英語も現象の名前にする（「No sunset」を日の出の列に置くと意味がずれる）
        case "midnightSun": return isJa ? "白夜" : "Midnight sun";
        case "polarNight": return isJa ? "極夜" : "Polar night";
        case "allDay": return isJa ? "終日" : "All day";
        case "noDusk": return isJa ? `${cell.from}–（沈まない）` : `${cell.from}– (sun stays up)`;
        case "untilDawn": return isJa ? `${cell.from}–（明け方まで）` : `${cell.from}– (until dawn)`;
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
    if (gaps.has("midnightSun")) out.push(isJa ? "白夜＝一日中太陽が沈まない" : "Midnight sun: the sun stays up all day");
    if (gaps.has("polarNight")) out.push(isJa ? "極夜＝一日中太陽が昇らない" : "Polar night: the sun stays down all day");
    if (gaps.has("allDay")) out.push(isJa ? "終日＝太陽が一日中低く、昼のあいだずっとマジックアワー" : "All day: the sun stays low, so golden light lasts all day");
    if (gaps.has("noDusk")) out.push(isJa ? "沈まない＝白夜で、マジックアワーが終わらない" : "Sun stays up: golden hour does not end");
    if (gaps.has("untilDawn")) out.push(isJa ? "明け方まで＝沈んでも暗くなりきらず、マジックアワーが明け方までつながる" : "Until dawn: the sun sets but golden light lasts until dawn");
    if (crosses) out.push(isJa ? "翌＝日付をまたいだ翌日の時刻" : "(+1): the next day");
    return out;
}
