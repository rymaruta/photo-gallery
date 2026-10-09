/**
 * メダル（ユーザーバッジ）の**鍵と形**。数え方は `badges.ts`、保存と通知は `badgeStore.ts`。
 *
 * ここを分けてあるのは、公開プロフィール（`userProfile.ts`・未認証で叩かれる口）に
 * 台帳の写し（`data/badgeLedger.json`・約170KB）を引き込まないため。
 * プロフィールが要るのは「形を整える」ことだけ。
 *
 * ## 形（iOS と同時に作っている・崩さない）
 *
 *     badges:       { [鍵]: { tier: number, at: string(ISO) } }   無ければ項目ごと出さない
 *     displayBadge: 鍵 | null                                     持っている鍵だけ
 *     pro:          boolean                                      `supporter.active === true` のときだけ true
 *     proMarkStyle: "iris" | "plate"                             既定 "iris"
 *
 * **`badges` は本人から書けない**（`verified` と同じ）。書くのはサーバーの数え直し
 * （`badgeStore.ts`）と運営の台本（`scripts/grant-early-user.js`）だけ。
 */

/** 数えて渡すメダル（この順で画面に並べる） */
export const COUNTED_BADGE_KEYS = [
    "first", "prefectures", "countries", "seasons", "morning", "night", "books", "wish",
] as const;
export type CountedBadgeKey = (typeof COUNTED_BADGE_KEYS)[number];

/** 全部の鍵。`earlyUser` は台本だけが付ける（数えない） */
export const BADGE_KEYS = [...COUNTED_BADGE_KEYS, "earlyUser"] as const;
export type BadgeKey = (typeof BADGE_KEYS)[number];

/** 鍵ごとの段の上限（`first`・`earlyUser` は1段だけ） */
export const MAX_TIER: Record<BadgeKey, number> = {
    first: 1, prefectures: 3, countries: 3, seasons: 3, morning: 3, night: 3, books: 3, wish: 3, earlyUser: 1,
};

export type BadgeEntry = { tier: number; at: string };
export type BadgeMap = Partial<Record<BadgeKey, BadgeEntry>>;

export const PRO_MARK_STYLES = ["iris", "plate"] as const;
export type ProMarkStyle = (typeof PRO_MARK_STYLES)[number];
export const DEFAULT_PRO_MARK_STYLE: ProMarkStyle = "iris";

export function isBadgeKey(v: unknown): v is BadgeKey {
    return typeof v === "string" && (BADGE_KEYS as readonly string[]).includes(v);
}

export function isProMarkStyle(v: unknown): v is ProMarkStyle {
    return typeof v === "string" && (PRO_MARK_STYLES as readonly string[]).includes(v);
}

/**
 * 保存されている `badges` を、**出してよい形だけ**にする。
 *
 * 知らない鍵・段が範囲の外・日付の無いものは落とす（行を直に書いた運営の書き損じで
 * 画面を壊さない）。1つも残らなければ `undefined`＝項目ごと出さない。
 */
export function sanitizeBadges(raw: unknown): BadgeMap | undefined {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const out: BadgeMap = {};
    for (const key of BADGE_KEYS) {
        const v = (raw as Record<string, unknown>)[key];
        if (!v || typeof v !== "object") continue;
        const tier = (v as { tier?: unknown }).tier;
        const at = (v as { at?: unknown }).at;
        if (typeof tier !== "number" || !Number.isInteger(tier) || tier < 1 || tier > MAX_TIER[key]) continue;
        if (typeof at !== "string" || Number.isNaN(Date.parse(at))) continue;
        out[key] = { tier, at };
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

/** その鍵を持っているか（段が1以上） */
export function ownsBadge(badges: unknown, key: unknown): key is BadgeKey {
    if (!isBadgeKey(key)) return false;
    return sanitizeBadges(badges)?.[key] !== undefined;
}

/** Pro か。**`supporter.active === true` だけ**（第2段階の購入まで誰も立たない） */
export function isPro(p: { supporter?: unknown } | null | undefined): boolean {
    const s = p?.supporter;
    return !!s && typeof s === "object" && (s as { active?: unknown }).active === true;
}

/**
 * プロフィールの応答に足す4項目。公開プロフィールと自分のプロフィールで**同じ関数**を通す
 * （片方だけ直して食い違わせない）。
 *
 * `displayBadge` は**持っている鍵のときだけ**返す。持っていない鍵（台本で外した・
 * 書き損じ）は `null`——画面が「無いメダル」を描かないように。
 */
export function badgeFields(p: { badges?: unknown; displayBadge?: unknown; supporter?: unknown; proMarkStyle?: unknown }): {
    badges?: BadgeMap;
    displayBadge: BadgeKey | null;
    pro: boolean;
    proMarkStyle: ProMarkStyle;
} {
    const badges = sanitizeBadges(p.badges);
    const display = isBadgeKey(p.displayBadge) && badges?.[p.displayBadge] ? p.displayBadge : null;
    return {
        ...(badges ? { badges } : {}),
        displayBadge: display,
        pro: isPro(p),
        proMarkStyle: isProMarkStyle(p.proMarkStyle) ? p.proMarkStyle : DEFAULT_PRO_MARK_STYLE,
    };
}

const TIER_JA = ["", "銅", "銀", "白金"];

/** メダルの名前（日本語）。**デザインの板で決まっている表記**。通知の文面（「<名前>のメダルを手に入れました」）に使う */
export const BADGE_NAME_JA: Record<BadgeKey, string> = {
    first: "最初の一枚",
    prefectures: "都道府県",
    countries: "国・地域",
    seasons: "四季",
    morning: "朝の光",
    night: "夜の光",
    books: "旅の一冊",
    wish: "行けた場所",
    earlyUser: "初期ユーザー",
};

/** 段つきの名前（1段だけのメダルは段を書かない）。例: 「朝の光（銀）」 */
export function badgeDisplayNameJa(key: BadgeKey, tier: number): string {
    const base = BADGE_NAME_JA[key];
    return MAX_TIER[key] > 1 && TIER_JA[tier] ? `${base}（${TIER_JA[tier]}）` : base;
}
