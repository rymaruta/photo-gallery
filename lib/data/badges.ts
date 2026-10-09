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
//
// ## 名前の横に置く大きさ（素材の README・明朝 26px の名前で円を 22px にそろえる）
//
//   無料のメダル  円は絵の 98.4% → 22.4px
//   初期ユーザー  円は絵の 71.5%（後光の余白）→ 30.8px で置き、上下左右に −4.4px はみ出させる
//                 （行の高さを変えない）
//   Pro の印      名前の字の 0.835 倍（公式の封印 `VerifiedBadge` と同じ大きさ）
//
// **Web では何も売らない。** Pro の印は「立っている人に出す」だけ。

export const BADGE_KEYS = [
    "first", "prefectures", "countries", "seasons", "morning", "night", "books", "wish", "earlyUser",
] as const;
export type BadgeKey = (typeof BADGE_KEYS)[number];

export type BadgeEntry = { tier: number; at: string };
export type BadgeMap = Partial<Record<BadgeKey, BadgeEntry>>;
export type ProMarkStyle = "iris" | "plate";

export function isBadgeKey(v: unknown): v is BadgeKey {
    return typeof v === "string" && (BADGE_KEYS as readonly string[]).includes(v);
}

/** 段の上限（`first`・`earlyUser` は1段だけ） */
export const BADGE_MAX_TIER: Record<BadgeKey, number> = {
    first: 1, prefectures: 3, countries: 3, seasons: 3, morning: 3, night: 3, books: 3, wish: 3, earlyUser: 1,
};

/** メダルの名前。日本語はサーバーの通知の文面（`badgeKeys.ts` の BADGE_NAME_JA）と同じ */
export const BADGE_NAMES: Record<BadgeKey, { ja: string; en: string }> = {
    first: { ja: "はじめての一枚", en: "First photo" },
    prefectures: { ja: "都道府県", en: "Prefectures" },
    countries: { ja: "国と地域", en: "Countries" },
    seasons: { ja: "四季", en: "Four seasons" },
    morning: { ja: "朝の光", en: "Morning light" },
    night: { ja: "ブルーアワー", en: "Blue hour" },
    books: { ja: "旅の本", en: "Travel books" },
    wish: { ja: "行きたいをかなえた", en: "Wish fulfilled" },
    earlyUser: { ja: "初期ユーザー", en: "Early member" },
};

/** 段の呼び名（1 銅・2 銀・3 白金） */
export const TIER_NAMES: Record<number, { ja: string; en: string }> = {
    1: { ja: "銅", en: "Bronze" },
    2: { ja: "銀", en: "Silver" },
    3: { ja: "白金", en: "Platinum" },
};

/** 段の中身（一覧の説明に出す）。サーバーの BADGE_THRESHOLDS と同じ線 */
const BADGE_RULES: Record<Exclude<BadgeKey, "earlyUser" | "first">, { lines: [number, number, number]; ja: string; en: string }> = {
    prefectures: { lines: [10, 30, 47], ja: "{n}の都道府県で撮った", en: "Photos in {n} prefectures" },
    countries: { lines: [3, 10, 30], ja: "{n}の国・地域で撮った", en: "Photos in {n} countries" },
    seasons: { lines: [1, 2, 3], ja: "春夏秋冬を撮った年が{n}年", en: "All four seasons in {n} year(s)" },
    morning: { lines: [10, 50, 200], ja: "日の出の前後に{n}枚", en: "{n} photos around sunrise" },
    night: { lines: [10, 50, 200], ja: "日の入りのあとに{n}枚", en: "{n} photos after sunset" },
    books: { lines: [3, 10, 30], ja: "旅の本が{n}冊", en: "{n} travel books" },
    wish: { lines: [3, 10, 30], ja: "行きたい場所{n}か所で撮った", en: "Photographed {n} wishlist spots" },
};

/** そのメダル・その段の説明（「10の都道府県で撮った」） */
export function badgeDescription(key: BadgeKey, tier: number, locale: "ja" | "en"): string {
    if (key === "first") return locale === "en" ? "Posted a first photo" : "はじめて写真を載せた";
    if (key === "earlyUser") return locale === "en" ? "Joined by Oct 31, 2026" : "2026年10月31日までに登録した";
    const rule = BADGE_RULES[key];
    const n = rule.lines[Math.min(Math.max(tier, 1), 3) - 1];
    return (locale === "en" ? rule.en : rule.ja).replace("{n}", String(n));
}

/** 段つきの名前（1段だけのメダルは段を書かない）。例: 「朝の光（銀）」/「Morning light · Silver」 */
export function badgeLabel(key: BadgeKey, tier: number, locale: "ja" | "en"): string {
    const name = BADGE_NAMES[key][locale];
    const t = BADGE_MAX_TIER[key] > 1 ? TIER_NAMES[tier]?.[locale] : undefined;
    if (!t) return name;
    return locale === "en" ? `${name} · ${t}` : `${name}（${t}）`;
}

/** 絵の置き場。`small` は名前の横（96px）、そうでなければ一覧（240px） */
export function badgeImage(key: BadgeKey, tier: number, small: boolean): string {
    const base = key === "earlyUser" ? "medal-earlyUser" : `medal-${key}-${Math.min(Math.max(tier, 1), BADGE_MAX_TIER[key])}`;
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
    return key === "earlyUser" ? { size: 30.8, margin: -4.4 } : { size: 22.4, margin: 0 };
}

/**
 * 応答の `badges` を、描いてよい形だけにする（知らない鍵・段の外・日付の無いものは落とす）。
 * サーバーの `sanitizeBadges` と同じ規則。1つも残らなければ undefined
 */
export function sanitizeBadgeMap(raw: unknown): BadgeMap | undefined {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const out: BadgeMap = {};
    for (const key of BADGE_KEYS) {
        const v = (raw as Record<string, unknown>)[key];
        if (!v || typeof v !== "object") continue;
        const tier = (v as { tier?: unknown }).tier;
        const at = (v as { at?: unknown }).at;
        if (typeof tier !== "number" || !Number.isInteger(tier) || tier < 1 || tier > BADGE_MAX_TIER[key]) continue;
        if (typeof at !== "string" || Number.isNaN(Date.parse(at))) continue;
        out[key] = { tier, at };
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

/** 持っているメダルを、表の順に並べる */
export function ownedBadges(badges: BadgeMap | undefined): { key: BadgeKey; tier: number; at: string }[] {
    if (!badges) return [];
    return BADGE_KEYS.flatMap((key) => {
        const b = badges[key];
        return b ? [{ key, tier: b.tier, at: b.at }] : [];
    });
}
