import type { Photo } from "../data/photos";
import { haversineKm } from "./journey";
import { buildTrips } from "./trips";

// 旅人レベル / 実績バッジ。
// このアプリ固有の主指標「旅立たせた人数（movedCount 合計）」を最重視して、
// 公開データ（写真の likes / movedCount / coords / location）だけからレベルと
// バッジを算出する。API 不要・純粋関数なので他ユーザーのプロフィールでも計算できる。

export type TravelerStats = {
    postCount: number;
    totalLikes: number;
    totalMoved: number;   // 全写真の movedCount 合計 = 旅立たせた人数
    distanceKm: number;   // 位置つき写真を撮影日順につないだ大円距離
    placeCount: number;   // ユニークな location 数
    tripCount: number;    // buildTrips で自動生成された旅の数
};

export type TravelerLevel = {
    level: number;        // 1..
    title: string;        // 称号（ロケール依存）
    score: number;        // 総合スコア
    prevAt: number;       // 現レベルの下限スコア
    nextAt: number | null;// 次レベルの必要スコア（最高レベルなら null）
    progress: number;     // 0..1（現レベル内の進捗）
};

export type Badge = {
    key: string;
    emoji: string;
    label: string;        // ロケール依存
    tier: number;         // 到達段位 0..（ブロンズ=0, シルバー=1, ゴールド=2, プラチナ=3）
    categoryKey: string;  // moved / distance / likes / places / posts
};

// バッジ棚（コレクション）の1マス。未獲得も含めて全カテゴリを返す。
export type BadgeSlot = {
    categoryKey: string;
    emoji: string;
    categoryLabel: string; // 「旅立たせた」等（ロケール依存）
    valueLabel: string;    // 「20人」等（現在値・ロケール依存）
    tier: number;          // -1（未獲得）..3（最高段）
    maxTier: number;       // そのカテゴリの最大段（= tiers.length - 1）
    currentValue: number;
    nextThreshold: number | null; // 次段のしきい値（最高段なら null）
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** 写真配列から旅人の各種指標を集計する（表示・スコアの素材） */
export function computeTravelerStats(photos: Photo[]): TravelerStats {
    const list = Array.isArray(photos) ? photos : [];
    let totalLikes = 0;
    let totalMoved = 0;
    const places = new Set<string>();

    for (const p of list) {
        totalLikes += num((p as { likes?: number }).likes);
        totalMoved += num((p as { movedCount?: number }).movedCount);
        const loc = (p.location ?? "").trim().toLowerCase();
        if (loc) places.add(loc);
    }

    // 距離: coords つき写真を撮影日順につなぐ（footprint と同じ算出）
    const geo = list
        .filter((p) => p.coords && typeof p.coords.lat === "number" && typeof p.coords.lng === "number")
        .map((p) => ({ c: p.coords as { lat: number; lng: number }, t: Date.parse(String(p.date ?? p.createdAt ?? "")) }))
        .filter((x) => !isNaN(x.t))
        .sort((a, b) => a.t - b.t);
    let distanceKm = 0;
    for (let i = 1; i < geo.length; i++) distanceKm += haversineKm(geo[i - 1].c, geo[i].c);

    return {
        postCount: list.length,
        totalLikes,
        totalMoved,
        distanceKm,
        placeCount: places.size,
        tripCount: buildTrips(list).length,
    };
}

/**
 * 総合スコア。moved（旅立たせた人数）を最重視して、いいね・距離・場所・投稿を加味。
 * このアプリの価値観（＝誰かを動かした旅ほど偉い）を数値化する。
 */
export function travelerScore(s: TravelerStats): number {
    return Math.round(
        s.totalMoved * 12 +
        s.totalLikes * 1 +
        s.distanceKm / 8 +
        s.placeCount * 4 +
        s.tripCount * 6 +
        s.postCount * 1,
    );
}

// レベルしきい値（累積スコア下限）。序盤は緩く、上位は指数的に。
const LEVEL_THRESHOLDS = [0, 10, 30, 70, 150, 300, 600, 1200, 2500, 5000];

const TITLES: Record<"ja" | "en", string[]> = {
    ja: ["旅の記録者", "駆け出しの旅人", "旅慣れた人", "旅の語り部", "道を照らす旅人", "風の旅人", "誰かを動かす旅人", "旅の伝道師", "伝説の旅人", "世界を動かす旅人"],
    en: ["Traveler", "Wayfarer", "Seasoned Traveler", "Storyteller", "Trailblazer", "Wind Walker", "Mover of Others", "Journey Evangelist", "Legendary Traveler", "World Mover"],
};

/** スコアからレベル・称号・進捗を求める */
export function travelerLevel(s: TravelerStats, locale: "ja" | "en" = "ja"): TravelerLevel {
    const score = travelerScore(s);
    let idx = 0;
    for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
        if (score >= LEVEL_THRESHOLDS[i]) idx = i;
    }
    const prevAt = LEVEL_THRESHOLDS[idx];
    const nextAt = idx < LEVEL_THRESHOLDS.length - 1 ? LEVEL_THRESHOLDS[idx + 1] : null;
    const progress = nextAt === null ? 1 : Math.min(1, Math.max(0, (score - prevAt) / (nextAt - prevAt)));
    const titles = TITLES[locale] ?? TITLES.ja;
    return { level: idx + 1, title: titles[idx] ?? titles[titles.length - 1], score, prevAt, nextAt, progress };
}

// バッジ: しきい値到達で付与。各カテゴリで到達した最大段のみ表示する。
// categoryLabel（種類名）と valueLabel（現在値）を分けて持ち、トロフィー棚で
// 「種類名 + 実数 + 段位」を別々に見せられるようにする。
const BADGE_TIERS: Array<{
    key: string;
    emoji: string;
    value: (s: TravelerStats) => number;
    tiers: number[];
    categoryLabel: (locale: "ja" | "en") => string;
    valueLabel: (n: number, locale: "ja" | "en") => string;
}> = [
    {
        key: "moved", emoji: "🧭", value: (s) => s.totalMoved, tiers: [1, 5, 20, 50],
        categoryLabel: (l) => (l === "en" ? "Moved" : "旅立たせた"),
        valueLabel: (n, l) => (l === "en" ? `${n.toLocaleString()} people` : `${n.toLocaleString()}人`),
    },
    {
        key: "distance", emoji: "🌏", value: (s) => Math.round(s.distanceKm), tiers: [100, 1000, 5000, 20000],
        categoryLabel: (l) => (l === "en" ? "Distance" : "旅した距離"),
        valueLabel: (n, l) => (l === "en" ? `${n.toLocaleString()} km` : `${n.toLocaleString()}km`),
    },
    {
        key: "likes", emoji: "❤️", value: (s) => s.totalLikes, tiers: [10, 50, 200, 1000],
        categoryLabel: (l) => (l === "en" ? "Likes" : "いいね"),
        valueLabel: (n, l) => (l === "en" ? `${n.toLocaleString()}` : `${n.toLocaleString()}`),
    },
    {
        key: "places", emoji: "🗺️", value: (s) => s.placeCount, tiers: [3, 10, 30, 80],
        categoryLabel: (l) => (l === "en" ? "Places" : "巡った場所"),
        valueLabel: (n, l) => (l === "en" ? `${n.toLocaleString()}` : `${n.toLocaleString()}か所`),
    },
    {
        key: "posts", emoji: "📸", value: (s) => s.postCount, tiers: [5, 25, 60, 100],
        categoryLabel: (l) => (l === "en" ? "Posts" : "投稿"),
        valueLabel: (n, l) => (l === "en" ? `${n.toLocaleString()}` : `${n.toLocaleString()}`),
    },
];

/** 到達段位（0..）を返す。未到達は -1 */
function tierOf(value: number, tiers: number[]): number {
    let hit = -1;
    for (let i = 0; i < tiers.length; i++) if (value >= tiers[i]) hit = i;
    return hit;
}

/** 獲得済みバッジ（各カテゴリ、到達した最大しきい値のみ） */
export function earnedBadges(s: TravelerStats, locale: "ja" | "en" = "ja"): Badge[] {
    const out: Badge[] = [];
    for (const b of BADGE_TIERS) {
        const v = b.value(s);
        const tier = tierOf(v, b.tiers);
        if (tier >= 0) {
            out.push({
                key: `${b.key}-${b.tiers[tier]}`,
                emoji: b.emoji,
                label: `${b.categoryLabel(locale)} ${b.valueLabel(v, locale)}`.trim(),
                tier,
                categoryKey: b.key,
            });
        }
    }
    return out;
}

/**
 * バッジ棚（コレクション）: 全カテゴリを未獲得も含めて返す。
 * トロフィー棚で「集めたくなる」中毒性を出すため、未獲得のマスも見せる。
 */
export function travelerBadgeBoard(s: TravelerStats, locale: "ja" | "en" = "ja"): BadgeSlot[] {
    return BADGE_TIERS.map((b) => {
        const v = b.value(s);
        const tier = tierOf(v, b.tiers);
        const maxTier = b.tiers.length - 1;
        const nextThreshold = tier < maxTier ? b.tiers[tier + 1] : null;
        return {
            categoryKey: b.key,
            emoji: b.emoji,
            categoryLabel: b.categoryLabel(locale),
            valueLabel: b.valueLabel(v, locale),
            tier,
            maxTier,
            currentValue: v,
            nextThreshold,
        };
    });
}
