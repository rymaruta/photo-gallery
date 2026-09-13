import type { Photo } from "../data/photos";
import {
    collectEntries, isIndexableCollection,
    MIN_INDEXABLE_COUNT, MIN_INDEXABLE_LOCATION, type CollectionType,
} from "./collections";

/** 集約ページの種別（`CollectionType` の全部）。増えたらここも増やす */
const TYPES: readonly CollectionType[] = ["tag", "category", "location", "camera"] as const;

/**
 * **どこを直すと「検索に出せるページ」が増えるかを数える。**
 *
 * このサイトの検索での面積は、サイトマップに載る件数そのもの
 * （CLAUDE.md: 「この 50 が検索での面積」）。写真を増やす以外に面積を
 * 増やす道は**集約ページを線の上に押し上げること**で、線は種別で違う
 * （タグ・カテゴリ・機材は3枚、撮影地だけ2枚）。
 *
 * これまで周ごとに手で数えていたが、**手で数えると間違える**——撮影地は
 * `photosInCollection` が緩い一致で束ねるので、完全一致で数えると
 * 「全部 noindex」に見えて結論を誤る（実際に一度誤った）。
 * だから**リポジトリ本体の関数（`collectEntries` / `isIndexableCollection`）で
 * 数える**。
 *
 * いちばん効くのは「**あと1枚**」——1枚の写真にタグや撮影地を足すだけで、
 * ページ1枚が丸ごと検索に出せるようになる。
 */
export type Opportunity = {
    type: CollectionType;
    /** 集約ページのスラッグ */
    slug: string;
    /** 画面に出る名前 */
    label: string;
    /** いまの枚数 */
    count: number;
    /** 検索に載るまであと何枚か */
    need: number;
};

export type ContentReport = {
    /** あと1枚で検索に載る集約ページ（効く順） */
    almost: Opportunity[];
    /** いま検索に載っている集約ページの数（種別ごと） */
    indexable: Record<CollectionType, number>;
    /** 集約ページの総数（種別ごと） */
    total: Record<CollectionType, number>;
    /** 撮影地が空の公開写真 */
    photosWithoutLocation: number;
    /** 説明が100文字未満の公開写真 */
    photosWithShortDescription: number;
    /** 公開写真の枚数 */
    published: number;
};

const isPublished = (p: Photo) => p.published !== false && !(p as { story?: boolean }).story;

/** 説明の文字数（日本語だけ見る。段落は連結する） */
function descriptionLength(p: Photo): number {
    const d = p.description as unknown;
    if (typeof d === "string") return d.trim().length;
    if (d && typeof d === "object") {
        const ja = (d as { ja?: unknown }).ja;
        if (Array.isArray(ja)) return ja.map((x) => String(x ?? "")).join("").trim().length;
        if (typeof ja === "string") return ja.trim().length;
    }
    return 0;
}

export function contentOpportunities(photos: Photo[]): ContentReport {
    const live = photos.filter(isPublished);
    const almost: Opportunity[] = [];
    const indexable = {} as Record<CollectionType, number>;
    const total = {} as Record<CollectionType, number>;

    for (const type of TYPES) {
        // **ストーリーを除いた集合で数える。** `collectEntries` 自身は
        // `published !== false` しか見ないが、サイトがその関数に渡すのは
        // ビルドの入力（`sync-photos-from-ddb.js` が `story !== true` で
        // 絞ったもの）。ここで渡す集合を揃えないと、**この道具だけが
        // ストーリーを数えて**実際の集約ページより多く見える
        const entries = collectEntries(live, type);
        total[type] = entries.length;
        indexable[type] = entries.filter((e) => isIndexableCollection(e.count, type)).length;
        const line = type === "location" ? MIN_INDEXABLE_LOCATION : MIN_INDEXABLE_COUNT;
        for (const e of entries) {
            if (isIndexableCollection(e.count, type)) continue;
            const need = line - e.count;
            // **「あと1枚」だけを出す。** 2枚以上足りないページは、1枚の編集では
            // 動かない＝owner の手が一番効く順に並べたいので混ぜない
            if (need === 1) almost.push({ type, slug: e.slug, label: e.label, count: e.count, need });
        }
    }
    // 撮影地（線が2枚＝いちばん安い）を先に、次は枚数の多い順
    almost.sort((a, b) =>
        (a.type === "location" ? 0 : 1) - (b.type === "location" ? 0 : 1)
        || b.count - a.count
        || a.slug.localeCompare(b.slug));

    return {
        almost,
        indexable,
        total,
        photosWithoutLocation: live.filter((p) => !(p.location ?? "").trim()).length,
        photosWithShortDescription: live.filter((p) => descriptionLength(p) < 100).length,
        published: live.length,
    };
}
