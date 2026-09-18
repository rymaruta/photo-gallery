import type { Photo } from "../data/photos";
import { slugify, categoryLabel } from "./collections";
import { sortByNewest } from "./photoOrder";

/**
 * **運営が選んだ「おすすめ」を、カテゴリごとにまとめる。**
 *
 * owner の要望（2026-09-17）:「写真いちらんもいいけど、カテゴリごとの
 * おすすめとかもほしい」「今週のおすすめなど」。選び方は
 * **手で決める**（owner の答え）。
 *
 * **「今週の」という名前にはしない。** 手で選ぶ以上、実際には
 * 「いま出したいもの」であって週とは限らない。投稿が月に数枚のこのサイトで
 * 「今週のおすすめ」と出していると、**多くの週で嘘になる**か空になる。
 *
 * **カテゴリごとに並べる**ことで、owner の2つの要望（カテゴリごと・
 * いま推したいもの）が1つの仕組みで両方満たせる。
 */

/** 1つのカテゴリに出す最大枚数。多すぎるとトップが一覧の焼き直しになる */
export const FEATURED_PER_CATEGORY = 6;
/** 出すカテゴリの最大数。トップが縦に伸びすぎないように */
export const FEATURED_GROUPS_MAX = 4;

export type FeaturedGroup = {
    /** 集約ページの鍵（`/category/<slug>`） */
    slug: string;
    /** 画面に出す名前（日本語） */
    label: string;
    photos: Photo[];
};

/**
 * おすすめをカテゴリごとの塊にする。
 *
 * - **公開ぶんだけ。** 印が付いていても非公開なら出さない
 *   （トップに出すのは誰でも見られるものだけ）
 * - **鍵はスラッグ。** `風景` と `landscape` を別の塊にしない
 *   （実データは英語で保存された写真の方が多い）
 * - 並びは既存の規則（`sortByNewest`）に任せる——**ここで作り直さない**
 * - カテゴリを持たない写真は**出さない**。「その他」の塊を作ると、
 *   カテゴリごとに見せるという目的から外れる
 */
export function featuredGroups(
    photos: readonly Photo[] | null | undefined,
    /** カテゴリの表示名の表（`labels.category.names`）。**呼ぶ側から渡す**
     *  ——この関数が i18n を読むと、サーバー・テストのどこからでも読める
     *  という性質（このファイルが `fs` も JSX も持たない理由）が壊れる */
    categoryNames: Record<string, string>,
): FeaturedGroup[] {
    const byCategory = new Map<string, Photo[]>();
    for (const p of photos ?? []) {
        if (p?.featured !== true) continue;
        if (p.published === false) continue;
        const slug = slugify(p.category ?? "", "category");
        if (!slug) continue;
        const list = byCategory.get(slug);
        if (list) list.push(p);
        else byCategory.set(slug, [p]);
    }

    return [...byCategory.entries()]
        .map(([slug, list]) => ({
            slug,
            // 表示名は既存の規則に通す（`建物` と書かれていても「建築」と出す）
            label: categoryLabel(list[0].category ?? slug, categoryNames),
            photos: sortByNewest(list).slice(0, FEATURED_PER_CATEGORY),
        }))
        // **多い順**。同数なら名前順で、毎回同じ並びにする
        .sort((a, b) => b.photos.length - a.photos.length || a.slug.localeCompare(b.slug))
        .slice(0, FEATURED_GROUPS_MAX);
}
