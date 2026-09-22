"use client";

import Link from "next/link";
import type { Photo } from "../../lib/data/photos";
import { featuredGroups } from "../../lib/utils/featured";
import { collectionPath } from "../../lib/utils/collections";
import GalleryGrid from "./GalleryGrid";
import { GRID_SIZES_HOME_6XL } from "./gridSizes";
import type { Locale } from "../../lib/data/photos";

/**
 * **運営が選んだ「おすすめ」を、カテゴリごとに出す。**
 *
 * owner:「写真いちらんもいいけど、カテゴリごとのおすすめとかもほしい」
 * 「今週のおすすめなど」。選び方は**手で決める**（`/admin/edit` の
 * 「おすすめに出す」）。
 *
 * **1枚も選ばれていなければ、何も出さない。** 空の見出しだけが残る形は
 * 「準備中」と同じで、見る人の時間を取るだけ。
 *
 * **絞り込み中は出さない**（呼ぶ側の判断）——絞った結果の上に、
 * 絞りと関係ない写真が並ぶと何を見ているか分からなくなる。
 */
type Props = {
    photos: readonly Photo[];
    categoryNames: Record<string, string>;
    locale: Locale;
    /** ホームは静的ページの無い新着写真もその場で開ける（`GalleryGrid` と同じ約束） */
    onOpenPhoto?: (photoId: string) => boolean;
    categoryDisplayMap?: Record<string, string>;
};

export default function FeaturedSections({ photos, categoryNames, locale, onOpenPhoto, categoryDisplayMap }: Props) {
    const groups = featuredGroups(photos, categoryNames);
    if (groups.length === 0) return null;
    const isJa = locale !== "en";

    return (
        <section className="mb-8" aria-labelledby="featured-heading">
            <h2 id="featured-heading" className="text-sm font-semibold tracking-wide text-white/80 mb-3">
                {isJa ? "おすすめ" : "Featured"}
            </h2>
            <div className="space-y-6">
                {groups.map((g) => (
                    <div key={g.slug}>
                        <div className="flex items-baseline justify-between gap-3 mb-2">
                            <h3 className="text-xs tracking-widest uppercase text-white/50">{g.label}</h3>
                            {/* **そのカテゴリの全部へ行ける。** おすすめは数枚なので、
                                もっと見たい人の行き先が無いと行き止まりになる。
                                **先読みは切る**（公開ページの決まり） */}
                            <Link
                                href={collectionPath("category", g.slug)}
                                prefetch={false}
                                className="text-[11px] text-white/50 hover:text-white/80 underline decoration-white/20 underline-offset-2 shrink-0"
                            >
                                {isJa ? "すべて見る" : "See all"}
                            </Link>
                        </div>
                        {/* **カードの作りは `GalleryGrid` に任せる。** 切り抜き位置・
                            alt・派生の出し分け・開き方の約束を写すと、片方だけ
                            古くなる（このリポジトリが何度も踏んだ型）。
                            `sizes` はホームの容器（`max-w-5xl lg:max-w-6xl`）で
                            計算した値——`gridSizes.ts` の `GRID_SIZES_HOME_6XL`。
                            **容器を広げたらこちらも動かす**（既定値は無い） */}
                        <GalleryGrid
                            photos={g.photos}
                            locale={locale}
                            categoryDisplayMap={categoryDisplayMap}
                            onOpenPhoto={onOpenPhoto}
                            sizes={GRID_SIZES_HOME_6XL}
                        />
                    </div>
                ))}
            </div>
        </section>
    );
}
