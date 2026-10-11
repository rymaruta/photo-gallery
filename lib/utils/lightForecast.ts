/**
 * 光と天気の知らせ（Pro・デザインの板 LightAlert）の**画面に出すものを決める純粋な部分**。
 * 画面は `app/user/light/page.tsx`、入口は設定（`app/user/settings/LightAlertSettings.tsx`）。
 *
 * 応答は `GET /user/light-forecast`（`api-user/src/lightForecast.ts`）。Pro でなければ 403。
 *
 * iOS の `LightForecastText.swift`（2026-10-09）と同じ決め方に揃えた:
 *
 * - **札は場所ごとに1枚。** 7日 × 朝焼け・夕焼け・夜景のうち、いちばん良いもの
 *   （見込みが高い → 早い日 → 朝・夕・夜の順）。**もう過ぎた時間帯は選ばない**
 * - **並びは「いつ」の早い順**（板の並びが「明日 → 土 → 日 → 月」）。予報の無い場所は後ろ
 * - **真鍮の縁は見込み「高」のうちいちばん早い1枚だけ**。「高」が無い週は縁を付けない
 * - 日付・時刻は**その場所の時刻帯**で読む（サーバーが現地の時計で返す）
 *
 * 2026-10-11 判断: Web では Pro を売らない。403 は「Pro の人だけの機能」と言うだけで、
 * 購入の案内へは繋がない（`failureText` の `notPro`）。
 */

export type LightLocale = "ja" | "en";

export type LightChance = "high" | "mid" | "low";
export type LightWeather = "clear" | "partlyCloudy" | "cloudy" | "rain";
export type LightOutlook = { weather: LightWeather; chance: LightChance };
export type LightClock = { at: string; clock: string };

export type LightDay = {
    date: string;
    sunrise: LightClock | null;
    sunset: LightClock | null;
    eveningBlue: { start: LightClock | null; end: LightClock | null } | null;
    morning: LightOutlook | null;
    evening: LightOutlook | null;
    night: LightOutlook | null;
};

export type LightPlace = {
    key: string;
    slug: string;
    name: string;
    nameEn?: string;
    timeZone?: string;
    forecast: boolean;
    days: LightDay[];
};

export type LightAttribution = { serviceName: string; legalUrl: string };

export type LightForecast = {
    places: LightPlace[];
    note?: string;
    attribution: LightAttribution;
};

/** 応答に出典が無いときに出すもの（サーバーの `WEATHER_ATTRIBUTION` と同じ）。**出典は必ず出す**（Apple の求め） */
export const DEFAULT_ATTRIBUTION: LightAttribution = {
    serviceName: "Apple Weather",
    legalUrl: "https://weatherkit.apple.com/legal-attribution.html",
};

// ─── Apple Weather の商標（ロゴ） ────────────────────────
//
// WeatherKit の表示の決まり（developer.apple.com/weatherkit/get-started/ の
// 「Apple Weather and third-party attribution」・2026-10-11 に読んだ要点）:
//  - Apple の天気データを出す**アプリ・Web アプリ・Web サイト**は、Apple Weather の商標
//    （ Weather）と、**ほかのデータの出典への法的なリンク**をはっきり出す
//  - 天気の警報を出すなら Apple の警報の頁へのリンクと発表した気象機関の名前（ここは出さない）
//  - 手を加えて元のデータが分からない形にしたもの（value-added）は「 Weather」を出典とし、
//    Apple のデータに手を加えた旨を添える
// ロゴの最小の高さは、その頁には書かれていない。Apple が配る @1x の画像の高さ（14px）で出す。
//
// ロゴは `https://weatherkit.apple.com/attribution/{lang}`（認証不要の JSON・CORS は `*`）が
// 配る画像を**そのまま**使う。返るのは `logoDark@1x` などの**相対の道**だけで、`legalPageURL` は
// 無かった（2026-10-11 実測）——リンク先はサーバーの `attribution.legalUrl` のまま。

export const WEATHERKIT_ORIGIN = "https://weatherkit.apple.com";

/** 黒地の上なので dark（白い文字のロゴ）。1x / 2x / 3x の絶対 URL */
export type WeatherLogo = { x1: string; x2: string; x3: string };

/** ロゴの JSON の取り先。言語は画面に合わせる（日本語のロゴは「天気」） */
export const attributionJsonUrl = (locale: LightLocale) => `${WEATHERKIT_ORIGIN}/attribution/${locale === "en" ? "en" : "ja"}`;

/**
 * ロゴの JSON を読む。**`/assets/` で始まる道だけ**を Apple の配信元に繋ぐ（応答の値を
 * そのまま `<img>` に入れるため）。3つ揃わなければ null（呼び出し側は文字の表記に倒す）
 */
export function parseWeatherLogo(raw: unknown): WeatherLogo | null {
    if (!isObj(raw)) return null;
    const pick = (k: string) => {
        const v = str(raw[k]);
        return v && /^\/assets\/[\w./-]+\.png$/.test(v) && !v.includes("..") ? `${WEATHERKIT_ORIGIN}${v}` : null;
    };
    const x1 = pick("logoDark@1x");
    const x2 = pick("logoDark@2x");
    const x3 = pick("logoDark@3x");
    return x1 && x2 && x3 ? { x1, x2, x3 } : null;
}

// ─── 応答を読む ─────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

const WEATHERS: readonly LightWeather[] = ["clear", "partlyCloudy", "cloudy", "rain"];
const CHANCES: readonly LightChance[] = ["high", "mid", "low"];

function clockOf(v: unknown): LightClock | null {
    if (!isObj(v)) return null;
    const at = str(v.at);
    const clock = str(v.clock);
    return at && clock ? { at, clock } : null;
}

function outlookOf(v: unknown): LightOutlook | null {
    if (!isObj(v)) return null;
    const weather = WEATHERS.find((w) => w === v.weather);
    const chance = CHANCES.find((c) => c === v.chance);
    return weather && chance ? { weather, chance } : null;
}

/** 出典のリンクは https だけ通す（応答の値をそのまま href に入れるため） */
function attributionOf(v: unknown): LightAttribution {
    if (!isObj(v)) return DEFAULT_ATTRIBUTION;
    const serviceName = str(v.serviceName);
    const legalUrl = str(v.legalUrl);
    if (!serviceName || !legalUrl || !/^https:\/\//.test(legalUrl)) return DEFAULT_ATTRIBUTION;
    return { serviceName, legalUrl };
}

/**
 * 応答を形を確かめて読む。**読めない場所・日は落とし、読める分は出す。**
 * 本文がオブジェクトでなければ null（呼び出し側は「読めなかった」にする）
 */
export function parseLightForecast(raw: unknown): LightForecast | null {
    if (!isObj(raw)) return null;
    const places: LightPlace[] = [];
    for (const p of Array.isArray(raw.places) ? raw.places : []) {
        if (!isObj(p)) continue;
        const key = str(p.key);
        const name = str(p.name);
        if (!key || !name) continue;
        const days: LightDay[] = [];
        for (const d of Array.isArray(p.days) ? p.days : []) {
            if (!isObj(d) || !str(d.date)) continue;
            const blue = isObj(d.eveningBlue) ? d.eveningBlue : null;
            days.push({
                date: d.date as string,
                sunrise: clockOf(d.sunrise),
                sunset: clockOf(d.sunset),
                eveningBlue: blue ? { start: clockOf(blue.start), end: clockOf(blue.end) } : null,
                morning: outlookOf(d.morning),
                evening: outlookOf(d.evening),
                night: outlookOf(d.night),
            });
        }
        places.push({
            key,
            slug: str(p.slug) ?? "",
            name,
            ...(str(p.nameEn) ? { nameEn: p.nameEn as string } : {}),
            ...(str(p.timeZone) ? { timeZone: p.timeZone as string } : {}),
            forecast: p.forecast === true,
            days,
        });
    }
    return { places, note: str(raw.note), attribution: attributionOf(raw.attribution) };
}

// ─── 読めなかったとき ───────────────────────────────────

export type LightFailure = "notPro" | "unavailable" | "signedOut" | "other";

/** 状態の番号から。**403 は Pro でない**（サーバーの `getLightForecast`） */
export function failureOf(status: number): LightFailure {
    if (status === 403) return "notPro";
    if (status === 503) return "unavailable";
    if (status === 401) return "signedOut";
    return "other";
}

export function failureText(f: LightFailure, locale: LightLocale): { title: string; body: string } {
    const en = locale === "en";
    switch (f) {
        // **購入へ案内しない**（Web では何も売らない・2026-10-11 owner）
        case "notPro":
            return en
                ? { title: "For Pro members", body: "This week's light and weather for your wishlist places is available to Journey Photo Pro members." }
                : { title: "Pro の方の機能です", body: "行きたい場所の今週の光と天気は、Journey Photo Pro の方が使えます。" };
        case "unavailable":
            return en
                ? { title: "Forecasts are unavailable right now", body: "We can't reach the weather service. Please try again later." }
                : { title: "いまは天気の予報を読めません", body: "天気の予報の受け取り先に繋がっていません。しばらくしてからもう一度開いてください。" };
        case "signedOut":
            return en
                ? { title: "Please sign in", body: "Sign in again, then reopen this page." }
                : { title: "ログインが必要です", body: "ログインし直してから、もう一度開いてください。" };
        default:
            return en
                ? { title: "Couldn't load", body: "Check your connection and try again." }
                : { title: "読み込めませんでした", body: "接続を確かめて、もう一度お試しください。" };
    }
}

// ─── 言葉 ───────────────────────────────────────────────

type Moment = "morning" | "evening" | "night";
const MOMENTS: readonly Moment[] = ["morning", "evening", "night"];
const momentRank = (m: Moment) => MOMENTS.indexOf(m);
const chanceRank = (c: LightChance) => (c === "high" ? 2 : c === "mid" ? 1 : 0);

const WORD: Record<Moment, { ja: string; en: string }> = {
    morning: { ja: "朝焼け", en: "Morning glow" },
    evening: { ja: "夕焼け", en: "Evening glow" },
    night: { ja: "夜景", en: "Night view" },
};
const EVENT: Record<Moment, { ja: string; en: string }> = {
    morning: { ja: "日の出", en: "Sunrise" },
    evening: { ja: "日の入り", en: "Sunset" },
    night: { ja: "ブルーアワー", en: "Blue hour" },
};

export function weatherWord(w: LightWeather, locale: LightLocale): string {
    const t = { clear: ["晴れ", "Clear"], partlyCloudy: ["くもり時々晴れ", "Partly cloudy"], cloudy: ["くもり", "Cloudy"], rain: ["雨", "Rain"] }[w];
    return locale === "en" ? t[1] : t[0];
}

export function chanceWord(c: LightChance, locale: LightLocale): string {
    const t = { high: ["見込み高", "High chance"], mid: ["見込み中", "Fair chance"], low: ["見込み低", "Low chance"] }[c];
    return locale === "en" ? t[1] : t[0];
}

/** "05:42" → "5:42"（板の書き方） */
export function shortClock(clock: string): string {
    return /^0\d:\d\d$/.test(clock) ? clock.slice(1) : clock;
}

const outlookIn = (m: Moment, d: LightDay) => (m === "morning" ? d.morning : m === "evening" ? d.evening : d.night);
const clockIn = (m: Moment, d: LightDay) => (m === "morning" ? d.sunrise : m === "evening" ? d.sunset : d.eveningBlue?.start ?? null);

// ─── 暦 ─────────────────────────────────────────────────

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const utcMs = (ymd: string): number | null => {
    const m = YMD.exec(ymd);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

/** 暦の日数の差（`to` − `from`）。どちらかが読めなければ null */
export function dayOffset(to: string, from: string): number | null {
    const a = utcMs(from);
    const b = utcMs(to);
    return a === null || b === null ? null : Math.round((b - a) / 86_400_000);
}

/** その場所の「今日」（その土地の暦）。時刻帯が読めなければ、サーバーが返した最初の日 */
export function todayFor(place: LightPlace, now: Date): string | null {
    if (place.timeZone) {
        try {
            // en-CA は YYYY-MM-DD で書く
            const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: place.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
            if (YMD.test(ymd)) return ymd;
        } catch { /* 知らない時刻帯は下へ */ }
    }
    return place.days[0]?.date ?? null;
}

const WEEK_JA = ["日", "月", "火", "水", "木", "金", "土"];
const WEEK_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 「今日」「明日」、それより先は曜日（7日の中なので曜日だけで分かる） */
export function dayWord(ymd: string, today: string, locale: LightLocale): string {
    const off = dayOffset(ymd, today);
    const ms = utcMs(ymd);
    if (off === null || ms === null) return ymd;
    if (off === 0) return locale === "en" ? "Today" : "今日";
    if (off === 1) return locale === "en" ? "Tomorrow" : "明日";
    const wd = new Date(ms).getUTCDay();
    return locale === "en" ? WEEK_EN[wd] : `${WEEK_JA[wd]}曜`;
}

/** 「10月11日（土）」/ "Sat, Oct 11" */
function dateWithWeekday(ymd: string, locale: LightLocale): string {
    const ms = utcMs(ymd);
    if (ms === null) return ymd;
    const d = new Date(ms);
    if (locale === "en") {
        const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
        return `${WEEK_EN[d.getUTCDay()]}, ${mon} ${d.getUTCDate()}`;
    }
    return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEK_JA[d.getUTCDay()]}）`;
}

// ─── いちばん良い時間帯 ─────────────────────────────────

type Pick = { day: LightDay; offset: number; moment: Moment; outlook: LightOutlook | null };

/** これから来る時間帯（日の順・朝夕夜の順）。**今日の、目印の時刻を過ぎた時間帯は選ばない** */
function upcoming(place: LightPlace, now: Date): Pick[] {
    const today = todayFor(place, now);
    if (!today) return [];
    const out: Pick[] = [];
    for (const day of place.days) {
        const offset = dayOffset(day.date, today);
        if (offset === null || offset < 0) continue;
        for (const moment of MOMENTS) {
            if (offset === 0) {
                const at = clockIn(moment, day)?.at;
                const t = at ? Date.parse(at) : NaN;
                if (!Number.isNaN(t) && t <= now.getTime()) continue;
            }
            out.push({ day, offset, moment, outlook: outlookIn(moment, day) });
        }
    }
    return out.sort((a, b) => a.offset - b.offset || momentRank(a.moment) - momentRank(b.moment));
}

/** その場所でいちばん良い時間帯。見込みが1つも無ければ、次の日の出か日の入り（光の時刻だけ） */
function best(place: LightPlace, now: Date): Pick | null {
    const ahead = upcoming(place, now);
    let top: Pick | null = null;
    for (const p of ahead) {
        if (!p.outlook) continue;
        // 厳密に良いときだけ入れ替える（同じ見込みなら早い方が残る）
        if (!top || chanceRank(p.outlook.chance) > chanceRank(top.outlook!.chance)) top = p;
    }
    return top ?? ahead.find((p) => p.moment !== "night" && clockIn(p.moment, p.day) !== null) ?? null;
}

// ─── 札 ─────────────────────────────────────────────────

/** 色の四角（板 LightAlert の4色を見込みの種類に当てた・iOS と同じ）。予報の無い場所は暗い灰 */
export type LightTone = "morning" | "evening" | "night" | "low" | "none";
export const TONE_COLOR: Record<LightTone, string> = {
    morning: "#4a3b32",
    evening: "#2f3a45",
    night: "#27352c",
    low: "#3d3346",
    none: "#222222",
};

export type LightCard = {
    key: string;
    name: string;
    /** 「明日 · 日の出 5:42」 */
    when: string;
    /** 右上: 「晴れ」。予報の無い場所は「予報なし」 */
    weather: string;
    /** 右下: 「朝焼け 見込み高」。低いときは「見込み低」だけ（板の4枚目） */
    kind: string;
    tone: LightTone;
    chance: LightChance | null;
    /** 真鍮の縁（見込み「高」のうちいちばん早い1枚） */
    isBest: boolean;
};

export function placeName(place: LightPlace, locale: LightLocale): string {
    return locale === "en" && place.nameEn ? place.nameEn : place.name;
}

function whenLine(p: Pick, today: string, locale: LightLocale): string {
    const clock = clockIn(p.moment, p.day)?.clock;
    const event = EVENT[p.moment][locale] + (clock ? ` ${shortClock(clock)}` : "");
    return `${dayWord(p.day.date, today, locale)} · ${event}`;
}

function cardFor(place: LightPlace, now: Date, locale: LightLocale): { card: LightCard; sort: [number, number, number] } {
    const en = locale === "en";
    const name = placeName(place, locale);
    const pick = best(place, now);
    if (!pick) {
        return {
            card: { key: place.key, name, when: en ? "No sun times this week" : "今週の光の時刻はありません", weather: en ? "No forecast" : "予報なし", kind: "", tone: "none", chance: null, isBest: false },
            sort: [2, 0, 0],
        };
    }
    const when = whenLine(pick, todayFor(place, now) ?? "", locale);
    const sort: [number, number, number] = [pick.outlook ? 0 : 1, pick.offset, momentRank(pick.moment)];
    if (!pick.outlook) {
        return {
            card: { key: place.key, name, when, weather: en ? "No forecast" : "予報なし", kind: en ? "Sun times only" : "光の時刻だけ", tone: "none", chance: null, isBest: false },
            sort,
        };
    }
    const { chance, weather } = pick.outlook;
    const kind = chance === "low"
        ? chanceWord("low", locale)
        : `${WORD[pick.moment][locale]}${en ? " · " : " "}${chanceWord(chance, locale)}`;
    return {
        card: { key: place.key, name, when, weather: weatherWord(weather, locale), kind, tone: chance === "low" ? "low" : pick.moment, chance, isBest: false },
        sort,
    };
}

/** 一覧の札（並べ方と真鍮の縁はファイル冒頭） */
export function lightCards(forecast: LightForecast, now: Date, locale: LightLocale): LightCard[] {
    const made = forecast.places.map((p, i) => ({ i, ...cardFor(p, now, locale) }));
    made.sort((a, b) => a.sort[0] - b.sort[0] || a.sort[1] - b.sort[1] || a.sort[2] - b.sort[2] || a.i - b.i);
    const cards = made.map((m) => m.card);
    const first = cards.findIndex((c) => c.chance === "high");
    if (first >= 0) cards[first] = { ...cards[first], isBest: true };
    return cards;
}

// ─── 札を開いたときの7日 ────────────────────────────────

export type LightDayLine = {
    date: string;
    title: string;
    items: { event: string; outlook: string; chance: LightChance | null }[];
};

/** 今日から先の日を、朝・夕・夜の行ずつ（過ぎた時間帯も日の中には残す） */
export function weekLines(place: LightPlace, now: Date, locale: LightLocale): LightDayLine[] {
    const today = todayFor(place, now);
    if (!today) return [];
    const out: LightDayLine[] = [];
    for (const day of place.days) {
        const offset = dayOffset(day.date, today);
        if (offset === null || offset < 0) continue;
        const items = MOMENTS.flatMap((m) => {
            const clock = clockIn(m, day);
            const o = outlookIn(m, day);
            if (!clock && !o) return [];
            const event = EVENT[m][locale] + (clock ? ` ${shortClock(clock.clock)}` : "");
            const outlook = o
                ? `${WORD[m][locale]} ${chanceWord(o.chance, locale)} · ${weatherWord(o.weather, locale)}`
                : `${WORD[m][locale]} ${locale === "en" ? "no forecast" : "予報なし"}`;
            return [{ event, outlook, chance: o?.chance ?? null }];
        });
        if (items.length === 0) continue;
        out.push({ date: day.date, title: offset <= 1 ? dayWord(day.date, today, locale) : dateWithWeekday(day.date, locale), items });
    }
    return out;
}

// ─── 注記 ───────────────────────────────────────────────

/**
 * 2026-10-11 判断: 見込みは Apple Weather のデータに手を加えた（value-added）もの。WeatherKit の
 * 表示の決まり（「Apple Weather and third-party attribution」）に合わせ、出典と手を加えた旨を
 * 「見込みは目安で…」の前に続けて出す（サーバーの `LIGHT_NOTE`・iOS の `LightForecastText` と同じ文）
 */
const DEFAULT_NOTE = {
    ja: "天気は外部の予報から。光の時刻はアプリで計算。Apple Weather のデータをもとに Journey Photo が計算した見込みです。見込みは目安で、外れることがあります。",
    en: "Weather comes from an outside forecast; sun times are calculated by the app. Estimates calculated by Journey Photo from Apple Weather data. Chances are a guide and can be wrong.",
};

/** 画面の注記。**英語の画面にはサーバーの日本語を出さない**（サーバーは日本語だけ返す） */
export function noteFor(forecast: LightForecast, locale: LightLocale): string {
    if (locale === "en") return DEFAULT_NOTE.en;
    return forecast.note ?? DEFAULT_NOTE.ja;
}
