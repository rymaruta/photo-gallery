// lib/utils/sunTimes.ts
//
// **その場所・その日の光の時刻**（日の出・日の入り・ゴールデンアワー・ブルーアワー）と、日の出・日の入りの方角。
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
//   - ゴールデンアワー     高度 +6°〜−4°（英語は Golden hour。2026-10-03 にアプリと揃えて
//                          「マジックアワー」から呼び名を替えた）
//   - ブルーアワー         高度 −4°〜−6°
//
// 白夜・極夜で太陽がその高度を通らない日は `null`（作り話の時刻を出さない）。
//
// ## 方角（2026-10-03・撮影地ページの「光の時刻」）
//
// 日の出・日の入りの方位角を、**北から時計回りの度**で持つ（東 90°・南 180°・西 270°）。
// 同じ赤緯から球面三角の式で出す（アプリの `SunTimes.swift` の `risingAzimuth` と同じ式）。
// 国立天文台の暦（東京の夏至・冬至・春分、根室の夏至、鹿児島の冬至）と 0.5° 以内で合う
// （`__tests__/sunTimes.test.ts`）。日の出・日の入りの時刻が出ない日（白夜・極夜）は方角も `null`。

export type SunEvent = Date | null;

export type SunTimes = {
    /** 日の出（上端が地平線） */
    sunrise: SunEvent;
    /** 日の入り */
    sunset: SunEvent;
    /** 朝のブルーアワー（−6°→−4°） */
    morningBlue: { start: SunEvent; end: SunEvent };
    /** 朝のゴールデンアワー（−4°→+6°） */
    morningGolden: { start: SunEvent; end: SunEvent };
    /** 夕方のゴールデンアワー（+6°→−4°） */
    eveningGolden: { start: SunEvent; end: SunEvent };
    /** 夕方のブルーアワー（−4°→−6°） */
    eveningBlue: { start: SunEvent; end: SunEvent };
    /** 日の出の方位角（度・北から時計回り）。日が昇らない／沈まない日は null */
    sunriseAzimuth: number | null;
    /** 日の入りの方位角（度・北から時計回り）。日が昇らない／沈まない日は null */
    sunsetAzimuth: number | null;
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
 * 太陽がその高度（度）にあるときの、朝側の方位角（度・北から時計回り）。夕方側は 360 から引いた値。
 * 通らなければ null
 */
function risingAzimuth(altitude: number, lat: number, decl: number): number | null {
    const phi = lat * RAD, h = altitude * RAD;
    const cosA = (Math.sin(decl) - Math.sin(phi) * Math.sin(h)) / (Math.cos(phi) * Math.cos(h));
    if (!Number.isFinite(cosA) || cosA < -1 || cosA > 1) return null;
    return Math.acos(cosA) / RAD;
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
    // 日の出・日の入りの時刻が出る日だけ方角を出す（時刻の無い日に方角だけ言わない）
    const rises = hourAngleDays(-0.833, coords.lat, day.decl) !== null;
    const azimuth = rises ? risingAzimuth(-0.833, coords.lat, day.decl) : null;
    return {
        sunrise: at(-0.833, -1),
        sunset: at(-0.833, 1),
        morningBlue: { start: at(-6, -1), end: at(-4, -1) },
        morningGolden: { start: at(-4, -1), end: at(6, -1) },
        eveningGolden: { start: at(6, 1), end: at(-4, 1) },
        eveningBlue: { start: at(-4, 1), end: at(-6, 1) },
        sunriseAzimuth: azimuth,
        sunsetAzimuth: azimuth === null ? null : 360 - azimuth,
    };
}

/**
 * 国（台帳の `region.country`・日本語表記）→ 時刻帯。**時刻帯が1つの国だけ**。
 * 無い国は `null`——時刻をその土地の時計で言えないので、時刻を出さない
 * （利用者の端末の時計で言うと、旅先では読み違える）。日本の行は国を持たないことがある（無ければ日本）
 *
 * 2026-10-07 判断: 海外のスポットを大きく増やすので、アジア・中東・アフリカ・米州・欧州の
 * **時刻帯が1つの国**を足した。アメリカ・カナダ・オーストラリア・ブラジル・メキシコ・ロシア・
 * インドネシア・モンゴル・チリ（イースター島）・エクアドル（ガラパゴス）・ニュージーランド（チャタム）
 * のように**時刻帯が複数ある国は表に入れない**——台帳の行に `timeZone`（IANA 名）を書く
 * （`spotTimeZone` が先に見る）。書いていない行は節を出さない（推測で時計を決めない）。
 * **アプリの `SunTimes.countryTimeZones` と同じ表**（verify が突き合わせる）
 */
export const COUNTRY_TIME_ZONES: Readonly<Record<string, string>> = {
    日本: "Asia/Tokyo",
    // 欧州
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
    アイルランド: "Europe/Dublin",
    ベルギー: "Europe/Brussels",
    ルクセンブルク: "Europe/Luxembourg",
    モナコ: "Europe/Monaco",
    デンマーク: "Europe/Copenhagen",
    ノルウェー: "Europe/Oslo",
    スウェーデン: "Europe/Stockholm",
    アイスランド: "Atlantic/Reykjavik",
    エストニア: "Europe/Tallinn",
    ラトビア: "Europe/Riga",
    リトアニア: "Europe/Vilnius",
    ポーランド: "Europe/Warsaw",
    スロバキア: "Europe/Bratislava",
    ハンガリー: "Europe/Budapest",
    スロベニア: "Europe/Ljubljana",
    "ボスニア・ヘルツェゴビナ": "Europe/Sarajevo",
    セルビア: "Europe/Belgrade",
    モンテネグロ: "Europe/Podgorica",
    アルバニア: "Europe/Tirane",
    北マケドニア: "Europe/Skopje",
    ルーマニア: "Europe/Bucharest",
    ブルガリア: "Europe/Sofia",
    マルタ: "Europe/Malta",
    ジョージア: "Asia/Tbilisi",
    アルメニア: "Asia/Yerevan",
    // アジア
    韓国: "Asia/Seoul",
    台湾: "Asia/Taipei",
    中国: "Asia/Shanghai",
    香港: "Asia/Hong_Kong",
    マカオ: "Asia/Macau",
    タイ: "Asia/Bangkok",
    ベトナム: "Asia/Ho_Chi_Minh",
    カンボジア: "Asia/Phnom_Penh",
    ラオス: "Asia/Vientiane",
    ミャンマー: "Asia/Yangon",
    マレーシア: "Asia/Kuala_Lumpur",
    シンガポール: "Asia/Singapore",
    フィリピン: "Asia/Manila",
    インド: "Asia/Kolkata",
    ネパール: "Asia/Kathmandu",
    ブータン: "Asia/Thimphu",
    スリランカ: "Asia/Colombo",
    モルディブ: "Indian/Maldives",
    ウズベキスタン: "Asia/Tashkent",
    // 中東
    トルコ: "Europe/Istanbul",
    イスラエル: "Asia/Jerusalem",
    ヨルダン: "Asia/Amman",
    アラブ首長国連邦: "Asia/Dubai",
    カタール: "Asia/Qatar",
    オマーン: "Asia/Muscat",
    サウジアラビア: "Asia/Riyadh",
    イラン: "Asia/Tehran",
    // アフリカ
    エジプト: "Africa/Cairo",
    モロッコ: "Africa/Casablanca",
    チュニジア: "Africa/Tunis",
    ケニア: "Africa/Nairobi",
    タンザニア: "Africa/Dar_es_Salaam",
    エチオピア: "Africa/Addis_Ababa",
    ナミビア: "Africa/Windhoek",
    南アフリカ: "Africa/Johannesburg",
    // 米州
    キューバ: "America/Havana",
    ジャマイカ: "America/Jamaica",
    グアテマラ: "America/Guatemala",
    コスタリカ: "America/Costa_Rica",
    パナマ: "America/Panama",
    コロンビア: "America/Bogota",
    ペルー: "America/Lima",
    ボリビア: "America/La_Paz",
    アルゼンチン: "America/Argentina/Buenos_Aires",
    ウルグアイ: "America/Montevideo",
    // オセアニア
    フィジー: "Pacific/Fiji",
    パラオ: "Pacific/Palau",
};

export function timeZoneForCountry(country: string | undefined | null): string | null {
    return COUNTRY_TIME_ZONES[(country ?? "").trim() || "日本"] ?? null;
}

/** IANA の時刻帯の名前として読めるか（"America/New_York" など。"JST"・"+09:00" のような略号・ずれは受けない） */
export function isTimeZoneName(name: string | undefined | null): name is string {
    const n = (name ?? "").trim();
    if (!/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+)+$/.test(n)) return false;
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: n });
        return true;
    } catch {
        return false;
    }
}

/**
 * スポットの時刻帯。**台帳の行の `timeZone`（IANA 名）があればそれ**、無ければ国の表
 * （2026-10-07 判断: アメリカ・カナダ・オーストラリアのように時刻帯が複数ある国は、国から決められない）。
 * `timeZone` が読めない名前なら、国の表に落とす（台帳の書き損じで節を消さない。台帳のテストが見張る）。
 * **アプリの `SunTimes.timeZone(for:country:)` と同じ順**
 */
export function spotTimeZone(timeZone: string | undefined | null, country: string | undefined | null): string | null {
    if (isTimeZoneName(timeZone)) return timeZone.trim();
    return timeZoneForCountry(country);
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
