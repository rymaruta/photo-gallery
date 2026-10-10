/**
 * メダル（ユーザーバッジ）の**鍵と形**。数え方は `badges.ts`、保存と通知は `badgeStore.ts`。
 *
 * ここを分けてあるのは、公開プロフィール（`userProfile.ts`・未認証で叩かれる口）に
 * 台帳の写し（`data/badgeLedger.json`・約170KB）を引き込まないため。
 * プロフィールが要るのは「形を整える」ことだけ。
 *
 * ## 形（iOS と同時に作っている・崩さない）
 *
 *     badges:       { [鍵]: { tier: number, at: string(ISO), year?: number } }   無ければ項目ごと出さない
 *     displayBadge: 鍵 | null                                     持っている鍵だけ
 *     pro:          boolean                                      Pro が今有効なときだけ true（`isPro`）
 *     proMarkStyle: "iris" | "plate"                             既定 "iris"
 *     supporter:    { number, since, months }                    サポーター番号を持つ人だけ（`supporter.ts`）
 *                   本人の応答だけ、本番に来た Sandbox の記録も `sandbox: true`・`months: 0` を付けて載せる
 *                   （`{ number, since, months, sandbox?: true }`。`publicSupporter` の `owner`）
 *
 * ## 鍵の種類（第2段階で Pro の鍵を足した）
 *
 * - 決まった鍵（`BADGE_KEYS`）: 数えるメダル8つ・`earlyUser`・`supporter`（サポーター章）・
 *   `supporterYear`（続けた年のメダル。段 1/2/3 ＝ 1年目/2年目/3年目）
 * - **季節の章は年ごとの鍵**: `pro<Spring|Summer|Autumn|Winter><西暦4桁>`（例 `proAutumn2026`）。
 *   中身は `{ tier: 1, at, year }`。2026年の秋と2027年の秋は別の鍵＝別のメダル。
 *   **冬は12月の年**（`proWinter2026` は 2026年12月〜2027年2月）。月は日本時間で見る
 *
 * **`badges` は本人から書けない**（`verified` と同じ）。書くのはサーバーの数え直し
 * （`badgeStore.ts`）と運営の台本（`scripts/grant-early-user.js`）だけ。
 */

import { isPrivateSandbox, supporterMonths } from "./supporter";

/** 数えて渡すメダル（この順で画面に並べる） */
export const COUNTED_BADGE_KEYS = [
    "first", "prefectures", "countries", "seasons", "morning", "night", "books", "wish",
] as const;
export type CountedBadgeKey = (typeof COUNTED_BADGE_KEYS)[number];

/** Pro が付けるメダル（`proBadges.ts`）。季節の章は年ごとの鍵なのでここには並ばない */
export const PRO_BADGE_KEYS = ["supporter", "supporterYear"] as const;
export type ProBadgeKey = (typeof PRO_BADGE_KEYS)[number];

/** 決まった鍵の全部。`earlyUser` は台本だけが付ける（数えない） */
export const BADGE_KEYS = [...COUNTED_BADGE_KEYS, "earlyUser", ...PRO_BADGE_KEYS] as const;
export type FixedBadgeKey = (typeof BADGE_KEYS)[number];

/** 季節の章（Pro 限定）。この順で並べる */
export const PRO_SEASONS = ["Spring", "Summer", "Autumn", "Winter"] as const;
export type ProSeason = (typeof PRO_SEASONS)[number];
/** 季節の章の鍵（例 `proAutumn2026`） */
export type ProSeasonKey = `pro${ProSeason}${number}`;

/** 鍵（決まった鍵 ＋ 季節の章） */
export type BadgeKey = FixedBadgeKey | ProSeasonKey;

/** 鍵ごとの段の上限（`first`・`earlyUser`・`supporter` は1段だけ。季節の章も1段） */
export const MAX_TIER: Record<FixedBadgeKey, number> = {
    first: 1, prefectures: 3, countries: 3, seasons: 3, morning: 3, night: 3, books: 3, wish: 3, earlyUser: 1,
    supporter: 1, supporterYear: 3,
};

/** `year` は季節の章だけ（その章の年） */
export type BadgeEntry = { tier: number; at: string; year?: number };
export type BadgeMap = Partial<Record<BadgeKey, BadgeEntry>>;

const PRO_SEASON_RE = /^pro(Spring|Summer|Autumn|Winter)(\d{4})$/;

/** 季節の章の鍵を読む。違えば null。年は 2026（Pro を始めた年）〜2999 */
export function parseProSeasonKey(v: unknown): { season: ProSeason; year: number } | null {
    if (typeof v !== "string") return null;
    const m = PRO_SEASON_RE.exec(v);
    if (!m) return null;
    const year = Number(m[2]);
    if (year < 2026 || year > 2999) return null;
    return { season: m[1] as ProSeason, year };
}

export function proSeasonKey(season: ProSeason, year: number): ProSeasonKey {
    return `pro${season}${year}` as ProSeasonKey;
}

/** その鍵の段の上限 */
export function maxTierOf(key: BadgeKey): number {
    return parseProSeasonKey(key) ? 1 : MAX_TIER[key as FixedBadgeKey];
}

export const PRO_MARK_STYLES = ["iris", "plate"] as const;
export type ProMarkStyle = (typeof PRO_MARK_STYLES)[number];
export const DEFAULT_PRO_MARK_STYLE: ProMarkStyle = "iris";

/** 鍵か（決まった鍵か、季節の章の鍵） */
export function isBadgeKey(v: unknown): v is BadgeKey {
    return typeof v === "string" && ((BADGE_KEYS as readonly string[]).includes(v) || parseProSeasonKey(v) !== null);
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
    const take = (key: BadgeKey) => {
        const v = (raw as Record<string, unknown>)[key];
        if (!v || typeof v !== "object") return;
        const tier = (v as { tier?: unknown }).tier;
        const at = (v as { at?: unknown }).at;
        if (typeof tier !== "number" || !Number.isInteger(tier) || tier < 1 || tier > maxTierOf(key)) return;
        if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return;
        const season = parseProSeasonKey(key);
        // 季節の章は年を必ず載せる（鍵の年。行に書かれた値は信じない）
        out[key] = season ? { tier, at, year: season.year } : { tier, at };
    };
    for (const key of BADGE_KEYS) take(key);
    // 季節の章は年 → 春夏秋冬の順（**冬は12月の年**なので、この順が時間の順）
    const seasonKeys = Object.keys(raw)
        .map((k) => ({ k, s: parseProSeasonKey(k) }))
        .filter((x): x is { k: string; s: { season: ProSeason; year: number } } => x.s !== null)
        .sort((a, b) => a.s.year - b.s.year || PRO_SEASONS.indexOf(a.s.season) - PRO_SEASONS.indexOf(b.s.season));
    for (const { k } of seasonKeys) take(k as ProSeasonKey);
    return Object.keys(out).length > 0 ? out : undefined;
}

/** その鍵を持っているか（段が1以上） */
export function ownsBadge(badges: unknown, key: unknown): key is BadgeKey {
    if (!isBadgeKey(key)) return false;
    return sanitizeBadges(badges)?.[key] !== undefined;
}

/**
 * Pro か。**`supporter.active === true`** で、期限（`expiresAt`）があれば**まだ来ていない**こと。
 *
 * 期限も見るのは、Apple の「切れました」の知らせ（EXPIRED）が届かなかったときに
 * Pro の印が出続けないようにするため（猶予期間は `expiresAt` に含めて保存してある）。
 */
export function isPro(p: { supporter?: unknown } | null | undefined, now: number = Date.now()): boolean {
    const s = p?.supporter;
    if (!s || typeof s !== "object" || (s as { active?: unknown }).active !== true) return false;
    const exp = (s as { expiresAt?: unknown }).expiresAt;
    if (exp === undefined || exp === null) return true;
    const t = typeof exp === "string" ? Date.parse(exp) : NaN;
    return Number.isFinite(t) && t > now;
}

/**
 * 公開してよいサポーターの3項目。**番号を持つ人だけ**（無ければ undefined）。
 * 取引の番号・商品・期限は出さない（`supporter.ts` の注記）。
 * `months` は保存した値と、記録した期間から今数え直した値の大きい方（`supporter.ts` の `supporterMonths`）。
 * **本番（Production も受けるサーバー）に来た Sandbox の記録は出さない**（`supporter.ts` の
 * `isPrivateSandbox`。Sandbox の番号は別の列で 1 から振るので、本物の No.1 と重なる）。
 *
 * **`owner: true`（本人に返すとき）だけは Sandbox の記録も出し、`sandbox: true` を足す**
 * （2026-10-10 判断: TestFlight で買った本人の設定に「サポーター証」の行が出ないと、
 * 買えたかを確かめられない。本人にしか見えないので、本物の No.1 と並んで見えることはない。
 * `sandbox` は「本物の番号ではない」の印で、知らないクライアントは読み飛ばす）。
 * 公開プロフィール・購入の応答・メダル（`mergeProBadges`）は今までどおり Sandbox を出さない。
 * **このとき `months` は 0**（2026-10-10 判断: Sandbox は数分ごとに更新されるので、1時間で
 * 「12か月目」になり、Sandbox からは付けない続けた年のメダル・進み具合（`monthsOf` も 0）と食い違う）。
 */
export function publicSupporter(
    p: { supporter?: unknown } | null | undefined,
    now: number = Date.now(),
    opts: { owner?: boolean } = {},
): { number: number; since: string; months: number; sandbox?: true } | undefined {
    const s = p?.supporter as Record<string, unknown> | undefined;
    if (!s || typeof s !== "object") return undefined;
    const sandbox = isPrivateSandbox(s);
    if (sandbox && !opts.owner) return undefined;
    const n = s.number;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1) return undefined;
    const since = typeof s.since === "string" && !Number.isNaN(Date.parse(s.since)) ? s.since : "";
    if (sandbox) return { number: n, since, months: 0, sandbox: true };
    const stored = typeof s.months === "number" && Number.isFinite(s.months) && s.months > 0 ? Math.floor(s.months) : 0;
    const live = supporterMonths(s, now);
    return { number: n, since, months: Math.max(stored, live) };
}

/**
 * プロフィールの応答に足す4項目。公開プロフィールと自分のプロフィールで**同じ関数**を通す
 * （片方だけ直して食い違わせない）。
 *
 * `displayBadge` は**持っている鍵のときだけ**返す。持っていない鍵（台本で外した・
 * 書き損じ）は `null`——画面が「無いメダル」を描かないように。
 *
 * `owner: true` は**本人に返すとき**（`userProfile.ts` の `withBadgeFields`）。違うのは
 * `supporter` だけで、本番に来た Sandbox の記録も `sandbox: true` 付きで載せる（`publicSupporter`）。
 * **`toPublicProfile` の `owner`（本人が外した印でも資格どおりに返す・購入の応答）とは別の意味**。
 * こちらは Sandbox のサポーター番号を本人に見せるかだけで、購入の応答は今までどおり出さない。
 */
export function badgeFields(
    p: { badges?: unknown; displayBadge?: unknown; supporter?: unknown; proMarkStyle?: unknown },
    now: number = Date.now(),
    opts: { owner?: boolean } = {},
): {
    badges?: BadgeMap;
    displayBadge: BadgeKey | null;
    pro: boolean;
    proMarkStyle: ProMarkStyle;
    supporter?: { number: number; since: string; months: number; sandbox?: true };
} {
    const badges = sanitizeBadges(p.badges);
    const display = isBadgeKey(p.displayBadge) && badges?.[p.displayBadge] ? p.displayBadge : null;
    const supporter = publicSupporter(p, now, opts);
    return {
        ...(badges ? { badges } : {}),
        displayBadge: display,
        pro: isPro(p, now),
        proMarkStyle: isProMarkStyle(p.proMarkStyle) ? p.proMarkStyle : DEFAULT_PRO_MARK_STYLE,
        ...(supporter ? { supporter } : {}),
    };
}

const TIER_JA = ["", "銅", "銀", "白金"];
/** 続けた年のメダルの段の呼び名 */
const YEAR_TIER_JA = ["", "1年目", "2年目", "3年目"];
const SEASON_JA: Record<ProSeason, string> = { Spring: "春", Summer: "夏", Autumn: "秋", Winter: "冬" };

/** メダルの名前（日本語）。**デザインの板で決まっている表記**。通知の文面（「<名前>のメダルを手に入れました」）に使う */
export const BADGE_NAME_JA: Record<FixedBadgeKey, string> = {
    first: "最初の一枚",
    prefectures: "都道府県",
    countries: "国・地域",
    seasons: "四季",
    morning: "朝の光",
    night: "夜の光",
    books: "旅の一冊",
    wish: "行けた場所",
    earlyUser: "初期ユーザー",
    supporter: "サポーター章",
    supporterYear: "続けた年",
};

/**
 * 段つきの名前（1段だけのメダルは段を書かない）。
 * 例: 「朝の光（銀）」「続けた年（1年目）」「秋の章（2026）」
 */
export function badgeDisplayNameJa(key: BadgeKey, tier: number): string {
    const season = parseProSeasonKey(key);
    if (season) return `${SEASON_JA[season.season]}の章（${season.year}）`;
    const fixed = key as FixedBadgeKey;
    const base = BADGE_NAME_JA[fixed];
    if (fixed === "supporterYear") return YEAR_TIER_JA[tier] ? `${base}（${YEAR_TIER_JA[tier]}）` : base;
    return MAX_TIER[fixed] > 1 && TIER_JA[tier] ? `${base}（${TIER_JA[tier]}）` : base;
}
