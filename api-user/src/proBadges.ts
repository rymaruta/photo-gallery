/**
 * Pro が付けるメダル（純関数）。数えるメダル（`badges.ts`）と同じく**段は下げない**。
 *
 * | 鍵                       | 付く条件                                         | 段 |
 * |--------------------------|--------------------------------------------------|----|
 * | supporter                | サポーター番号を持っている（＝一度でも Pro が有効になった） | 1 |
 * | supporterYear            | 続けた月数 12 / 24 / 36（`supporter.ts` の数え方）  | 1 / 2 / 3（1年目 / 2年目 / 3年目） |
 * | pro<季節><年>            | その季節（日本の暦）に Pro が少しでも有効だった     | 1（中身に year） |
 *
 * 季節の章は**後から取れない**: 有効だった期間（Apple の取引の期間）からだけ決める。
 * 年ごとの人が10月に買うと秋の章がすぐ付き、冬の章は12月に入ってから数え直したときに付く
 * （数え直しは `GET /user/badges`・写真の投稿・取引の知らせのたび。`badgeStore.ts`）。
 *
 * Pro をやめても、取ったメダルは残る（ここでは足すだけ）。
 */
import { proSeasonKey, sanitizeBadges } from "./badgeKeys";
import type { BadgeKey, BadgeMap } from "./badgeKeys";
import { computeMonths, readSupporter, seasonsCovered } from "./supporter";

/** 続けた年のメダルの線（月数） */
export const SUPPORTER_YEAR_THRESHOLDS = [12, 24, 36] as const;

export function supporterYearTier(months: number): number {
    let tier = 0;
    for (const t of SUPPORTER_YEAR_THRESHOLDS) if (months >= t) tier++;
    return tier;
}

/** 次の線（最上段なら null） */
export function supporterYearNext(months: number): number | null {
    return SUPPORTER_YEAR_THRESHOLDS.find((t) => months < t) ?? null;
}

/** 行の `supporter` から、今の月数（保存した値と数え直した値の大きい方） */
export function monthsOf(rawSupporter: unknown, now: number): number {
    const s = readSupporter(rawSupporter);
    if (!s) return 0;
    return Math.max(s.months, computeMonths(s.periods, s.environment, now));
}

/**
 * 保存済みのメダルに、Pro のメダルを重ねる。
 *
 * @returns 重ねたあとの `badges` と、新しく付いた／上がったもの（通知に使う）
 */
export function mergeProBadges(stored: unknown, rawSupporter: unknown, now: number): {
    badges: BadgeMap;
    upgraded: { key: BadgeKey; tier: number }[];
} {
    const badges: BadgeMap = { ...(sanitizeBadges(stored) ?? {}) };
    const upgraded: { key: BadgeKey; tier: number }[] = [];
    const s = readSupporter(rawSupporter);
    if (!s) return { badges, upgraded };
    const at = new Date(now).toISOString();
    const raise = (key: BadgeKey, tier: number, year?: number) => {
        if (tier < 1) return;
        if ((badges[key]?.tier ?? 0) >= tier) return;
        badges[key] = year !== undefined ? { tier, at, year } : { tier, at };
        upgraded.push({ key, tier });
    };
    if (s.number !== undefined) raise("supporter", 1);
    raise("supporterYear", supporterYearTier(Math.max(s.months, computeMonths(s.periods, s.environment, now))));
    for (const { season, year } of seasonsCovered(s.periods, now)) {
        // 2026 より前の季節は鍵にしない（`parseProSeasonKey` が読めない年）
        if (year < 2026) continue;
        raise(proSeasonKey(season, year), 1, year);
    }
    return { badges, upgraded };
}
