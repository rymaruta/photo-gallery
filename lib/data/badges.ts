// lib/data/badges.ts
//
// **メダル（ユーザーバッジ）の画面側の表。** 鍵・名前・絵の置き場・大きさを1か所に持つ。
//
// 数えるのはサーバー（`api-user/src/badges.ts`）で、画面は**受け取った形を描くだけ**。
// 鍵の一覧はサーバーの `api-user/src/badgeKeys.ts` の `BADGE_KEYS` と同じ並び
// （`lib/data/__tests__/badges.test.ts` が突き合わせる）。
//
// ## 絵（`public/badges/`）
//
// 素材は 3x の PNG（大 780px・小 192px）。リポジトリを軽く保つため WebP に縮めて置いた
// （透明は残す）:
//
//   medal-<鍵>-<段>.webp     240px  一覧（約72px で描く）
//   medal-<鍵>-<段>-s.webp    96px  名前の横（約22〜31px で描く）
//   medal-earlyUser(.webp / -s.webp)
//   pro-mark-<iris|plate>(-small).svg  Pro の印（15px 未満は -small）
//   medal-supporter(.webp / -s.webp)    サポーター章（Pro）
//   medal-year-<1|2|3>(.webp / -s.webp) 続けた年のメダル（1年目・2年目・3年目）
//   medal-pro-<季節>-<年>(.webp / -s.webp)  季節の章（Pro 限定）。**表に年が刻んである**ので
//                                         年ごとに別の絵（`PRO_SEASON_ART`）。絵の無い年は描かない
//
// ## 名前の横に置く大きさ（素材の README・明朝 26px の名前で円を 22px にそろえる）
//
//   無料のメダル  円は絵の 98.4% → 22.4px
//   初期ユーザー  円は絵の 71.5%（後光の余白）→ 30.8px で置き、上下左右に −4.4px はみ出させる
//                 （行の高さを変えない）
//   Pro の印      名前の字の 0.835 倍（公式の封印 `VerifiedBadge` と同じ大きさ）
//   サポーター章・続けた年  円は絵の 98.5%（無料のメダルと同じ）→ 22.4px
//   季節の章      円は絵の 91% → 24.2px で置き、上下左右に −0.9px はみ出させる
//
// **Web では何も売らない。** Pro の印・Pro のメダルは「持っている人に出す」だけ。
//
// ## 季節の章の鍵（サーバーの `badgeKeys.ts` と同じ）
//
// `pro<Spring|Summer|Autumn|Winter><西暦4桁>`（例 `proAutumn2026`）。年ごとに別のメダル。
// **冬は12月の年**（`proWinter2026` は 2026年12月〜2027年2月）。

/** 決まった鍵（季節の章は年ごとの鍵なのでここには並ばない） */
export const BADGE_KEYS = [
    "first", "prefectures", "countries", "seasons", "morning", "night", "books", "wish", "earlyUser",
    "supporter", "supporterYear",
] as const;
export type FixedBadgeKey = (typeof BADGE_KEYS)[number];

export const PRO_SEASONS = ["Spring", "Summer", "Autumn", "Winter"] as const;
export type ProSeason = (typeof PRO_SEASONS)[number];
export type ProSeasonKey = `pro${ProSeason}${number}`;
/** 鍵（決まった鍵 ＋ 季節の章） */
export type BadgeKey = FixedBadgeKey | ProSeasonKey;

/** `year` は季節の章だけ */
export type BadgeEntry = { tier: number; at: string; year?: number };
export type BadgeMap = Partial<Record<BadgeKey, BadgeEntry>>;
export type ProMarkStyle = "iris" | "plate";

/** 季節の章の鍵を読む（サーバーの `parseProSeasonKey` と同じ規則）。違えば null */
export function parseProSeasonKey(v: unknown): { season: ProSeason; year: number } | null {
    if (typeof v !== "string") return null;
    const m = /^pro(Spring|Summer|Autumn|Winter)(\d{4})$/.exec(v);
    if (!m) return null;
    const year = Number(m[2]);
    return year >= 2026 && year <= 2999 ? { season: m[1] as ProSeason, year } : null;
}

export function isBadgeKey(v: unknown): v is BadgeKey {
    return typeof v === "string" && ((BADGE_KEYS as readonly string[]).includes(v) || parseProSeasonKey(v) !== null);
}

/** 段の上限（`first`・`earlyUser`・`supporter` は1段だけ。季節の章も1段） */
export const BADGE_MAX_TIER: Record<FixedBadgeKey, number> = {
    first: 1, prefectures: 3, countries: 3, seasons: 3, morning: 3, night: 3, books: 3, wish: 3, earlyUser: 1,
    supporter: 1, supporterYear: 3,
};

function maxTierOf(key: BadgeKey): number {
    return parseProSeasonKey(key) ? 1 : BADGE_MAX_TIER[key as FixedBadgeKey];
}

/**
 * 季節の章の絵がある年（素材の `pro/`）。表に年が刻んであるので、**無い年の絵は描かない**
 * （別の年の絵で代わりにすると、違う年が刻まれたメダルが出る）。足すときは絵と一緒にここへ
 */
export const PRO_SEASON_ART: Record<ProSeason, readonly number[]> = {
    Spring: [2027],
    Summer: [2027],
    Autumn: [2026],
    Winter: [2026],
};

/** メダルの名前。日本語はサーバーの通知の文面（`badgeKeys.ts` の BADGE_NAME_JA）と同じ */
export const BADGE_NAMES: Record<FixedBadgeKey, { ja: string; en: string }> = {
    first: { ja: "はじめての一枚", en: "First photo" },
    prefectures: { ja: "都道府県", en: "Prefectures" },
    countries: { ja: "国と地域", en: "Countries" },
    seasons: { ja: "四季", en: "Four seasons" },
    morning: { ja: "朝の光", en: "Morning light" },
    night: { ja: "ブルーアワー", en: "Blue hour" },
    books: { ja: "旅の本", en: "Travel books" },
    wish: { ja: "行きたいをかなえた", en: "Wish fulfilled" },
    earlyUser: { ja: "初期ユーザー", en: "Early member" },
    supporter: { ja: "サポーター章", en: "Supporter" },
    supporterYear: { ja: "続けた年", en: "Years of support" },
};

const SEASON_NAMES: Record<ProSeason, { ja: string; en: string; months: string }> = {
    Spring: { ja: "春", en: "Spring", months: "3〜5月" },
    Summer: { ja: "夏", en: "Summer", months: "6〜8月" },
    Autumn: { ja: "秋", en: "Autumn", months: "9〜11月" },
    Winter: { ja: "冬", en: "Winter", months: "12〜2月" },
};

/** 段の呼び名（1 銅・2 銀・3 白金） */
export const TIER_NAMES: Record<number, { ja: string; en: string }> = {
    1: { ja: "銅", en: "Bronze" },
    2: { ja: "銀", en: "Silver" },
    3: { ja: "白金", en: "Platinum" },
};

/** 段の中身（一覧の説明に出す）。サーバーの BADGE_THRESHOLDS と同じ線 */
const BADGE_RULES: Record<Exclude<FixedBadgeKey, "earlyUser" | "first" | "supporter">, { lines: [number, number, number]; ja: string; en: string }> = {
    prefectures: { lines: [10, 30, 47], ja: "{n}の都道府県で撮った", en: "Photos in {n} prefectures" },
    countries: { lines: [3, 10, 30], ja: "{n}の国・地域で撮った", en: "Photos in {n} countries" },
    seasons: { lines: [1, 2, 3], ja: "春夏秋冬を撮った年が{n}年", en: "All four seasons in {n} year(s)" },
    morning: { lines: [10, 50, 200], ja: "日の出の前後に{n}枚", en: "{n} photos around sunrise" },
    night: { lines: [10, 50, 200], ja: "日の入りのあとに{n}枚", en: "{n} photos after sunset" },
    books: { lines: [3, 10, 30], ja: "旅の本が{n}冊", en: "{n} travel books" },
    wish: { lines: [3, 10, 30], ja: "行きたい場所{n}か所で撮った", en: "Photographed {n} wishlist spots" },
    // サーバーの SUPPORTER_YEAR_THRESHOLDS と同じ線（月数）
    supporterYear: { lines: [12, 24, 36], ja: "Pro を通算{n}か月続けた", en: "Pro for {n} months in total" },
};

/** 続けた年の段の呼び名 */
const YEAR_TIER_NAMES: Record<number, { ja: string; en: string }> = {
    1: { ja: "1年目", en: "Year 1" },
    2: { ja: "2年目", en: "Year 2" },
    3: { ja: "3年目", en: "Year 3" },
};

/** そのメダル・その段の説明（「10の都道府県で撮った」） */
export function badgeDescription(key: BadgeKey, tier: number, locale: "ja" | "en"): string {
    const season = parseProSeasonKey(key);
    if (season) {
        const n = SEASON_NAMES[season.season];
        return locale === "en"
            ? `Was Pro in ${n.en.toLowerCase()} ${season.year}`
            : `${season.year}年の${n.ja}（${n.months}）を Pro で過ごした`;
    }
    if (key === "first") return locale === "en" ? "Posted a first photo" : "はじめて写真を載せた";
    if (key === "earlyUser") return locale === "en" ? "Joined by Oct 31, 2026" : "2026年10月31日までに登録した";
    if (key === "supporter") return locale === "en" ? "Supports Journey Photo with Pro" : "Journey Photo Pro のサポーター";
    const rule = BADGE_RULES[key as Exclude<FixedBadgeKey, "earlyUser" | "first" | "supporter">];
    const n = rule.lines[Math.min(Math.max(tier, 1), 3) - 1];
    return (locale === "en" ? rule.en : rule.ja).replace("{n}", String(n));
}

/** 段つきの名前（1段だけのメダルは段を書かない）。例: 「朝の光（銀）」/「Morning light · Silver」 */
export function badgeLabel(key: BadgeKey, tier: number, locale: "ja" | "en"): string {
    const season = parseProSeasonKey(key);
    if (season) {
        const n = SEASON_NAMES[season.season];
        return locale === "en" ? `${n.en} · ${season.year}` : `${n.ja}の章（${season.year}）`;
    }
    const fixed = key as FixedBadgeKey;
    const name = BADGE_NAMES[fixed][locale];
    const t = fixed === "supporterYear"
        ? YEAR_TIER_NAMES[tier]?.[locale]
        : BADGE_MAX_TIER[fixed] > 1 ? TIER_NAMES[tier]?.[locale] : undefined;
    if (!t) return name;
    return locale === "en" ? `${name} · ${t}` : `${name}（${t}）`;
}

/**
 * 絵の置き場。`small` は名前の横（96px）、そうでなければ一覧（240px）。
 * **季節の章で絵の無い年は null**（描かない。`PRO_SEASON_ART`）
 */
export function badgeImage(key: BadgeKey, tier: number, small: boolean): string | null {
    const season = parseProSeasonKey(key);
    let base: string;
    if (season) {
        if (!PRO_SEASON_ART[season.season].includes(season.year)) return null;
        base = `medal-pro-${season.season.toLowerCase()}-${season.year}`;
    } else if (key === "earlyUser") {
        base = "medal-earlyUser";
    } else if (key === "supporter") {
        base = "medal-supporter";
    } else if (key === "supporterYear") {
        base = `medal-year-${Math.min(Math.max(tier, 1), 3)}`;
    } else {
        base = `medal-${key}-${Math.min(Math.max(tier, 1), BADGE_MAX_TIER[key as FixedBadgeKey])}`;
    }
    return `/badges/${base}${small ? "-s" : ""}.webp`;
}

/** Pro の印の絵（15px 未満は線を太くした -small） */
export function proMarkImage(style: ProMarkStyle, sizePx: number): string {
    return `/badges/pro-mark-${style}${sizePx < 15 ? "-small" : ""}.svg`;
}

/**
 * 名前の横に置くときの大きさ（px）と、はみ出させる量。
 * 公式の封印（円 22px）にそろえる。初期ユーザー章は後光ぶん大きく描いて、行の高さを変えない
 */
export function nameBadgeBox(key: BadgeKey): { size: number; margin: number } {
    if (key === "earlyUser") return { size: 30.8, margin: -4.4 };
    // 季節の章は円が絵の 91%（素材の README）。円を 22px にそろえて、はみ出しで行の高さを保つ
    if (parseProSeasonKey(key)) return { size: 24.2, margin: -0.9 };
    return { size: 22.4, margin: 0 };
}

/**
 * 応答の `badges` を、描いてよい形だけにする（知らない鍵・段の外・日付の無いものは落とす）。
 * サーバーの `sanitizeBadges` と同じ規則。1つも残らなければ undefined
 */
export function sanitizeBadgeMap(raw: unknown): BadgeMap | undefined {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const out: BadgeMap = {};
    const take = (key: BadgeKey) => {
        const v = (raw as Record<string, unknown>)[key];
        if (!v || typeof v !== "object") return;
        const tier = (v as { tier?: unknown }).tier;
        const at = (v as { at?: unknown }).at;
        if (typeof tier !== "number" || !Number.isInteger(tier) || tier < 1 || tier > maxTierOf(key)) return;
        if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return;
        const season = parseProSeasonKey(key);
        out[key] = season ? { tier, at, year: season.year } : { tier, at };
    };
    for (const key of BADGE_KEYS) take(key);
    for (const key of seasonKeysInOrder(Object.keys(raw))) take(key);
    return Object.keys(out).length > 0 ? out : undefined;
}

/** 季節の章の鍵だけを、年 → 春夏秋冬の順に（冬は12月の年なので、これが時間の順） */
function seasonKeysInOrder(keys: string[]): ProSeasonKey[] {
    return keys
        .map((k) => ({ k, s: parseProSeasonKey(k) }))
        .filter((x): x is { k: string; s: { season: ProSeason; year: number } } => x.s !== null)
        .sort((a, b) => a.s.year - b.s.year || PRO_SEASONS.indexOf(a.s.season) - PRO_SEASONS.indexOf(b.s.season))
        .map((x) => x.k as ProSeasonKey);
}

/** 持っているメダルを、表の順（決まった鍵 → 季節の章を古い順）に並べる */
export function ownedBadges(badges: BadgeMap | undefined): { key: BadgeKey; tier: number; at: string }[] {
    if (!badges) return [];
    return [...BADGE_KEYS, ...seasonKeysInOrder(Object.keys(badges))].flatMap((key) => {
        const b = badges[key];
        return b ? [{ key, tier: b.tier, at: b.at }] : [];
    });
}
