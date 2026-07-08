// 旅の実績バッジ: 投稿・距離・訪問地などから自動判定する称号。
// フォロワー数ではなく「旅の深さ」を誇れるようにするための仕組み。
// 同じ系統（距離・場所など）では最上位の1つだけを授与する。

export type Badge = {
    id: string;
    emoji: string;
    label: { ja: string; en: string };
    detail: { ja: string; en: string };
};

export type BadgeInput = {
    photoCount: number;
    distanceKm: number;
    places: number;
    tripCount: number;
    categories: number;
    likes: number;
};

type Tier = { min: number; badge: Badge };

// 各系統の閾値（昇順）。最後に満たしたものが授与される。
const FAMILIES: { key: keyof BadgeInput; tiers: Tier[] }[] = [
    {
        key: "distanceKm",
        tiers: [
            { min: 100, badge: { id: "dist-100", emoji: "🚶", label: { ja: "100km旅人", en: "100km Wanderer" }, detail: { ja: "写真の足あとが100kmを超えた", en: "Footprints beyond 100km" } } },
            { min: 1000, badge: { id: "dist-1000", emoji: "🚄", label: { ja: "1,000kmトラベラー", en: "1,000km Traveler" }, detail: { ja: "写真の足あとが1,000kmを超えた", en: "Footprints beyond 1,000km" } } },
            { min: 10000, badge: { id: "dist-10000", emoji: "🌍", label: { ja: "地球周遊", en: "Globe Trotter" }, detail: { ja: "写真の足あとが10,000kmを超えた", en: "Footprints beyond 10,000km" } } },
        ],
    },
    {
        key: "places",
        tiers: [
            { min: 5, badge: { id: "places-5", emoji: "🧭", label: { ja: "探検家", en: "Explorer" }, detail: { ja: "5つ以上の場所を訪れた", en: "Visited 5+ places" } } },
            { min: 15, badge: { id: "places-15", emoji: "🗺", label: { ja: "開拓者", en: "Pathfinder" }, detail: { ja: "15以上の場所を訪れた", en: "Visited 15+ places" } } },
            { min: 30, badge: { id: "places-30", emoji: "🌐", label: { ja: "世界の歩き方", en: "World Walker" }, detail: { ja: "30以上の場所を訪れた", en: "Visited 30+ places" } } },
        ],
    },
    {
        key: "photoCount",
        tiers: [
            { min: 10, badge: { id: "photos-10", emoji: "📷", label: { ja: "フォトグラファー", en: "Photographer" }, detail: { ja: "10枚以上の旅写真を公開", en: "10+ travel photos shared" } } },
            { min: 50, badge: { id: "photos-50", emoji: "🎞", label: { ja: "ストーリーテラー", en: "Storyteller" }, detail: { ja: "50枚以上の旅写真を公開", en: "50+ travel photos shared" } } },
            { min: 100, badge: { id: "photos-100", emoji: "🏆", label: { ja: "フォトマスター", en: "Photo Master" }, detail: { ja: "100枚以上の旅写真を公開", en: "100+ travel photos shared" } } },
        ],
    },
    {
        key: "tripCount",
        tiers: [
            { min: 3, badge: { id: "trips-3", emoji: "🎒", label: { ja: "旅コレクター", en: "Trip Collector" }, detail: { ja: "3回以上の旅を記録", en: "3+ trips recorded" } } },
            { min: 10, badge: { id: "trips-10", emoji: "✈️", label: { ja: "ジャーニーマスター", en: "Journey Master" }, detail: { ja: "10回以上の旅を記録", en: "10+ trips recorded" } } },
        ],
    },
    {
        key: "categories",
        tiers: [
            { min: 3, badge: { id: "cat-3", emoji: "🎨", label: { ja: "オールラウンダー", en: "All-rounder" }, detail: { ja: "3ジャンル以上の写真を撮影", en: "Photos across 3+ genres" } } },
        ],
    },
    {
        key: "likes",
        tiers: [
            { min: 10, badge: { id: "likes-10", emoji: "❤️", label: { ja: "人気者", en: "Crowd Favorite" }, detail: { ja: "いいねを10以上獲得", en: "10+ likes received" } } },
            { min: 100, badge: { id: "likes-100", emoji: "⭐", label: { ja: "スター", en: "Star" }, detail: { ja: "いいねを100以上獲得", en: "100+ likes received" } } },
        ],
    },
];

/** 実績バッジを判定する。各系統で最上位のみ。獲得順は系統の定義順。 */
export function computeBadges(input: BadgeInput): Badge[] {
    const out: Badge[] = [];
    for (const family of FAMILIES) {
        const value = input[family.key];
        let earned: Badge | null = null;
        for (const tier of family.tiers) {
            if (value >= tier.min) earned = tier.badge;
        }
        if (earned) out.push(earned);
    }
    return out;
}
