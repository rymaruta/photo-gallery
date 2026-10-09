/**
 * メダルの**数え方**（純関数だけ。読み書きは `badgeStore.ts`）。
 *
 * 数えるのは本人の**公開している写真**（`published !== false`・ストーリーでない・実体がある）。
 * 公開範囲を絞った写真（フォロワーのみ等）も本人の公開写真として数える——メダルに出るのは
 * 数の段だけで、どの写真かは出ない。
 *
 * | 鍵          | 数えるもの                                         | 銅 / 銀 / 白金 |
 * |-------------|----------------------------------------------------|----------------|
 * | first       | 写真が1枚でもある                                   | 1（1段だけ）    |
 * | prefectures | 撮った都道府県の数                                  | 10 / 30 / 47   |
 * | countries   | 撮影地に書かれた国・地域の数（iOS と同じ数え方）     | 3 / 10 / 30    |
 * | seasons     | 春夏秋冬を全部撮った年の数                          | 1 / 2 / 3      |
 * | morning     | 日の出の前後1時間に撮った枚数                       | 10 / 50 / 200  |
 * | night       | 日の入りから、翌日の日の出の1時間前までに撮った枚数 | 10 / 50 / 200  |
 * | books       | 旅の一冊（`trip-` の束）の冊数（iOS の棚と同じ規則）   | 3 / 10 / 30    |
 * | wish        | 「行きたい」に入れたスポットで撮った数              | 3 / 10 / 30    |
 * | earlyUser   | 数えない（`scripts/grant-early-user.js` だけが付ける）| 1             |
 *
 * ## 精度の限り（画面・報告で言い過ぎないこと）
 *
 * - **都道府県**: ① 写真に付けたスポット（台帳の県）→ ② 撮影地の文字に県名が書いてあるか
 *   （「京都府」「京都」「Kyoto」）→ ③ 座標を**いちばん近い台帳のスポットの県**に寄せる
 *   （40km より遠ければ数えない）。③は県境の近くで隣の県に入ることがある
 *   （台帳の点は県あたり約30）。通信はしない（ジオコーディングを使わない）
 * - **国**: iOS の `VisitedCountries` と同じ——撮影地の文字に**国の名前が書いてあるとき
 *   だけ**数える。「パリ」からフランスを当てない（当て損なうと書いていない国が並ぶ）
 * - **朝・夜**: 撮影日時（EXIF の壁時計）と座標の両方がある写真だけ。壁時計を瞬間に
 *   直すのに時刻帯が要るので、① スポットの時刻帯 → ② 日本（県が分かる）→ ③ 撮影地の文字の
 *   国（時刻帯が1つの国だけ）で決め、決められない写真は数えない。日の出の式は
 *   `lib/utils/sunTimes.ts` と同じ（誤差1〜2分）。座標は約1km に丸めてある
 * - **季節**: 月で分ける（3〜5月 春・6〜8月 夏・9〜11月 秋・12〜2月 冬）。南半球
 *   （緯度が負）は入れ替える。年は暦の年（1月の冬と12月の冬は同じ年）
 */
import LEDGER from "./data/badgeLedger.json";
import { COUNTED_BADGE_KEYS, MAX_TIER, sanitizeBadges } from "./badgeKeys";
import type { BadgeKey, BadgeMap, CountedBadgeKey } from "./badgeKeys";
import type { Photo } from "./types";

/** 段の線（銅・銀・白金）。`first` は1段だけ */
export const BADGE_THRESHOLDS: Record<CountedBadgeKey, readonly number[]> = {
    first: [1],
    prefectures: [10, 30, 47],
    countries: [3, 10, 30],
    seasons: [1, 2, 3],
    morning: [10, 50, 200],
    night: [10, 50, 200],
    books: [3, 10, 30],
    wish: [3, 10, 30],
};

/** 数から段（0 は「まだ」） */
export function tierFor(key: CountedBadgeKey, count: number): number {
    let tier = 0;
    for (const t of BADGE_THRESHOLDS[key]) if (count >= t) tier++;
    return tier;
}

/** 次の段の線。最上段なら null */
export function nextThreshold(key: CountedBadgeKey, count: number): number | null {
    return BADGE_THRESHOLDS[key].find((t) => count < t) ?? null;
}

// ─── 台帳の写し ─────────────────────────────────────────────

type Ledger = {
    prefectures: string[];
    timeZones: string[];
    spots: [string, string, number, number][];
    points: [number, number, number][];
    countryTimeZones: Record<string, string>;
};
const L = LEDGER as unknown as Ledger;

export const PREFECTURE_NAMES: readonly string[] = L.prefectures;
const SPOT_BY_ID = new Map(L.spots.map(([id, , pref, tz]) => [id, { pref, tz: tz >= 0 ? L.timeZones[tz] : null }]));
const SPOT_ID_BY_SLUG = new Map(L.spots.map(([id, slug]) => [slug, id]));

/** 「行きたい場所」の鍵のうち、台帳のスポットを指すもの（`lib/utils/savedSpotKey.ts`） */
export const SPOT_KEY_PREFIX = "SPOT-";

// ─── 都道府県 ───────────────────────────────────────────────

/** 県名の英語（`lib/data/prefectures.ts` の slug と同じ綴り）。PREFECTURE_NAMES と同じ順 */
const PREF_EN = [
    "hokkaido", "aomori", "iwate", "miyagi", "akita", "yamagata", "fukushima", "ibaraki", "tochigi", "gunma",
    "saitama", "chiba", "tokyo", "kanagawa", "niigata", "toyama", "ishikawa", "fukui", "yamanashi", "nagano",
    "gifu", "shizuoka", "aichi", "mie", "shiga", "kyoto", "osaka", "hyogo", "nara", "wakayama",
    "tottori", "shimane", "okayama", "hiroshima", "yamaguchi", "tokushima", "kagawa", "ehime", "kochi", "fukuoka",
    "saga", "nagasaki", "kumamoto", "oita", "miyazaki", "kagoshima", "okinawa",
];

/** 「京都府」→「京都」。北海道はそのまま */
const shortPref = (name: string) => (name === "北海道" ? name : name.replace(/[都府県]$/, ""));

/**
 * 撮影地の文字に書かれた県（PREFECTURE_NAMES の添字）。書かれていなければ null。
 *
 * - 正式名（「京都府」）を先に見る。次に短い名（「京都」）、最後に英語（単語として）
 * - **「東京都」は「京都」を含む。** 短い名の「京都」は直前が「東」なら当てない
 * - いちばん前に書かれた県を採る（「香川県 観音寺市」）
 */
export function prefectureOfText(text: unknown): number | null {
    if (typeof text !== "string" || !text.trim()) return null;
    const s = text.normalize("NFKC");
    const found = { pos: Infinity, idx: -1 };
    const take = (pos: number, idx: number) => {
        if (pos >= 0 && pos < found.pos) { found.pos = pos; found.idx = idx; }
    };
    PREFECTURE_NAMES.forEach((name, idx) => take(s.indexOf(name), idx));
    if (found.idx >= 0) return found.idx;
    PREFECTURE_NAMES.forEach((name, idx) => {
        const short = shortPref(name);
        for (let from = 0; ;) {
            const pos = s.indexOf(short, from);
            if (pos < 0) return;
            if (!(short === "京都" && pos > 0 && s[pos - 1] === "東")) { take(pos, idx); return; }
            from = pos + 1;
        }
    });
    if (found.idx >= 0) return found.idx;
    const lower = s.toLowerCase();
    PREF_EN.forEach((en, idx) => {
        const m = new RegExp(`(^|[^a-z])${en}($|[^a-z])`).exec(lower);
        if (m) take(m.index + m[1].length, idx);
    });
    return found.idx >= 0 ? found.idx : null;
}

/** 座標を寄せてよい距離の上限（km）。これより遠い点しか無ければ数えない */
export const NEAREST_PREF_MAX_KM = 40;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 座標 → いちばん近い台帳のスポットの県。日本の外・遠すぎるときは null */
export function nearestPrefecture(lat: number, lng: number): number | null {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    // 日本のおおよその外枠（与那国〜択捉・沖ノ鳥島〜宗谷）。外なら引かない
    if (lat < 20 || lat > 46 || lng < 122 || lng > 154) return null;
    let bestKm = Infinity, bestPref = -1;
    for (const [plat, plng, pref] of L.points) {
        // 緯度で1度（約111km）以上離れた点は距離を計るまでもない
        if (Math.abs(plat - lat) > 1) continue;
        const km = haversineKm(lat, lng, plat, plng);
        if (km < bestKm) { bestKm = km; bestPref = pref; }
    }
    return bestPref >= 0 && bestKm <= NEAREST_PREF_MAX_KM ? bestPref : null;
}

function coordsOf(p: Photo): { lat: number; lng: number } | null {
    const c = p.coords as { lat?: unknown; lng?: unknown } | undefined;
    const lat = Number(c?.lat), lng = Number(c?.lng);
    if (!c || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
}

/** その写真の県（① スポット → ② 撮影地の文字 → ③ 座標）。分からなければ null */
export function prefectureOfPhoto(p: Photo): number | null {
    const spot = typeof p.spotId === "string" ? SPOT_BY_ID.get(p.spotId) : undefined;
    if (spot && spot.pref >= 0) return spot.pref;
    const byText = prefectureOfText(p.location);
    if (byText !== null) return byText;
    const c = coordsOf(p);
    return c ? nearestPrefecture(c.lat, c.lng) : null;
}

// ─── 国（iOS の VisitedCountries と同じ） ────────────────────

/**
 * 国・地域の名前（日本語 → 英語）。**iOS の `VisitedCountries.table` の写し。**
 * 書かれていれば当たるだけの表で、地名から国を当てるものではない。
 * 足すときはアプリの表にも同じ行を足す（数がアプリと食い違う）。
 */
export const COUNTRY_TABLE: readonly (readonly [string, string])[] = [
    ["日本", "japan"], ["フランス", "france"], ["スペイン", "spain"],
    ["ギリシャ", "greece"], ["イタリア", "italy"], ["フィンランド", "finland"],
    ["アイスランド", "iceland"], ["ニュージーランド", "new zealand"],
    ["クロアチア", "croatia"], ["ボリビア", "bolivia"], ["ペルー", "peru"],
    ["アメリカ", "united states"], ["カナダ", "canada"], ["メキシコ", "mexico"],
    ["イギリス", "united kingdom"], ["ドイツ", "germany"], ["スイス", "switzerland"],
    ["オーストリア", "austria"], ["オランダ", "netherlands"], ["ベルギー", "belgium"],
    ["ポルトガル", "portugal"], ["ノルウェー", "norway"], ["スウェーデン", "sweden"],
    ["デンマーク", "denmark"], ["アイルランド", "ireland"], ["ポーランド", "poland"],
    ["チェコ", "czechia"], ["ハンガリー", "hungary"], ["トルコ", "turkey"],
    ["モロッコ", "morocco"], ["エジプト", "egypt"], ["南アフリカ", "south africa"],
    ["ケニア", "kenya"], ["インド", "india"], ["ネパール", "nepal"],
    ["タイ", "thailand"], ["ベトナム", "vietnam"], ["カンボジア", "cambodia"],
    ["インドネシア", "indonesia"], ["マレーシア", "malaysia"],
    ["シンガポール", "singapore"], ["フィリピン", "philippines"],
    ["韓国", "south korea"], ["台湾", "taiwan"], ["中国", "china"],
    ["香港", "hong kong"], ["モンゴル", "mongolia"],
    ["オーストラリア", "australia"], ["フィジー", "fiji"],
    ["ブラジル", "brazil"], ["アルゼンチン", "argentina"], ["チリ", "chile"],
    ["キューバ", "cuba"], ["アラブ首長国連邦", "united arab emirates"],
];

/** 長い名前から見る（「南アフリカ」を「アフリカ」より先に） */
const COUNTRY_SORTED = [...COUNTRY_TABLE].sort(
    (a, b) => Math.max(b[0].length, b[1].length) - Math.max(a[0].length, a[1].length));

/** 撮影地の文字に書かれた国・地域（日本語名）。無ければ null。iOS の `country(in:)` と同じ */
export function countryOfText(text: unknown): string | null {
    if (typeof text !== "string") return null;
    const folded = text.toLowerCase().replace(/　/g, " ");
    if (!folded) return null;
    for (const [ja, en] of COUNTRY_SORTED) {
        if (folded.includes(ja) || folded.includes(en)) return ja;
    }
    return null;
}

// ─── 季節 ───────────────────────────────────────────────────

/** 撮影の年と月。撮影日（`date`）→ EXIF の撮影日時の順 */
export function yearMonthOf(p: Photo): { y: number; m: number } | null {
    for (const raw of [p.date, p.exif?.dateTimeOriginal]) {
        if (typeof raw !== "string") continue;
        const m = /^(\d{4})[-:/](\d{2})/.exec(raw.trim());
        if (!m) continue;
        const y = Number(m[1]), mo = Number(m[2]);
        if (y >= 1900 && mo >= 1 && mo <= 12) return { y, m: mo };
    }
    return null;
}

/** 0 春・1 夏・2 秋・3 冬。南半球は半年ずらす */
export function seasonOf(month: number, southern: boolean): number {
    const north = month >= 3 && month <= 5 ? 0 : month >= 6 && month <= 8 ? 1 : month >= 9 && month <= 11 ? 2 : 3;
    return southern ? (north + 2) % 4 : north;
}

// ─── 光（日の出・日の入り） ─────────────────────────────────

const RAD = Math.PI / 180;
const J2000 = 2451545.0;
const DAY_MS = 86_400_000;
const JD_UNIX_EPOCH = 2440587.5;

/**
 * その暦日（UTC の日付で指定）の日の出・日の入り（ms）。白夜・極夜は null。
 * **`lib/utils/sunTimes.ts` と同じ式**（`__tests__/badges.test.ts` が突き合わせる）。
 * あちらは Next 側の lib で、Lambda のバンドルに持ち込まないので写してある
 */
export function sunriseSunset(y: number, m: number, d: number, lat: number, lng: number): { rise: number; set: number } | null {
    if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng)) return null;
    const noonUtc = Date.UTC(y, m - 1, d, 12);
    const n = Math.round(noonUtc / DAY_MS + JD_UNIX_EPOCH - J2000) + 0.0008;
    const jStar = n - lng / 360;
    const M = (357.5291 + 0.98560028 * jStar) % 360;
    const Mr = M * RAD;
    const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
    const lambda = ((M + C + 180 + 102.9372) % 360) * RAD;
    const transit = J2000 + jStar + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * lambda);
    const decl = Math.asin(Math.sin(lambda) * Math.sin(23.4397 * RAD));
    const phi = lat * RAD;
    const cosW = (Math.sin(-0.833 * RAD) - Math.sin(phi) * Math.sin(decl)) / (Math.cos(phi) * Math.cos(decl));
    if (!Number.isFinite(cosW) || cosW < -1 || cosW > 1) return null;
    const w = Math.acos(cosW) / (2 * Math.PI);
    const toMs = (jd: number) => Math.round((jd - JD_UNIX_EPOCH) * DAY_MS);
    return { rise: toMs(transit - w), set: toMs(transit + w) };
}

/** その時刻帯での、その瞬間の UTC からのずれ（ms）。読めない時刻帯は null */
function zoneOffsetMs(tz: string, at: number): number | null {
    try {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: tz, hourCycle: "h23",
            year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
        }).formatToParts(new Date(at));
        const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
        const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
        return Number.isFinite(asUtc) ? asUtc - Math.floor(at / 1000) * 1000 : null;
    } catch {
        return null;
    }
}

/** その時刻帯の壁時計 → 瞬間（ms）。夏時間の切り替わりの前後は1時間ずれうる（数に効かない幅） */
export function wallClockToInstant(wallUtcMs: number, tz: string): number | null {
    const o1 = zoneOffsetMs(tz, wallUtcMs);
    if (o1 === null) return null;
    const o2 = zoneOffsetMs(tz, wallUtcMs - o1);
    return wallUtcMs - (o2 ?? o1);
}

const STAMP_RE = /^(\d{4})[-:](\d{2})[-:](\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

/** その写真の時刻帯（① スポット → ② 日本の県が分かる → ③ 撮影地の文字の国）。決められなければ null */
export function timeZoneOfPhoto(p: Photo): string | null {
    const spot = typeof p.spotId === "string" ? SPOT_BY_ID.get(p.spotId) : undefined;
    if (spot?.tz) return spot.tz;
    if (prefectureOfPhoto(p) !== null) return "Asia/Tokyo";
    const country = countryOfText(p.location);
    if (country) return L.countryTimeZones[country] ?? null;
    return null;
}

/**
 * 撮った瞬間（ms）。EXIF の撮影日時 → 時刻の入った撮影日の順。
 * ゾーンが書いてあればそれで、無ければ（壁時計）写真の時刻帯で直す。直せなければ null
 */
export function shotInstant(p: Photo): number | null {
    for (const raw of [p.exif?.dateTimeOriginal, p.date]) {
        if (typeof raw !== "string") continue;
        const m = STAMP_RE.exec(raw.trim());
        if (!m) continue;
        const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
        if (!Number.isFinite(wall)) continue;
        const zone = m[7];
        if (zone) {
            if (zone === "Z") return wall;
            const z = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
            if (!z) continue;
            const off = (Number(z[2]) * 60 + Number(z[3])) * 60_000 * (z[1] === "-" ? -1 : 1);
            return wall - off;
        }
        const tz = timeZoneOfPhoto(p);
        return tz ? wallClockToInstant(wall, tz) : null;
    }
    return null;
}

const HOUR_MS = 3_600_000;

/**
 * 朝（日の出の前後1時間）か夜（日の入り〜翌日の日の出の1時間前）か。どちらでもなければ null。
 *
 * **その土地の暦日を決めなくてよいように**、撮った瞬間の UTC の日付の前後1日ずつの
 * 日の出・日の入りを見る（南中は経度で補正されるので、どこでも「その日の昼」を挟む）。
 * 朝の窓（出の1時間前〜1時間後）と夜の窓（入り〜次の出の1時間前）は重ならない。
 */
export function lightOf(p: Photo): "morning" | "night" | null {
    const c = coordsOf(p);
    if (!c) return null;
    const t = shotInstant(p);
    if (t === null) return null;
    const day0 = new Date(t);
    const days = [-2, -1, 0, 1].map((k) => {
        const d = new Date(Date.UTC(day0.getUTCFullYear(), day0.getUTCMonth(), day0.getUTCDate() + k));
        return sunriseSunset(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), c.lat, c.lng);
    });
    for (let i = 0; i < days.length; i++) {
        const s = days[i];
        if (s && Math.abs(t - s.rise) <= HOUR_MS) return "morning";
    }
    for (let i = 0; i + 1 < days.length; i++) {
        const today = days[i], next = days[i + 1];
        if (today && next && t >= today.set && t < next.rise - HOUR_MS) return "night";
    }
    return null;
}

// ─── 旅の一冊（iOS の TripBook.groupTrips と同じ規則） ─────────

/** 1冊になる最少の枚数（iOS `TripBook.minPhotos`） */
export const BOOK_MIN_PHOTOS = 2;
/** 撮影日の幅の上限（日・iOS `LibraryTrips.maxDays`） */
export const BOOK_MAX_DAYS = 30;

/** 撮影日（`date` の先頭10字が実在する日）。投稿日では代用しない（iOS `hasTakenDay`） */
function takenDayMs(p: Photo): number | null {
    if (typeof p.date !== "string") return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(p.date.trim());
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const t = Date.UTC(y, mo - 1, d);
    const back = new Date(t);
    return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t : null;
}

/**
 * 旅の一冊の冊数。**iOS の `TripBook.groupTrips` の規則**:
 * `groupId` が `trip-` で始まる束（旅の写真の流れで上げたもの）・撮影日のある写真が2枚以上・
 * 撮影日の幅が30日以内。日付だけで分けた一冊（束でない写真）は数えない
 * ——それは画面の並べ方で、本人が「旅として上げた」ものではないため。
 * iOS は本人の棚に非公開の写真も入れるが、ここは公開している写真だけで数える。
 */
export function countBooks(photos: Photo[]): number {
    const buckets = new Map<string, number[]>();
    for (const p of photos) {
        const g = typeof p.groupId === "string" ? p.groupId.trim() : "";
        if (!g.startsWith("trip-")) continue;
        const day = takenDayMs(p);
        if (day === null) continue;
        const list = buckets.get(g) ?? [];
        list.push(day);
        buckets.set(g, list);
    }
    let books = 0;
    for (const days of buckets.values()) {
        if (days.length < BOOK_MIN_PHOTOS) continue;
        if (Math.max(...days) - Math.min(...days) <= BOOK_MAX_DAYS * DAY_MS) books++;
    }
    return books;
}

// ─── まとめ ─────────────────────────────────────────────────

/** 数えてよい写真（公開・ストーリーでない・実体がある） */
export function isCountablePhoto(p: Photo): boolean {
    return !!p && typeof p.src === "string" && p.src !== "" && p.published !== false && (p as { story?: unknown }).story !== true;
}

/** 「行きたい」に入れたスポットのうち、写真を撮ったものの数 */
export function countWish(photos: Photo[], wishKeys: readonly string[]): number {
    const shot = new Set(photos.map((p) => p.spotId).filter((x): x is string => typeof x === "string"));
    const wanted = new Set<string>();
    for (const k of wishKeys) {
        if (typeof k !== "string" || !k.startsWith(SPOT_KEY_PREFIX)) continue;
        const id = SPOT_ID_BY_SLUG.get(k.slice(SPOT_KEY_PREFIX.length));
        if (id) wanted.add(id);
    }
    let n = 0;
    for (const id of wanted) if (shot.has(id)) n++;
    return n;
}

export type BadgeCounts = Record<CountedBadgeKey, number>;

export function countBadges(allPhotos: Photo[], wishKeys: readonly string[]): BadgeCounts {
    const photos = allPhotos.filter(isCountablePhoto);
    const prefs = new Set<number>();
    const countries = new Set<string>();
    const seasonsByYear = new Map<number, Set<number>>();
    let morning = 0, night = 0;
    for (const p of photos) {
        const pref = prefectureOfPhoto(p);
        if (pref !== null) prefs.add(pref);
        const country = countryOfText(p.location);
        if (country) countries.add(country);
        const ym = yearMonthOf(p);
        if (ym) {
            const c = coordsOf(p);
            const set = seasonsByYear.get(ym.y) ?? new Set<number>();
            set.add(seasonOf(ym.m, !!c && c.lat < 0));
            seasonsByYear.set(ym.y, set);
        }
        const light = lightOf(p);
        if (light === "morning") morning++;
        else if (light === "night") night++;
    }
    let fullYears = 0;
    for (const s of seasonsByYear.values()) if (s.size === 4) fullYears++;
    return {
        first: photos.length,
        prefectures: prefs.size,
        countries: countries.size,
        seasons: fullYears,
        morning,
        night,
        books: countBooks(photos),
        wish: countWish(photos, wishKeys),
    };
}

export type BadgeProgress = Record<BadgeKey, { count: number; tier: number; next: number | null }>;

/**
 * 進み具合。`tier` は**持っている段**（保存済みと今の数の高い方——段は下げない）、
 * `next` は持っている段の次の線（最上段なら null）。`earlyUser` は数えないので
 * 持っていれば count 1・無ければ 0、`next` は常に null。
 */
export function badgeProgress(counts: BadgeCounts, badges: BadgeMap | undefined): BadgeProgress {
    const out = {} as BadgeProgress;
    for (const key of COUNTED_BADGE_KEYS) {
        const count = counts[key];
        const tier = Math.max(tierFor(key, count), badges?.[key]?.tier ?? 0);
        // 次の線は**持っている段の次**。今の数で決めると、写真を消して数が減った人に、
        // もう持っている段までの数（「あと5で次」）が出ていた
        out[key] = { count, tier, next: BADGE_THRESHOLDS[key][tier] ?? null };
    }
    const early = badges?.earlyUser?.tier ?? 0;
    out.earlyUser = { count: early > 0 ? 1 : 0, tier: early, next: null };
    return out;
}

/**
 * 保存済みのメダルに今の数を重ねる。
 *
 * - **段は下げない**（写真を消しても、一度手に入れたメダルは残る）
 * - 上がった段だけ `at` を今にする（その段を初めて取った日）。変わらない段の `at` は触らない
 * - 数えないメダル（`earlyUser`）と知らない形は `sanitizeBadges` の扱いに従う
 *
 * @returns 重ねたあとの `badges` と、上がったもの（通知に使う）
 */
export function mergeBadges(stored: unknown, counts: BadgeCounts, nowIso: string): {
    badges: BadgeMap;
    upgraded: { key: CountedBadgeKey; tier: number }[];
} {
    const badges: BadgeMap = { ...(sanitizeBadges(stored) ?? {}) };
    const upgraded: { key: CountedBadgeKey; tier: number }[] = [];
    for (const key of COUNTED_BADGE_KEYS) {
        const tier = Math.min(tierFor(key, counts[key]), MAX_TIER[key]);
        const prev = badges[key]?.tier ?? 0;
        if (tier > prev) {
            badges[key] = { tier, at: nowIso };
            upgraded.push({ key, tier });
        }
    }
    return { badges, upgraded };
}
